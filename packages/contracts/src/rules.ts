/**
 * 객체 **간** 선행 조건 — technical-foundation.md 5절 `상태 규칙`.
 *
 * state.ts가 한 머신 **안**의 전이를 다룬다면, 여기는 서로 다른 객체 사이의
 * 제약을 다룬다. 이 규칙들이 무너지면 "전사 확정 전에 AI 결과가 생긴다" 같은
 * 계약 위반이 조용히 통과한다.
 */

import type {
  DocumentState,
  SourceState,
  TranscriptRevisionState,
} from './state.ts'

export class RuleViolationError extends Error {
  constructor(
    readonly rule: string,
    message: string
  ) {
    super(message)
    this.name = 'RuleViolationError'
  }
}

/**
 * 규칙 1 — `ready` 이전 source는 transcription job을 만들지 않는다.
 */
export function assertCanCreateTranscriptionJob(
  sourceState: SourceState
): void {
  if (sourceState !== 'ready') {
    throw new RuleViolationError(
      'transcription-requires-ready-source',
      `source가 '${sourceState}'다. 'ready'가 되기 전에는 전사 job을 만들 수 없다`
    )
  }
}

/**
 * 규칙 2 — document run은 source가 `ready`이고
 * **현재** transcript revision이 `transcript_approved`일 때만 만든다.
 *
 * 이것이 "전사 확정 전에는 AI 결과를 생성·표시하지 않는다"의 서버 측 강제다
 * (review-contract.md 6절, PLAN.md 순서 5 완료 조건).
 */
export function assertCanCreateDocumentRun(input: {
  sourceState: SourceState
  currentRevisionState: TranscriptRevisionState
}): void {
  if (input.sourceState !== 'ready') {
    throw new RuleViolationError(
      'document-requires-ready-source',
      `source가 '${input.sourceState}'다. 'ready'가 아니면 document run을 만들 수 없다`
    )
  }
  if (input.currentRevisionState !== 'transcript_approved') {
    throw new RuleViolationError(
      'document-requires-approved-transcript',
      `현재 transcript revision이 '${input.currentRevisionState}'다. ` +
        `'transcript_approved'가 아니면 document run을 만들 수 없다`
    )
  }
}

/**
 * 규칙 3 — 확정 전사를 다시 편집하면 **새 revision**을 `transcript_reviewing`으로
 * 열고, 기존 document를 `stale`로 바꾼다.
 *
 * 기존 revision을 되돌리지 않는다. raw transcript는 불변이다.
 */
export function openNewRevision(input: {
  currentRevisionState: TranscriptRevisionState
  documents: readonly DocumentState[]
}): {
  newRevisionState: TranscriptRevisionState
  documents: DocumentState[]
} {
  if (input.currentRevisionState !== 'transcript_approved') {
    throw new RuleViolationError(
      'new-revision-requires-approved-current',
      `현재 revision이 '${input.currentRevisionState}'다. ` +
        `이미 편집 가능한 상태이므로 새 revision을 열 필요가 없다`
    )
  }
  return {
    newRevisionState: 'transcript_reviewing',
    // current였던 문서만 stale이 된다. reviewing 중이던 것은 그대로 둔다.
    documents: input.documents.map((d) => (d === 'current' ? 'stale' : d)),
  }
}

/**
 * 규칙 4 — 불변 데이터는 덮어쓰지 않는다.
 *
 * raw audio, source hash, raw transcript가 대상이다.
 * 값이 이미 있으면 다른 값으로 바꾸려는 시도를 막는다.
 */
export function assertImmutable<T>(
  field: 'rawAudio' | 'sourceHash' | 'rawTranscript',
  existing: T | null | undefined,
  incoming: T
): void {
  if (existing !== null && existing !== undefined && existing !== incoming) {
    throw new RuleViolationError(
      'immutable-field',
      `${field}는 불변이다. 기존 값을 다른 값으로 덮어쓸 수 없다`
    )
  }
}

/**
 * 규칙 5 — `degraded_draft`는 사용자가 **명시적으로 허용**한 별도 variant이며
 * `current`와 같은 상태로 표시하지 않는다.
 */
export function assertCanCreateDegradedDraft(userRequested: boolean): void {
  if (!userRequested) {
    throw new RuleViolationError(
      'degraded-draft-requires-explicit-request',
      'degraded_draft는 사용자가 명시적으로 요청했을 때만 만든다. 자동 fallback이 아니다'
    )
  }
}

/**
 * 규칙 6 — 중복 실행은 current 문서를 **조용히 덮지 않는다.**
 * 새 run 또는 명시적 retry로 남긴다.
 */
export function assertCanOverwriteCurrent(input: {
  reviewedSourceHash: string
  currentSourceHash: string
}): void {
  if (input.reviewedSourceHash !== input.currentSourceHash) {
    throw new RuleViolationError(
      'source-hash-mismatch',
      'reviewed 결과와 current 문서의 source hash가 다르다. final Markdown을 덮을 수 없다'
    )
  }
}
