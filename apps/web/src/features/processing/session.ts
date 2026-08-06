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

export type JobView = {
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
  return s.job.jobState === 'queued' || s.job.jobState === 'transcribing'
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
  machine: 'source' | 'transcriptionJob'
  state: string
  phrase: Phrase
} {
  if (s.sourceState !== 'ready' || !s.job) {
    return { machine: 'source', state: s.sourceState, phrase: s.sourcePhrase }
  }
  return { machine: 'transcriptionJob', state: s.job.jobState, phrase: s.job.phrase }
}
