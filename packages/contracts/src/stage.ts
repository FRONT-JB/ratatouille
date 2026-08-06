/**
 * 회의가 지금 어느 단계인가 — 여러 머신을 가로지르는 판단.
 *
 * `state.ts`는 한 머신 **안**의 전이를, `rules.ts`는 객체 **사이**의 선행
 * 조건을 본다. 여기는 그 위에서 "그래서 사용자가 지금 뭘 해야 하나"만 답한다.
 *
 * ⛔ **이 판단은 여기 한 곳에만 둔다.** 서버(세션 API)와 사이드바가 각자
 *    판단했더니, 사이드바가 전사 job만 보고 **확정된 회의에도 「교정 전」**을
 *    띄웠다. 서버는 `transcript_approved`를 보내고 있었는데도 그랬다.
 *    같은 질문에 답이 두 개면 반드시 갈라지고, 갈라진 쪽이 화면이라
 *    사용자가 먼저 본다.
 */

import type { NextAction, StateRef } from './phrasing.ts'
import { nextActionFor } from './phrasing.ts'
import type {
  DocumentRunState,
  SourceState,
  TranscriptRevisionState,
  TranscriptionJobState,
} from './state.ts'

export type MeetingStates = {
  sourceState: SourceState
  /** 전사를 아직 안 돌렸으면 null */
  jobState: TranscriptionJobState | null
  /** 전사 결과가 없으면 null */
  revisionState: TranscriptRevisionState | null
  /** AI 정리를 아직 안 돌렸으면 null */
  documentRunState: DocumentRunState | null
  /** 전사 실패가 재시도할 가치가 있나. 기본은 있다고 본다 */
  jobRetryable?: boolean
}

/**
 * 서버 응답이 이 필드들을 아직 안 보내는 판본일 수 있다. 그때 `undefined`가
 * 상태 이름 자리에 앉지 않도록, 들어오는 값을 넓게 받는다.
 */
type MaybeMissing<T> = { [K in keyof T]: T[K] | undefined }

/**
 * 지금 사용자의 주의를 가진 머신과 그 상태.
 *
 * ⛔ **뒤 단계가 이긴다.** 전사 job은 확정한 뒤에도 영원히 `completed`로 남는다.
 *    그것만 보면 화면은 영원히 "전사 완료 / 교정 전"이다.
 */
export function meetingStage(s: MaybeMissing<MeetingStates>): StateRef {
  /*
   * ⛔ **없는 것과 `undefined`를 같이 다룬다.** 이 값들은 HTTP로 건너온다.
   *    서버가 아직 이 필드를 안 보내는 판본이면 `undefined`가 오고, `=== null`
   *    비교만 하면 그것이 그대로 상태 이름 자리에 앉아 `describeState`가
   *    "'undefined' 상태가 없다"로 터진다. 실제로 터졌다.
   */
  const jobState = s.jobState ?? null
  const revisionState = s.revisionState ?? null
  const documentRunState = s.documentRunState ?? null

  if (s.sourceState === undefined || s.sourceState !== 'ready') {
    return { machine: 'source', state: s.sourceState ?? 'capturing' }
  }
  if (jobState === null) {
    return { machine: 'source', state: 'ready' }
  }
  if (jobState !== 'completed') {
    return { machine: 'transcriptionJob', state: jobState }
  }
  if (revisionState === null) {
    // 전사는 끝났는데 교정본이 아직 안 열렸다. 다음은 교정이다.
    return { machine: 'transcriptionJob', state: 'completed' }
  }
  if (revisionState !== 'transcript_approved' || documentRunState === null) {
    return { machine: 'transcriptRevision', state: revisionState }
  }
  return { machine: 'documentRun', state: documentRunState }
}

/**
 * 이 단계에서 사용자가 할 수 있는 조작. 기다리는 것 말고 없으면 `null`이다.
 */
export function nextActionForMeeting(s: MaybeMissing<MeetingStates>): NextAction | null {
  const stage = meetingStage(s)

  if (stage.machine === 'transcriptionJob') {
    // 재시도해도 소용없는 실패에는 재시도 조작을 주지 않는다
    if (stage.state === 'failed_retryable' && s.jobRetryable === false) return null
    return nextActionFor(stage)
  }

  return nextActionFor(stage)
}
