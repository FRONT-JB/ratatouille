/**
 * AI 정리 job 큐.
 *
 * ⛔ **`transcript_approved` 이전에는 만들지 않는다**(규칙 2). 이 검사를 큐
 *    진입점에 둔다 — 화면에서만 막으면 다른 경로로 새어 들어온다.
 *
 * ⛔ **evidence 검증을 통과해야 `proposed`가 된다.** 통과 못 하면 결과를
 *    버리지 않고 위반 목록과 함께 `failed_retryable`로 남긴다 — 무엇이
 *    잘못됐는지 못 보면 프롬프트를 고칠 수도 없다.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  type DocumentProposal,
  type DocumentRunState,
  type EvidenceViolation,
  type TranscriptSegment,
  assertCanCreateDocumentRun,
  canPromoteToProposed,
  transition,
} from '@ratatouille/contracts'
import type { RevisionStore } from '../revisions/store.ts'
import type { RunArtifactStore } from '../runs/store.ts'
import type { SourceRepository } from '../sources/repository.ts'
import { formatTimestamp } from '../transcription/runner.ts'
import { DocumentFailed, type DocumentRunner } from './runner.ts'

export type DocumentRun = {
  id: string
  sourceId: string
  /** 어느 교정본에서 나왔나. 재교정하면 이 결과는 stale이 된다 */
  revisionId: string
  state: DocumentRunState
  error: string | null
  /** evidence 위반. 비어 있지 않으면 proposed가 되지 않는다 */
  violations: EvidenceViolation[]
  proposal: DocumentProposal | null
  elapsedMs: number | null
  createdAt: string
}

const STATE_FILE = 'run.state.json'

export type DocumentQueueDeps = {
  runner: DocumentRunner
  sources: SourceRepository
  revisions: RevisionStore
  runs: RunArtifactStore
  stateRoot: string
  now?: () => Date
  /**
   * `run.json`에 남길 실행 출처. 11절이 요구하는 항목이다.
   *
   * ⛔ **여기에 지어낸 값을 넣지 않는다.** 이 기록의 목적은 "어떤 모델이
   *    무엇을 만들었나"를 나중에 되짚는 것이다. 모르면 `unknown`이라고
   *    적는 편이, 그럴듯한 이름을 적어두는 것보다 낫다.
   */
  provenance: RunProvenance
}

export type RunProvenance = {
  model_provider: string
  auth_type: string
  model: string
  runtime: string
  prompt_version: string | number
  skill_version: string | number
  schema_version: string | number
  rubric_version: string | number
}

/** 지금 설정. 바뀌면 여기부터 고친다. */
export const DEFAULT_PROVENANCE: RunProvenance = {
  model_provider: 'openai-codex',
  auth_type: 'oauth',
  // ⚠️ Hermes 설정(`~/.hermes/config.yaml`)의 기본 모델을 그대로 적었다.
  //    Hermes가 실행 시점에 다른 모델로 폴백하면 이 기록은 어긋난다.
  //    실행 후 모델명을 되받을 방법이 생기면 그것으로 대체한다.
  model: 'gpt-5.6-luna',
  runtime: 'hermes -z',
  prompt_version: 1,
  skill_version: 'none',
  schema_version: 1,
  rubric_version: 'none',
}

export class DocumentQueue {
  private readonly runs = new Map<string, DocumentRun>()
  /** 같은 source를 두 번 돌리지 않는다 */
  private readonly running = new Map<string, Promise<DocumentRun>>()

  constructor(private readonly deps: DocumentQueueDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString()
  }

  async load(): Promise<number> {
    let dirs: string[]
    try {
      dirs = await fs.readdir(this.deps.stateRoot)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw e
    }
    let loaded = 0
    for (const id of dirs) {
      try {
        const raw = await fs.readFile(
          path.join(this.deps.stateRoot, id, STATE_FILE),
          'utf8'
        )
        const run = JSON.parse(raw) as DocumentRun
        // ⛔ 재기동 시점에 `documenting`이던 것은 실제로는 죽어 있다.
        //    그대로 두면 화면이 영원히 "정리 중"을 보여준다.
        if (run.state === 'documenting' || run.state === 'queued') {
          run.state = 'failed_retryable'
          run.error = '서버가 재시작되어 정리가 중단되었습니다. 다시 시도해 주세요.'
        }
        this.runs.set(run.id, run)
        loaded++
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue
      }
    }
    return loaded
  }

