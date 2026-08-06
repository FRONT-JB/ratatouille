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
  type DocumentReview,
  type DocumentRunState,
  type DocumentState,
  type EvidenceViolation,
  type TranscriptSegment,
  type ProposalEdit,
  type ReviewBlocker,
  type ReviewSection,
  applyEdit,
  editedSection,
  describeEdit,
  describeViolation,
  verifyEvidence,
  RuleViolationError,
  type RubricVerdict,
  type SectionReviewState,
  assertCanCreateDocumentRun,
  assertCanPromoteToCurrent,
  blockersForCurrent,
  emptyReview,
  reviewAfterEdit,
  canPromoteToProposed,
  transition,
} from '@ratatouille/contracts'
import type { RevisionStore } from '../revisions/store.ts'
import type { VaultStore } from '../vault/store.ts'
import { meetingNotePath, renderMeetingNote } from './markdown.ts'
import type { RunArtifactStore } from '../runs/store.ts'
import type { SourceRepository } from '../sources/repository.ts'
import { formatTimestamp } from '../transcription/runner.ts'
import {
  DocumentFailed,
  type DocumentRunner,
  fillEvidence,
  recite,
} from './runner.ts'

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
  /**
   * 사람의 검수 상태.
   *
   * ⛔ **run과 함께 산다.** 다시 정리하면 새 run이고 검수도 처음부터다 —
   *    내용이 바뀌었는데 「확인함」이 따라오면 아무도 안 본 결과가 확정된다.
   */
  review: DocumentReview
  /**
   * 문서 상태(`reviewing` / `current` / `stale`).
   *
   * ⛔ `documentRun`과 **다른 머신**이다. run은 "모델이 만들었나"를,
   *    document는 "사람이 확정했나"를 말한다.
   */
  documentState: DocumentState
  /**
   * 사람이 손댄 필드 — 11절이 요구하는 "사용자가 수정한 필드".
   *
   * ⛔ **확정본만 봐서는 알 수 없다.** 고쳐진 결과에는 누가 고쳤다는 흔적이
   *    없어서, AI가 무엇을 틀렸는지 되짚을 방법이 사라진다.
   */
  edits: EditRecord[]
  /**
   * 루브릭 판정이 바뀐 이력 — 11절의 "판정 변화".
   *
   * ⛔ **뒤집힌 판정이 이 기록의 값이다.** AI가 `pass`라 한 것을 사람이
   *    `fix_required`로 바꿨다면 그게 결함 B 같은 오류를 잡은 순간이다.
   */
  verdictChanges: VerdictChange[]
  /** 몇 번째 확정인가. 확정 이력의 회차 번호가 된다 */
  promotions: number
}

export type EditRecord = {
  at: string
  section: ReviewSection
  /** `summary.text`, `tasks[1].owner` 같은 필드 경로. 계약이 만든다 */
  field: string
}

export type VerdictChange = {
  at: string
  section: ReviewSection
  criterion: string
  /** 처음 매긴 판정이면 `null` */
  from: RubricVerdict | null
  to: RubricVerdict
}

const STATE_FILE = 'run.state.json'

/**
 * 사람이 읽는 회의 이름.
 *
 * ⛔ id(`src_msgvfbti`)를 제목으로 두지 않는다 — 사람이 읽을 수 없다.
 *    사이드바와 같은 규칙(`MM/DD HH:mm`)을 쓴다.
 */
function titleOf(startedAt: string | null, fallback: string): string {
  if (!startedAt) return fallback
  const d = new Date(startedAt)
  if (Number.isNaN(d.getTime())) return fallback
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export class DocumentRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`정리 결과 ${runId}를 찾을 수 없습니다.`)
    this.name = 'DocumentRunNotFoundError'
  }
}

/**
 * 회의에 실제로 항목이 있었나.
 *
 * ⛔ 「없음」이 정직한지 판정하는 근거다. 항목이 있는데 「없음」으로 넘기면
 *    확인이 아니라 건너뛴 것이다.
 */
