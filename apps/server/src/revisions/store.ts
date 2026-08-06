/**
 * 전사 교정 revision 저장소 — Phase 5의 중심.
 *
 * ⛔ **raw transcript를 고치지 않는다.** 교정은 별도 revision에 남는다(5절·11절).
 *    무엇이 기계가 들은 것이고 무엇이 사람이 고친 것인지 구분되지 않으면,
 *    나중에 AI 결과가 틀렸을 때 원인이 전사인지 정리인지 되짚을 수 없다.
 *
 * ⛔ **세그먼트 id와 timestamp는 편집 대상이 아니다.** evidence 인용이 그 둘로
 *    원문을 가리킨다(review-contract). 텍스트만 고친다.
 *
 * ⛔ **확정본은 write-once로 남는다.** 재교정은 새 revision을 열 뿐,
 *    이전 확정본을 덮지 않는다(규칙 3).
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  RuleViolationError,
  type TranscriptRevisionState,
  transition,
} from '@ratatouille/contracts'
import type { RunArtifactStore } from '../runs/store.ts'
import { formatTimestamp } from '../transcription/runner.ts'

export type RevisionSegment = {
  /** raw transcript의 세그먼트 id. evidence가 이것으로 원문을 가리킨다 */
  id: string
  startMs: number
  endMs: number
  /** 사람이 고친(또는 아직 안 고친) 텍스트 */
  text: string
  /**
   * 전사 원문.
   *
   * ⛔ 재교정으로 새 revision을 열어도 **여기는 전사 원문 그대로다.**
   *    직전 교정본이 새 원문이 되면, 두 번 고친 뒤에는 기계가 실제로 무엇을
   *    들었는지 화면에서 사라진다.
   */
  original: string
}

export type TranscriptRevision = {
  id: string
  sourceId: string
  /** 어느 전사에서 나왔나 */
  jobId: string
  state: TranscriptRevisionState
  segments: RevisionSegment[]
  createdAt: string
  approvedAt: string | null
}

export class RevisionNotFoundError extends Error {
  constructor(readonly sourceId: string) {
    super(`${sourceId}의 전사 교정본이 없습니다. 전사가 먼저 끝나야 합니다.`)
    this.name = 'RevisionNotFoundError'
  }
}

export class UnknownSegmentError extends Error {
  constructor(readonly segmentId: string) {
    super(
      `${segmentId}는 이 전사에 없는 세그먼트입니다. 세그먼트를 새로 만들거나 지울 수 없습니다.`
    )
    this.name = 'UnknownSegmentError'
  }
}

export class RevisionLockedError extends Error {
  constructor(readonly revisionId: string) {
    super(
      `${revisionId}는 이미 확정되었습니다. 고치려면 새 교정본을 열어야 합니다.`
    )
    this.name = 'RevisionLockedError'
  }
}

const STATE_FILE = 'revision.state.json'

export type RevisionDeps = {
  /** 진행 중인 교정본이 사는 곳. 확정 전에는 계속 바뀐다 */
  stateRoot: string
  /** 확정본을 write-once로 남길 곳 */
  runs: RunArtifactStore
  now?: () => Date
}

/** raw transcript에서 온 세그먼트 — 저장소가 읽는 최소 형태 */
export type RawSegment = {
  id: string
  startMs: number
  endMs: number
  text: string
}

export class RevisionStore {
  /** sourceId → 그 source의 revision들 (오래된 것부터) */
  private readonly bySource = new Map<string, TranscriptRevision[]>()

  constructor(private readonly deps: RevisionDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString()
  }

  /** 서버 기동 시 디스크에서 되살린다. */
  async load(): Promise<number> {
    let dirs: string[]
    try {
      dirs = await fs.readdir(this.deps.stateRoot)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw e
    }

    let loaded = 0
    for (const sourceId of dirs) {
      try {
        const raw = await fs.readFile(
          path.join(this.deps.stateRoot, sourceId, STATE_FILE),
          'utf8'
        )
        const list = JSON.parse(raw) as TranscriptRevision[]
        this.bySource.set(sourceId, list)
        loaded += list.length
      } catch (e) {
        // 상태 파일이 없는 디렉토리는 정상이다. 깨진 것만 건너뛴다.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue
      }
    }
    return loaded
  }