  private async persist(run: DocumentRun): Promise<void> {
    const dir = path.join(this.deps.stateRoot, run.id)
    await fs.mkdir(dir, { recursive: true })
    const full = path.join(dir, STATE_FILE)
    const tmp = `${full}.${process.pid}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(run, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, full)
  }

  get(runId: string): DocumentRun | null {
    return this.runs.get(runId) ?? null
  }

  /**
   * ⛔ **id 문자열로 정렬하지 않는다.** `doc_..._9`가 `doc_..._12`보다 뒤로
   *    간다 — 사전순이라 `9` > `1`이다. 실제로 12번째 실행을 만들었는데
   *    화면은 9번째를 보여줬다. 「최신」은 만든 시각이다.
   */
  listFor(sourceId: string): DocumentRun[] {
    return [...this.runs.values()]
      .filter((r) => r.sourceId === sourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  latestFor(sourceId: string): DocumentRun | null {
    return this.listFor(sourceId).at(-1) ?? null
  }

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId)
  }

  stateDirOf(runId: string): string {
    return path.join(this.deps.stateRoot, runId)
  }

  forget(runId: string): boolean {
    return this.runs.delete(runId)
  }

  /**
   * 정리를 시작한다.
   *
   * ⛔ 선행 조건은 **규칙 2가 판단한다.** 여기서 따로 if를 쓰면 계약과
   *    두 곳에서 다른 결론이 날 수 있다.
   */
  async enqueue(sourceId: string): Promise<DocumentRun> {
    const src = this.deps.sources.get(sourceId)
    const rev = this.deps.revisions.current(sourceId)
    assertCanCreateDocumentRun({
      sourceState: src.state,
      // revision이 없으면 확정될 리 없다 — 규칙이 거절하게 둔다
      currentRevisionState: rev?.state ?? 'transcript_reviewing',
    })

    const inFlight = this.running.get(sourceId)
    if (inFlight) return inFlight

    const run = this.execute(sourceId, rev!.id)
    this.running.set(sourceId, run)
    try {
      return await run
    } finally {
      this.running.delete(sourceId)
    }
  }

  private async execute(sourceId: string, revisionId: string): Promise<DocumentRun> {
    const attempt = this.listFor(sourceId).length + 1
    const run: DocumentRun = {
      id: `doc_${sourceId}_${attempt}`,
      sourceId,
      revisionId,
      state: 'queued',
      error: null,
      violations: [],
      proposal: null,
      elapsedMs: null,
      createdAt: this.now(),
    }
    this.runs.set(run.id, run)
    await this.persist(run)

    const rev = this.deps.revisions.current(sourceId)!
    const segments: TranscriptSegment[] = rev.segments.map((s) => ({
      id: s.id,
      timestamp: formatTimestamp(s.startMs),
      text: s.text,
    }))

    run.state = transition('documentRun', 'queued', 'documenting') as DocumentRunState
    await this.persist(run)

    try {
      const result = await this.deps.runner.run({ segments })
      run.elapsedMs = result.elapsedMs
      run.proposal = result.proposal
      run.violations = result.violations

      /*
       * ⛔ 불변 이력(11절). **검증에 실패한 결과도 남긴다** — 무엇이
       *    잘못됐는지 되짚을 수 없으면 프롬프트를 고칠 수도 없다.
       *
       * ⛔ `input.json`은 audio·transcript를 복사하지 않고 **ID와 hash로만**
       *    참조한다. 저장소가 그것을 강제한다.
       */
      const src = this.deps.sources.get(sourceId)
      await this.deps.runs.putDocumentationRun(run.id, {
        input: {
          source_id: sourceId,
          source_hash: src.sourceHash,
          transcription_id: rev.jobId,
          transcript_revision_id: revisionId,
          segment_count: segments.length,
        },
        meta: {
          ...this.deps.provenance,
          elapsed_ms: result.elapsedMs,
          evidence_violations: result.violations.length,
          started_at: run.createdAt,
        },
      })
      await this.deps.runs.putProposed(run.id, result.proposal)

      if (!canPromoteToProposed(result.violations)) {
        // 결과를 버리지 않는다. 상태만 실패로 두고 위반을 보여준다.
        run.state = transition(
          'documentRun',
          'documenting',
          'failed_retryable'
        ) as DocumentRunState
        run.error = `근거 검증에 실패했습니다 (${result.violations.length}건). 다시 시도해 주세요.`
      } else {
        run.state = transition(
          'documentRun',
          'documenting',
          'proposed'
        ) as DocumentRunState
      }
    } catch (e) {
      const kind = e instanceof DocumentFailed ? e.kind : 'retryable'
      run.error = e instanceof Error ? e.message : String(e)
      run.state = transition(
        'documentRun',
        'documenting',
        // ⛔ 인증 만료는 실패가 아니라 별도 상태다(5절). 재시도만 반복하게 두면
        //    사용자는 실제로 필요한 재인증에 영영 도달하지 못한다.
        kind === 'auth_required' ? 'auth_required' : 'failed_retryable'
      ) as DocumentRunState
    }

    this.runs.set(run.id, run)
    await this.persist(run)
    return run
  }
}