function countsOf(run: DocumentRun): { decisions: number; tasks: number } {
  return {
    decisions: run.proposal?.decisions.length ?? 0,
    tasks: run.proposal?.tasks.length ?? 0,
  }
}

export type DocumentQueueDeps = {
  runner: DocumentRunner
  sources: SourceRepository
  revisions: RevisionStore
  runs: RunArtifactStore
  /**
   * 확정 문서가 실제로 사는 곳.
   *
   * ⛔ **없어도 확정은 된다.** 수집만 하는 구성이 있고, vault를 못 쓴다고
   *    검수 결과를 잃으면 안 된다. 다만 있으면 반드시 쓴다 — vault가 원본이다.
   */
  vault?: VaultStore
  stateRoot: string
  now?: () => Date
  /**
   * `run.json`에 남길 실행 출처. 11절이 요구하는 항목이다.
   *
   * ⛔ **여기에 지어낸 값을 넣지 않는다.** 이 기록의 목적은 "어떤 모델이
   *    무엇을 만들었나"를 나중에 되짚는 것이다. 모르면 `unknown`이라고
   *    적는 편이, 그럴듯한 이름을 적어두는 것보다 낫다.
   */
  provenance: RunProvenance & RunProvenanceExtra
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

export type RunProvenanceExtra = {
  /** 실제로 실행한 명령. `runtime`이 무엇을 뜻하는지는 이것으로만 확인된다 */
  runtime_command?: string
}

/** 지금 설정. 바뀌면 여기부터 고친다. */
export const DEFAULT_PROVENANCE: RunProvenance & RunProvenanceExtra = {
  model_provider: 'openai-codex',
  /*
   * ⛔ 그냥 `oauth`라고 적지 않는다. API key 인증과 ChatGPT 계정 OAuth는
   *    만료 방식이 다르고, `auth_required`가 났을 때 무엇을 다시 해야 하는지가
   *    갈린다 — 뭉뚱그리면 그 기록으로 원인을 짚을 수 없다.
   */
  auth_type: 'chatgpt_oauth',
  // ⚠️ Hermes 설정(`~/.hermes/config.yaml`)의 기본 모델을 그대로 적었다.
  //    Hermes가 실행 시점에 다른 모델로 폴백하면 이 기록은 어긋난다.
  //    실행 후 모델명을 되받을 방법이 생기면 그것으로 대체한다.
  model: 'gpt-5.6-luna',
  runtime: 'hermes_default',
  // 실측으로 확정한 호출 경로(Phase 0.6). `hermes proxy`는 쓰지 않는다
  runtime_command: 'hermes -z',
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
        /*
         * ⛔ **없던 필드를 채운다.** 이 필드가 생기기 전에 만든 실행이 디스크에
         *    남아 있다. `undefined`가 그대로 흘러가면 검수 화면이 터진다.
         */
        run.review ??= emptyReview()
        run.documentState ??= 'reviewing'
        run.edits ??= []
        run.verdictChanges ??= []
        run.promotions ??= run.documentState === 'current' ? 1 : 0
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

  /**
   * 한 section의 검수 상태를 바꾼다.
   *
   * ⛔ **부분 갱신이다.** 상태만 바꾸는 경우와 루브릭 판정만 바꾸는 경우가
   *    따로 있다. 통째로 덮으면 다른 쪽이 조용히 지워진다.
   */
  async review(
    runId: string,
    section: ReviewSection,
    patch: { state?: SectionReviewState; rubric?: Record<string, RubricVerdict> }
  ): Promise<DocumentRun> {
    const run = this.runs.get(runId)
    if (!run) throw new DocumentRunNotFoundError(runId)
    /*
     * ⛔ 확정된 문서의 검수 상태를 바꾸지 않는다. 바꾸려면 되돌린 뒤에 한다 —
     *    확정본이 소리 없이 흔들리면 무엇을 확정했는지 알 수 없다.
     */
    if (run.documentState === 'current') {
      throw new RuleViolationError(
        'document-already-current',
        '이미 확정된 문서입니다. 되돌린 뒤에 다시 검수해 주세요.'
      )
    }
    const cur = run.review[section]
    /*
     * ⛔ 판정이 **바뀐 것만** 남긴다. 같은 값을 다시 눌러도 이력이 쌓이면,
     *    "사람이 무엇을 뒤집었나"가 중복 클릭에 묻힌다.
     */
    for (const [criterion, to] of Object.entries(patch.rubric ?? {})) {
      const from = cur.rubric[criterion] ?? null
      if (from === to) continue
      run.verdictChanges.push({ at: this.now(), section, criterion, from, to })
    }
    run.review = {
      ...run.review,
      [section]: {
        state: patch.state ?? cur.state,
        rubric: patch.rubric ? { ...cur.rubric, ...patch.rubric } : cur.rubric,
      },
    }
    await this.persist(run)
    return run
  }

  /** 사람이 고쳤다 → `edited`. 루브릭 판정은 남는다 */
  async markEdited(runId: string, section: ReviewSection): Promise<DocumentRun> {
    const run = this.runs.get(runId)
    if (!run) throw new DocumentRunNotFoundError(runId)
    return this.review(runId, section, {
      state: reviewAfterEdit(run.review[section]).state,
    })
  }

/**
   * 사람이 결과를 고친다.
   *
   * ⛔ **고친 뒤에도 근거를 다시 검증한다.** 사람도 없는 세그먼트를 인용할 수
   *    있다 — 붙여넣다 번호가 어긋나는 것이 흔하다. 환각을 막는 규칙은 누가
   *    쓴 글이냐를 따지지 않는다.
   *
   * ⛔ **거절되면 아무것도 바뀌지 않는다.** 새 객체로 만들어 검증한 뒤에만
   *    갈아끼운다. 반쯤 적용된 상태가 남으면 무엇이 확정된 것인지 알 수 없다.
   */
  async edit(runId: string, edit: ProposalEdit): Promise<DocumentRun> {
    const run = this.runs.get(runId)
    if (!run) throw new DocumentRunNotFoundError(runId)
    if (!run.proposal) {
      throw new RuleViolationError(
        'document-has-no-proposal',
        '아직 정리 결과가 없습니다.'
      )
    }
    if (run.documentState === 'current') {
      throw new RuleViolationError(
        'document-already-current',
        '이미 확정된 문서입니다. 되돌린 뒤에 고쳐 주세요.'
      )
    }

    const rev = this.deps.revisions.current(run.sourceId)
    const segments: TranscriptSegment[] = (rev?.segments ?? []).map((s) => ({
      id: s.id,
      timestamp: formatTimestamp(s.startMs),
      text: s.text,
    }))

    /*
     * ⛔ **편집 규칙은 계약이 갖는다**(`applyEdit`). 서버가 따로 판정하면
     *    같은 규칙이 두 곳에 생기고 반드시 갈라진다.
     *
     * 그 위에 서버가 하는 일은 둘이다: 본문에서 근거를 다시 뽑고(`recite`),
     * 전사문에 **실재하는** 세그먼트인지 검증한다. 계약은 전사문을 모른다.
     */
    const next = fillEvidence(
      recite(applyEdit(run.proposal, edit, new Set(segments.map((s) => s.id)))),
      segments
    )
    const violations = verifyEvidence(next, segments)
    if (violations.length > 0) {
      throw new RuleViolationError(
        'edit-cites-unknown-segment',
        violations.map(describeViolation).join(' / ')
      )
    }

    run.proposal = next
    /*
     * ⛔ 회의 내용을 고쳐도 **요약** 검수 상태가 움직인다. 둘은 같은 내용의
     *    긴 형태와 짧은 형태라 한 검수 상태를 나눠 갖는다.
     */
    const section = editedSection(edit)
    run.review = {
      ...run.review,
      [section]: reviewAfterEdit(run.review[section]),
    }
    run.edits.push({ at: this.now(), section, field: describeEdit(edit) })
    await this.persist(run)
    return run
  }

  /** 무엇이 확정을 막고 있나 */
  blockers(runId: string): ReviewBlocker[] {
    const run = this.runs.get(runId)
    if (!run) return []
    return blockersForCurrent(run.review, countsOf(run))
  }

  /**
   * 규칙 7 — 검수를 마쳐야 `current`가 된다.
   *
   * ⛔ **여기가 유일한 승격 경로다.** 다른 곳에서 `documentState`를 직접
   *    건드리면 검수를 건너뛴 확정본이 생긴다.
   */
  async promote(runId: string): Promise<DocumentRun> {
    const run = this.runs.get(runId)
    if (!run) throw new DocumentRunNotFoundError(runId)
    if (run.state !== 'proposed') {
      throw new RuleViolationError(
        'document-requires-proposed-run',
        `정리가 '${run.state}' 상태입니다. 완료된 결과만 확정할 수 있습니다.`
      )
    }
    assertCanPromoteToCurrent(run.review, countsOf(run))
    run.documentState = transition(
      'document',
      run.documentState,
      'current'
    ) as DocumentState
    run.promotions += 1
    await this.persist(run)
    await this.recordReview(run)
    await this.writeNote(run)
    return run
  }

  /**
   * 확정 시점의 검수 결과를 이력에 남긴다 — 11절.
   *
   * ⛔ **최종 Markdown만으로는 부족하다.** 그건 고쳐진 결과만 보여준다.
   *    사람이 어디를 고쳤고 어떤 판정을 뒤집었는지는 여기에만 남는다.
   *
   * ⛔ 회차로 쌓는다. 되돌려 다시 확정하는 길이 있으므로, 파일 하나에 두면
   *    두 번째 확정이 write-once에 걸려 확정 자체가 실패한다.
   */
  private async recordReview(run: DocumentRun): Promise<void> {
    await this.deps.runs.putReviewed(run.id, run.promotions, {
      reviewed_at: this.now(),
      revision_id: run.revisionId,
      review: run.review,
      edited_fields: run.edits.map((e) => e.field),
      edits: run.edits,
      verdict_changes: run.verdictChanges,
      // 사람 손을 거친 최종본. 「무엇을 확정했나」가 이것이다
      proposal: run.proposal,
    })
  }

  /**
   * 확정 문서를 vault에 쓴다.
   *
   * ⛔ **사람이 쓴 frontmatter를 지우지 않는다**(9절). 디스크에 있던 것을
   *    먼저 깔고 앱이 소유한 키만 덮는다. 사람이 붙인 태그가 다시 확정할 때
   *    사라지면, 그 사람은 다시는 이 앱을 안 쓴다.
   */
  private async writeNote(run: DocumentRun): Promise<void> {
    const vault = this.deps.vault
    if (!vault || !run.proposal) return

    const src = this.deps.sources.get(run.sourceId)
    const relPath = meetingNotePath(run.sourceId)
    const existing = await vault.read(relPath)

    await vault.write(
      relPath,
      renderMeetingNote({
        sourceId: run.sourceId,
        revisionId: run.revisionId,
        runId: run.id,
        sourceHash: src?.sourceHash ?? '',
        title: titleOf(src?.manifest?.startedAt ?? null, run.sourceId),
        startedAt: src?.manifest?.startedAt ?? null,
        proposal: run.proposal,
        existing: existing?.frontmatter,
      })
    )
  }

  /**
   * 확정을 되돌린다.
   *
   * ⛔ **이 길이 없으면 막다른 골목이다.** 확정한 뒤에는 편집도 검수도 막히는데,
   *    되돌릴 방법이 없으면 오타 하나 고치려고 모델을 다시 돌려야 한다.
   *    실제로 오류 문구가 "되돌린 뒤에 고쳐 주세요"라고 하면서 그 길이 없었다.
   *
   * ⛔ `current → reviewing`으로 바로 가지 않는다. 상태 머신이 `stale`을
   *    거치게 되어 있고, 그건 맞는 말이다 — 고칠 참이면 그 확정본은 더 이상
   *    최신이 아니다.
   */
  async reopen(runId: string): Promise<DocumentRun> {
    const run = this.runs.get(runId)
    if (!run) throw new DocumentRunNotFoundError(runId)
    if (run.documentState !== 'current') return run

    const stale = transition('document', 'current', 'stale') as DocumentState
    run.documentState = transition('document', stale, 'reviewing') as DocumentState
    await this.persist(run)
    return run
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
    const previous = this.listFor(sourceId)
    const attempt = previous.length + 1
    /*
     * ⛔ 재시도는 **새 run**이다(5절). 그래서 "재시도 시각"은 이 run의 시작
     *    시각이고, 무엇을 다시 한 것인지는 이전 run을 가리켜야만 알 수 있다.
     *    체인이 끊기면 세 번 실패한 회의와 세 번 정리한 회의가 같아 보인다.
     */
    const retryOf = previous.at(-1)?.id ?? null
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
      review: emptyReview(),
      documentState: 'reviewing',
      edits: [],
      verdictChanges: [],
      promotions: 0,
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

      /*
       * ⛔ 불변 이력(11절). **검증에 실패한 결과도 남긴다** — 무엇이
       *    잘못됐는지 되짚을 수 없으면 프롬프트를 고칠 수도 없다.
       */
      await this.recordRun(run, {
        transcriptionId: rev.jobId,
        segmentCount: segments.length,
        attempt,
        retryOf,
        violations: result.violations.length,
      })
      await this.deps.runs.putProposed(run.id, result.proposal)
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

      /*
       * ⛔ **실패한 실행도 이력이다.** 성공한 것만 남기면 "왜 세 번이나 다시
       *    돌렸나"를 나중에 설명할 수 없고, `auth_required`가 언제부터
       *    반복됐는지도 사라진다.
       *
       * ⚠️ 여기서 던지지 않는다. 이력 기록이 실패하면 사용자가 볼 원인이
       *    「인증 만료」에서 「파일 쓰기 오류」로 바뀐다.
       */
      try {
        await this.recordRun(run, {
          transcriptionId: rev.jobId,
          segmentCount: segments.length,
          attempt,
          retryOf,
          violations: 0,
        })
      } catch {
        // 실패한 실행을 이력 오류로 두 번 죽이지 않는다
      }
    }

    this.runs.set(run.id, run)
    await this.persist(run)
    return run
  }

  /**
   * 실행 이력 — 11절.
   *
   * ⛔ `input.json`은 audio·transcript를 복사하지 않고 **ID와 hash로만**
   *    참조한다. 저장소가 그것을 강제한다.
   */
  private async recordRun(
    run: DocumentRun,
    ctx: {
      transcriptionId: string
      segmentCount: number
      attempt: number
      retryOf: string | null
      violations: number
    }
  ): Promise<void> {
    const src = this.deps.sources.get(run.sourceId)
    await this.deps.runs.putDocumentationRun(run.id, {
      input: {
        source_id: run.sourceId,
        source_hash: src.sourceHash,
        transcription_id: ctx.transcriptionId,
        transcript_revision_id: run.revisionId,
        segment_count: ctx.segmentCount,
      },
      meta: {
        ...this.deps.provenance,
        attempt: ctx.attempt,
        retry_of: ctx.retryOf,
        started_at: run.createdAt,
        finished_at: this.now(),
        elapsed_ms: run.elapsedMs,
        evidence_violations: ctx.violations,
        /*
         * ⛔ 실행이 어떻게 끝났는지를 이력에 적는다. run.state.json은 다시
         *    돌리면 덮이지만 이 파일은 불변이다 — 이 회차의 결말은 여기에만 남는다.
         */
        outcome: run.state,
        error: run.error,
      },
    })
  }
}
