/**
 * 전사 교정 — 서버 계약과 순수 판정.
 *
 * ⛔ 화면이 상태를 **지어내지 않는다.** `revisionState`는 서버가 준 것을 쓴다.
 *    "확정됐나"를 화면이 따로 판정하면 서버와 갈라지고, 갈라진 쪽이 화면이라
 *    사용자가 먼저 본다.
 */

export type RevisionState = 'transcript_reviewing' | 'transcript_approved'

export type RevisionSegmentView = {
  id: string
  startMs: number
  endMs: number
  /** 서버가 만든 문자열. 화면에서 다시 만들면 evidence 검증과 어긋난다 */
  timestamp: string
  text: string
  /** 전사 원문. 두 번 교정해도 여기는 기계가 들은 말 그대로다 */
  original: string
  edited: boolean
}

export type RevisionView = {
  revisionId: string
  sourceId: string
  jobId: string
  revisionState: RevisionState
  approvedAt: string | null
  segments: RevisionSegmentView[]
}

/**
 * 지금 재생 중인 세그먼트.
 *
 * ⛔ **끝 시각이 아니라 시작 시각으로 고른다.** 세그먼트 사이에는 빈 구간이
 *    있어서(말 사이의 쉼), `start <= t < end`로만 고르면 그 구간에서 강조가
 *    사라진다. 깜빡이는 강조는 없는 것만 못하다.
 *
 * 재생 위치보다 앞서 시작한 것 중 **가장 마지막**이 지금 들리는 말이다.
 */
export function activeSegmentId(
  segments: readonly { id: string; startMs: number }[],
  currentMs: number | null
): string | null {
  if (currentMs === null || segments.length === 0) return null
  let found: string | null = null
  for (const s of segments) {
    if (s.startMs > currentMs) break
    found = s.id
  }
  return found
}

/** 몇 개를 고쳤나. 확정 버튼 옆에 보여준다 — 무엇을 확정하는지 알아야 한다. */
export function editedCount(segments: readonly { edited: boolean }[]): number {
  return segments.filter((s) => s.edited).length
}

/**
 * 저장 상태.
 *
 * ⛔ `idle`과 `saved`를 구분한다. 둘을 합치면 "저장했다"와 "아직 아무것도 안
 *    했다"가 같은 화면이 되고, 사용자는 자기 교정이 남았는지 알 수 없다.
 */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }

/**
 * 교정 화면이 잠겨 있는가.
 *
 * 확정한 뒤에는 편집할 수 없다. 고치려면 재교정으로 새 revision을 연다.
 */
export function isLocked(state: RevisionState): boolean {
  return state === 'transcript_approved'
}
