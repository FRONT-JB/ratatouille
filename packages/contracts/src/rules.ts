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
 * 한 번 정해지면 바꿀 수 없는 필드.
 *
 * ⛔ 이 목록을 `string`으로 넓히지 않는다. 넓히는 순간 오타가 통과하고,
 *    "무엇이 불변인가"가 코드에서 사라진다.
 */
export type ImmutableField =
  | 'rawAudio'
  | 'sourceHash'
  | 'rawTranscript'
  // 조각 개수는 녹음 종료 시 클라이언트가 한 번 선언한다. 검증 기준을
  // 사후에 고칠 수 있으면 검증이 아니다.
  | `expectedChunks.${string}`

/**
 * 규칙 4 — 불변 데이터는 덮어쓰지 않는다.
 *
 * raw audio, source hash, raw transcript, 그리고 선언된 조각 개수가 대상이다.
 * 값이 이미 있으면 다른 값으로 바꾸려는 시도를 막는다.
 */
export function assertImmutable<T>(
  field: ImmutableField,
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
 *
 * ⛔ **`DocumentRunState`에 넣지 않는다.** 초안은 실행이 어떻게 끝났는지가
 *    아니라 「그 실패한 결과를 사람이 보기로 했나」다. 상태로 만들면
 *    `failed_retryable`을 덮어써서 왜 실패했는지가 사라진다.
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
 * 규칙 5의 나머지 절반 — 초안은 **확정되지 않는다.**
 *
 * ⛔ **근거 검증을 통과하지 못한 결과가 vault의 정식 원본이 되면 안 된다**(9절).
 *    초안이 `current`가 될 수 있으면 이 앱이 막으려는 것 하나가 통째로 뚫린다:
 *    없는 발언을 인용한 회의록이 「확정본」 이름을 달고 Markdown으로 남는다.
 *
 * ⛔ **초안을 고쳐서 확정하는 길도 두지 않았다.** 사람이 지어낸 인용을 지워
 *    검증을 통과시킬 수는 있지만, 그러면 「이 결과는 검증을 통과했다」는 기록이
 *    사후 편집으로 만들어진다. 다시 정리하는 것이 정직한 길이다.
 */
export function assertNotDegradedDraft(isDegradedDraft: boolean): void {
  if (isDegradedDraft) {
    throw new RuleViolationError(
      'degraded-draft-cannot-be-current',
      '근거 검증을 통과하지 못한 초안은 확정할 수 없습니다. 다시 정리한 뒤 확정해 주세요.'
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
