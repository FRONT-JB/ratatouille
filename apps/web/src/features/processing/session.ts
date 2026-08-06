/**
 * 서버 세션 상태 조회 — PLAN.md 순서 3.
 *
 * 완료 조건: "브라우저를 닫았다가 다시 열면 같은 source의 현재 상태와 다음
 * 조작이 표시된다."
 *
 * ⛔ 화면이 상태를 **지어내지 않는다.** 서버가 준 `sourceState`·`jobState`와
 *    문구·다음 조작을 그대로 쓴다. 클라이언트가 따로 판정하면 서버와 갈라지고,
 *    갈라진 쪽이 화면이라 사용자가 먼저 본다.
 */

import {
  type DocumentRunState,
  type MachineName,
  type StateRef,
  type TranscriptRevisionState,
  describeState,
  meetingStage,
} from '@ratatouille/contracts'

export type Phrase = {
  label: string
  detail: string | null
  /** 아직 확정되지 않은 문구. 화면이 시각적으로 구분해야 한다 */
  provisional: boolean
}

export type NextAction = {
  kind:
    | 'resume_upload'
    | 'retry_upload'
    | 'start_transcription'
    | 'retry_transcription'
    | 'open_transcript_review'
    | 'open_document_review'
  label: string
}

type JobView = {
  id: string
  sourceId: string
  jobState: 'queued' | 'transcribing' | 'completed' | 'failed_retryable'
  phrase: Phrase
  nextAction: NextAction | null
  retryable: boolean
  error: string | null
  warning: string | null
  audioMs: number | null
  elapsedMs: number | null
  segmentCount: number | null
}

export type SessionSource = {
  sourceId: string
  sourceState: 'capturing' | 'finalizing' | 'ready'
  sourcePhrase: Phrase
  chunkCount: number
  missing: Partial<Record<'mic' | 'remote', number[]>>
  captureMode: 'in_person' | 'online' | null
  startedAt: string | null
  job: JobView | null
  /*
   * ⛔ 교정·정리 상태를 job과 **따로** 받는다. 전사 job은 확정한 뒤에도
   *    영원히 `completed`다. job만 보면 화면은 확정된 회의도 "교정 전"으로
   *    읽고, 실제로 그랬다.
   */
  revisionState: TranscriptRevisionState | null
  documentRunState: DocumentRunState | null
  nextAction: NextAction | null
}

export type Session = {
  sources: SessionSource[]
  inProgress: string[]
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export async function fetchSession(
  fetchFn: FetchLike = fetch,
  baseUrl = ''
): Promise<Session> {
  const res = await fetchFn(`${baseUrl}/api/session`)
  if (!res.ok) throw new Error(`세션을 불러오지 못했다 (HTTP ${res.status})`)
  return (await res.json()) as Session
}

export function findSource(session: Session, sourceId: string): SessionSource | null {
  return session.sources.find((s) => s.sourceId === sourceId) ?? null
}

/**
 * 이 source가 아직 처리 중인지.
 *
 * ⛔ "녹음이 끝났다"와 "처리가 끝났다"는 다르다. ready인데 전사가 안 끝났으면
 *    여전히 처리 중이다.
 */
export function isProcessing(s: SessionSource): boolean {
  if (s.sourceState !== 'ready') return true
  if (!s.job) return true
  if (s.job.jobState === 'queued' || s.job.jobState === 'transcribing') return true
  // ⛔ AI 정리가 도는 동안에도 처리 중이다. 이게 빠지면 사이드바가 폴링을
  //    멈춰서 "정리 중"이 끝나도 화면이 그대로 남는다.
  return (
    s.documentRunState === 'queued' ||
    s.documentRunState === 'documenting' ||
    s.documentRunState === 'waiting_for_model'
  )
}

/** 전사 교정으로 넘어가도 되는지 */
export function canReviewTranscript(s: SessionSource): boolean {
  return s.sourceState === 'ready' && s.job?.jobState === 'completed'
}

/**
 * 화면에 보여줄 대표 상태.
 *
 * ⛔ source와 job 중 **지금 진행 중인 쪽**을 고르되, 어느 머신의 상태인지
 *    함께 돌려준다. 합쳐서 문자열 하나로 만들면 화면이 "무엇이 진행 중인지"를
 *    되짚을 수 없다.
 */
export function primaryStatus(s: SessionSource): {
  machine: MachineName
  state: string
  phrase: Phrase
} {
  const stage = stageOf(s)
  /*
   * ⛔ 문구는 **계약 표**에서 온다(`describeState`). 서버도 같은 표를 쓰므로
   *    화면이 지어내는 것이 아니다 — 같은 원본을 함께 읽는 것이다.
   *    화면이 자기 문구를 따로 들면 그때 갈라진다.
   */
  return { machine: stage.machine, state: stage.state, phrase: describeState(stage) }
}

/**
 * 이 회의가 지금 어느 단계인가.
 *
 * ⛔ **판정은 계약이 한다**(`meetingStage`). 예전에는 이 파일이 전사 job에서
 *    멈췄고, 그래서 확정된 회의도 "전사 완료 / 전사 교정하기"로 남았다.
 */
export function stageOf(s: SessionSource): StateRef {
  return meetingStage({
    sourceState: s.sourceState,
    jobState: s.job?.jobState ?? null,
    jobRetryable: s.job?.retryable ?? true,
    revisionState: s.revisionState,
    documentRunState: s.documentRunState,
  })
}
