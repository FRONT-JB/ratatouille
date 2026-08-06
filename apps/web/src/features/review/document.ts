/**
 * AI 정리 결과 — 서버 계약과 순수 판정.
 *
 * ⛔ **네 section을 빼거나 하나로 합치지 않는다**(review-contract.md).
 *    회의 요약 / 결정 사항 / Action Item / 원문 근거. 다섯 번째를 추가하지도
 *    않는다 — 주요 논점·열린 질문은 Phase 2 후보다.
 *
 * ⛔ **화면이 상태를 지어내지 않는다.** `documentRunState`는 서버가 준 것을
 *    쓰고, 사람이 읽는 말은 `describeState`가 documentRun 머신에서 가져온다.
 */

import {
  type DocumentProposal,
  type DocumentRunState,
  type EvidenceEntry,
  type Phrase,
  describeState,
} from '@ratatouille/contracts'

/** 서버 `GET/POST /api/sources/:id/document`의 응답 */
export type DocumentView = {
  runId: string | null
  documentRunState: DocumentRunState | null
  /** 어느 교정본에서 나왔나. 재교정하면 이 결과는 오래된 것이 된다 */
  revisionId: string | null
  error: string | null
  /** 사람이 읽는 말로 옮겨진 evidence 위반. 서버가 문구까지 만든다 */
  violations: { kind: string; message: string }[]
  elapsedMs: number | null
  proposal: DocumentProposal | null
}

export type SectionKey = 'summary' | 'decisions' | 'tasks' | 'evidence'

/**
 * 화면의 네 결과 영역.
 *
 * ⛔ 화면 이름과 내부 entity 이름이 다르다 — `Action Item`은 `tasks`다.
 *    둘을 같은 이름으로 만들면 계약 문서와 코드가 서로 다른 말을 한다.
 */
export const SECTIONS: readonly { key: SectionKey; title: string }[] = [
  { key: 'summary', title: '회의 요약' },
  { key: 'decisions', title: '결정 사항' },
  { key: 'tasks', title: 'Action Item' },
  { key: 'evidence', title: '원문 근거' },
] as const

/**
 * 해석된 근거 하나.
 *
 * `resolved`가 거짓이면 **전사문에서 그 세그먼트를 찾지 못했다는 뜻**이다.
 * 서버의 `verifyEvidence`가 먼저 막지만, 화면도 스스로 막는다 — 눌러도
 * 아무 데도 가지 않는 링크는 없는 것만 못하다.
 */
export type Citation = {
  id: string
  timestamp: string
  quote: string
  /** 재생 위치. 전사 세그먼트에서 온다 */
  startMs: number | null
  resolved: boolean
}

type SegmentLike = {
  id: string
  startMs: number
  timestamp: string
  text: string
}

/**
 * 인용된 ID들을 실제 원문 위치로 해석한다.
 *
 * ⛔ **재생 위치는 전사 세그먼트에서 가져온다.** `00:00:04` 문자열을 되파싱하면
 *    초 미만이 잘려 나간다. 정확한 `startMs`가 바로 옆에 있다.
 *
 * evidence 배열은 인용문·시각의 출처지만, 없어도 전사문에서 채울 수 있다.
 * 서버가 채워 보내므로 보통은 있다 — 그래도 화면이 서버에만 기대지 않는다.
 */
export function citationsOf(
  ids: readonly string[],
  evidence: readonly EvidenceEntry[],
  segments: readonly SegmentLike[]
): Citation[] {
  const byEvidence = new Map(evidence.map((e) => [e.id, e]))
  const bySegment = new Map(segments.map((s) => [s.id, s]))
  const seen = new Set<string>()

  const out: Citation[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const seg = bySegment.get(id)
    const ev = byEvidence.get(id)
    out.push({
      id,
      timestamp: ev?.timestamp ?? seg?.timestamp ?? '',
      quote: ev?.quote ?? seg?.text ?? '',
      startMs: seg?.startMs ?? null,
      resolved: seg !== undefined,
    })
  }
  return out
}

/**
 * 각주 번호표 — 세그먼트 ID → 번호.
 *
 * ⛔ **번호는 `proposal.evidence`의 순서다.** 그 배열은 서버가 인용된 순서대로
 *    (요약 → 결정 → Action Item) 채운다. 화면이 따로 번호를 매기면 `원문 근거`
 *    각주란의 번호와 본문 각주의 번호가 어긋나고, 어긋나면 각주가 무의미하다.
 */
export function footnoteNumbers(
  evidence: readonly EvidenceEntry[]
): Map<string, number> {
  return new Map(evidence.map((e, i) => [e.id, i + 1]))
}

/** 지금 돌고 있나. 도는 동안에는 다시 요청하지 않는다. */
export function isRunning(state: DocumentRunState | null): boolean {
  return (
    state === 'queued' || state === 'documenting' || state === 'waiting_for_model'
  )
}

/** ⛔ 머신 이름을 붙여 문구를 찾는다. `queued`는 전사 job에도 있다. */
export function describeRunState(state: DocumentRunState): Phrase {
  return describeState({ machine: 'documentRun', state })
}

/**
 * 이 결과가 지금 확정본이 아닌 교정본에서 나왔나.
 *
 * 재교정하면 확정본 ID가 바뀐다. 옛 전사에서 뽑은 결정·Action Item을 최신인
 * 것처럼 두면, 사용자가 고친 문장이 결과에 반영됐다고 착각한다.
 */
export function isStale(view: DocumentView, currentRevisionId: string): boolean {
  if (!view.revisionId) return false
  return view.revisionId !== currentRevisionId
}