  private async persist(sourceId: string): Promise<void> {
    const dir = path.join(this.deps.stateRoot, sourceId)
    await fs.mkdir(dir, { recursive: true })
    const full = path.join(dir, STATE_FILE)
    const tmp = `${full}.${process.pid}.tmp`
    const list = this.bySource.get(sourceId) ?? []
    await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, full)
  }

  /** 이 source의 현재(가장 최근) revision */
  current(sourceId: string): TranscriptRevision | null {
    return this.bySource.get(sourceId)?.at(-1) ?? null
  }

  all(sourceId: string): TranscriptRevision[] {
    return [...(this.bySource.get(sourceId) ?? [])]
  }

  /**
   * 전사 결과에서 첫 교정본을 연다. 이미 있으면 그것을 돌려준다.
   *
   * ⚠️ 멱등하다. 화면이 새로고침할 때마다 새 revision이 생기면 이력이 쓰레기가 된다.
   */
  async open(input: {
    sourceId: string
    jobId: string
    segments: RawSegment[]
  }): Promise<TranscriptRevision> {
    const existing = this.current(input.sourceId)
    if (existing) return existing

    const rev: TranscriptRevision = {
      id: `rev_${input.sourceId}_1`,
      sourceId: input.sourceId,
      jobId: input.jobId,
      state: 'transcript_reviewing',
      segments: input.segments.map((s) => ({
        id: s.id,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        original: s.text,
      })),
      createdAt: this.now(),
      approvedAt: null,
    }
    this.bySource.set(input.sourceId, [rev])
    await this.persist(input.sourceId)
    return rev
  }

  /**
   * 텍스트를 고친다. **보낸 세그먼트만** 바뀐다.
   *
   * ⛔ 전체를 받지 않는 이유: 30분 전사는 세그먼트가 수백 개다. 매 타이핑마다
   *    전체를 올리면 느리고, 오래된 사본이 최신 편집을 덮을 수 있다.
   */
  async edit(
    sourceId: string,
    patches: { id: string; text: string }[]
  ): Promise<TranscriptRevision> {
    const rev = this.current(sourceId)
    if (!rev) throw new RevisionNotFoundError(sourceId)
    if (rev.state !== 'transcript_reviewing') throw new RevisionLockedError(rev.id)

    // ⛔ 하나라도 모르는 id가 있으면 **아무것도 바꾸지 않는다.** 절반만 적용하면
    //    화면과 서버가 다른 것을 믿게 된다.
    for (const p of patches) {
      if (!rev.segments.some((s) => s.id === p.id)) {
        throw new UnknownSegmentError(p.id)
      }
    }

    const byId = new Map(patches.map((p) => [p.id, p.text]))
    for (const seg of rev.segments) {
      const next = byId.get(seg.id)
      // ⚠️ 빈 문자열도 유효한 편집이다 — 잘못 인식된 구간을 지우는 방법이다.
      //    `next || seg.text`로 쓰면 빈 문자열이 조용히 무시된다.
      if (next !== undefined) seg.text = next
    }

    await this.persist(sourceId)
    return rev
  }

  /**
   * 확정한다. 확정본은 write-once로 남는다(11절).
   *
   * 이미 확정되어 있으면 그대로 돌려준다 — 두 번 눌러도 터지지 않는다.
   */
  async approve(sourceId: string): Promise<TranscriptRevision> {
    const rev = this.current(sourceId)
    if (!rev) throw new RevisionNotFoundError(sourceId)
    if (rev.state === 'transcript_approved') return rev

    rev.state = transition(
      'transcriptRevision',
      'transcript_reviewing',
      'transcript_approved'
    ) as TranscriptRevisionState
    rev.approvedAt = this.now()

    await this.deps.runs.putReviewedTranscript(rev.id, {
      id: rev.id,
      source_id: rev.sourceId,
      transcription_id: rev.jobId,
      approved_at: rev.approvedAt,
      segments: rev.segments.map((s) => ({
        id: s.id,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        original: s.original,
      })),
    })
    await this.persist(sourceId)
    return rev
  }

  /**
   * 확정한 전사를 다시 연다 — 규칙 3.
   *
   * ⛔ **새 revision을 만든다.** 기존 확정본을 되돌리지 않는다. AI 결과를
   *    `stale`로 바꾸는 것은 호출부(문서 소유자)의 몫이다.
   */
  async reopen(sourceId: string): Promise<TranscriptRevision> {
    const rev = this.current(sourceId)
    if (!rev) throw new RevisionNotFoundError(sourceId)
    if (rev.state !== 'transcript_approved') {
      throw new RuleViolationError(
        'new-revision-requires-approved-current',
        '아직 확정하지 않았습니다. 이미 편집할 수 있는 상태라 새 교정본을 열 필요가 없습니다.'
      )
    }

    const list = this.bySource.get(sourceId)!
    const next: TranscriptRevision = {
      id: `rev_${sourceId}_${list.length + 1}`,
      sourceId,
      jobId: rev.jobId,
      state: 'transcript_reviewing',
      // 직전 확정본에서 이어간다 — 처음부터 다시 고치게 하지 않는다.
      // 단 `original`은 **전사 원문 그대로** 넘긴다.
      segments: rev.segments.map((s) => ({ ...s })),
      createdAt: this.now(),
      approvedAt: null,
    }
    list.push(next)
    await this.persist(sourceId)
    return next
  }

  /** 삭제된 회의의 교정본이 남아 있지 않게 한다. 디스크는 호출부가 치운다. */
  forget(sourceId: string): boolean {
    return this.bySource.delete(sourceId)
  }

  stateDirOf(sourceId: string): string {
    return path.join(this.deps.stateRoot, sourceId)
  }
}

/** 화면에 내보낼 형태. timestamp는 서버가 만든다 — 화면에서 다시 만들면 어긋난다. */
export function toRevisionDto(rev: TranscriptRevision) {
  return {
    revisionId: rev.id,
    sourceId: rev.sourceId,
    jobId: rev.jobId,
    revisionState: rev.state,
    approvedAt: rev.approvedAt,
    segments: rev.segments.map((s) => ({
      id: s.id,
      startMs: s.startMs,
      endMs: s.endMs,
      timestamp: formatTimestamp(s.startMs),
      text: s.text,
      original: s.original,
      edited: s.text !== s.original,
    })),
  }
}
