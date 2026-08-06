/**
 * evidence 무결성 검증 — Phase 0 실측 **결함 A** 대응.
 *
 * 실측에서 모델이 인용한 segID 중 상당수가 `evidence` 배열에 없었다.
 * 1차 8/18(44%), 2차 **32/41(78%)** — 전사가 길수록 악화한다.
 *
 * review-contract.md는 "원문 근거는 evidence ID와 timestamp가 있는 전용 조회
 * 영역이며, 다른 세 결과에서도 같은 segment로 이동할 수 있어야 한다"고 요구한다.
 * 부분집합 규칙이 깨지면 그 링크가 죽는다.
 *
 * ⛔ 이건 **프롬프트로 고칠 문제가 아니다.** 서버가 강제할 불변식이다.
 *    프롬프트 보강은 위반 빈도를 줄일 뿐 0으로 만들지 못한다.
 */

import { citedIdsIn } from './citation.ts'

export type TranscriptSegment = {
  id: string
  /** `HH:MM:SS` */
  timestamp: string
  text: string
}

export type EvidenceEntry = {
  id: string
  timestamp: string
  quote: string
}

/**
 * 화면의 `Action Item`. 내부 entity 이름은 `tasks`다.
 *
 * ⛔ **담당자와 기한은 `null`일 수 있고, 그것이 정상이다.**
 *    회의에서 지목되지 않았으면 지어내지 않는다. 특히 화자 분리를 접었으므로
 *    "제가 하겠습니다"류는 누가 말했는지 알 수 없다 — 사람이 지정한다.
 *
 * ⛔ 없음을 `'미입력'` 문자열로 저장하지 않는다. 그러면 그런 이름의 담당자와
 *    구분되지 않고, "담당자가 정해졌는가"를 코드가 물을 수 없게 된다.
 *    화면에 보이는 말은 `UNSET_LABEL`이고, 데이터는 `null`이다.
 */
export type ProposedTask = {
  action: string
  owner: string | null
  due: string | null
  evidence: string[]
}

/** 비어 있음을 사람에게 보여주는 말. 프롬프트와 화면이 같은 단어를 쓴다 */
export const UNSET_LABEL = '미입력'

/**
 * 회의 전문 — 주제별로 나눈 **긴 정리글**.
 *
 * ⛔ 요약과 다른 것이다. 요약은 "회의가 무엇이었나"를 몇 문장으로 답하고,
 *    전문은 **회의에서 오간 내용을 따라 읽을 수 있게** 편 것이다. 둘 중
 *    하나만 두면, 짧은 쪽은 근거가 부족하고 긴 쪽은 훑을 수 없다.
 *
 * ⛔ 전사문을 대체하지 않는다. 전사는 기계가 들은 말 그대로이고 불변이다.
 */
export type NarrativeSection = {
  heading: string
  /** 본문. 근거 마커(`[seg_33]`)가 문장 안에 들어 있다 */
  body: string
}

export type DocumentProposal = {
  /** 회의 전문. ⛔ 선택이다 — 이 필드가 생기기 전의 실행에는 없다 */
  narrative?: NarrativeSection[]
  summary: { text: string; evidence: string[] }
  decisions: Array<{ what: string; evidence: string[] }>
  tasks: ProposedTask[]
  evidence: EvidenceEntry[]
}

export type EvidenceViolation =
  | { kind: 'unknown_segment'; id: string; citedIn: string }
  | { kind: 'not_in_evidence_array'; id: string; citedIn: string }
  | { kind: 'timestamp_mismatch'; id: string; claimed: string; actual: string }
  | { kind: 'quote_mismatch'; id: string; claimed: string; actual: string }
  | { kind: 'duplicate_evidence_id'; id: string }

/**
 * 제안된 문서의 evidence 무결성을 검사한다.
 *
 * 검사 항목:
 *   1. 인용된 모든 segID가 전사문에 **실재**하는가
 *   2. 인용된 모든 segID가 `evidence` 배열에 **포함**되는가 (결함 A)
 *   3. `evidence`의 timestamp가 원본과 **일치**하는가
 *   4. `evidence`의 quote가 원본과 **문자열 일치**하는가
 *   5. `evidence`에 중복 ID가 없는가
 *
 * quote를 원본과 문자열 일치로 강제하는 이유: 모델이 전사 오류를 교정해서
 * 인용하면 근거 대조가 불가능해진다. 근거는 **원문 그대로**여야 한다.
 * (실측에서는 모델이 이 동작을 올바르게 했다 — `토스페이먼치`를 그대로 인용)
 */
/**
 * 인용문이 원문에서 온 것인가.
 *
 * ⛔ **규칙의 목적은 "모델이 전사 오류를 교정해서 인용하는 것"을 막는 것이다.**
 *    `토스페이먼치`를 `토스페이먼츠`로 고쳐 인용하면 근거 대조가 불가능해진다.
 *
 * ⚠️ 예전에는 **완전 일치**를 요구했다. 실측(src_msgvfbti, 1423 세그먼트)에서
 *    모델이 `11시가 중...`을 `11시가 중`으로 인용했고, **말줄임표 하나 때문에
 *    근거 48건·결정 7건·할 일 6건이 통째로 막혔다.** 잘라 인용하는 것은
 *    교정이 아니다 — 목적과 무관한 것으로 전체를 버리고 있었다.
 *
 * 그래서 **부분 문자열**로 판정한다. 이 규칙은 중요한 방향으로는 더 엄격하다:
 *   · 잘라 인용   `11시가 중` ⊂ `11시가 중...`        → 통과
 *   · 교정해 인용 `토스페이먼츠` ⊄ `토스페이먼치...`   → 거부
 *
 * 공백은 정규화한다. 모델이 띄어쓰기를 다듬는 것도 교정이 아니다.
 * 빈 인용은 거부한다 — 부분 문자열 규칙에서 빈 문자열은 무조건 통과한다.
 */
export function quoteMatches(quote: string, original: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
  const q = norm(quote)
  if (q.length === 0) return false
  return norm(original).includes(q)
}

export function verifyEvidence(
  proposal: DocumentProposal,
  segments: readonly TranscriptSegment[]
): EvidenceViolation[] {
  const bySegId = new Map(segments.map((s) => [s.id, s]))
  const violations: EvidenceViolation[] = []

  // ── 인용 수집 ──
  const cited = new Map<string, string>() // segId → 어디서 인용했는지
  const note = (ids: readonly string[], where: string) => {
    for (const id of ids) if (!cited.has(id)) cited.set(id, where)
  }
  /*
   * ⛔ **회의 전문의 인용도 검사한다.** 빠뜨리면 화면에서 가장 긴 글이
   *    검증 밖에 남고, 거기에 지어낸 세그먼트가 섞여도 통과한다.
   */
  proposal.narrative?.forEach((n, i) =>
    note(citedIdsIn(n.body), `narrative[${i}]`)
  )
  note(proposal.summary.evidence, 'summary')
  proposal.decisions.forEach((d, i) => note(d.evidence, `decisions[${i}]`))
  proposal.tasks.forEach((t, i) => note(t.evidence, `tasks[${i}]`))

  const evidenceIds = new Set(proposal.evidence.map((e) => e.id))

  // 1·2 — 실재 여부와 부분집합 규칙
  for (const [id, where] of cited) {
    if (!bySegId.has(id)) {
      violations.push({ kind: 'unknown_segment', id, citedIn: where })
      continue
    }
    if (!evidenceIds.has(id)) {
      violations.push({ kind: 'not_in_evidence_array', id, citedIn: where })
    }
  }

  // 5 — 중복
  const seen = new Set<string>()
  for (const e of proposal.evidence) {
    if (seen.has(e.id)) violations.push({ kind: 'duplicate_evidence_id', id: e.id })
    seen.add(e.id)
  }

  // 1·3·4 — evidence 배열 자체의 정확도
  for (const e of proposal.evidence) {
    const seg = bySegId.get(e.id)
    if (!seg) {
      violations.push({ kind: 'unknown_segment', id: e.id, citedIn: 'evidence' })
      continue
    }
    if (seg.timestamp !== e.timestamp) {
      violations.push({
        kind: 'timestamp_mismatch',
        id: e.id,
        claimed: e.timestamp,
        actual: seg.timestamp,
      })
    }
    if (!quoteMatches(e.quote, seg.text)) {
      violations.push({
        kind: 'quote_mismatch',
        id: e.id,
        claimed: e.quote,
        actual: seg.text,
      })
    }
  }

  return violations
}

/**
 * document run을 `proposed`로 승격시켜도 되는지 판정한다.
 *
 * 위반이 하나라도 있으면 승격시키지 않는다. 깨진 링크를 화면에 그리는 것보다
 * 재생성이 낫다.
 */
export function canPromoteToProposed(violations: EvidenceViolation[]): boolean {
  return violations.length === 0
}

/** 위반을 사람이 읽을 수 있는 한 줄로 만든다. run.json에 남긴다. */
export function describeViolation(v: EvidenceViolation): string {
  switch (v.kind) {
    case 'unknown_segment':
      return `${v.id}: 전사문에 없는 segID를 ${v.citedIn}에서 인용했다`
    case 'not_in_evidence_array':
      return `${v.id}: ${v.citedIn}에서 인용했으나 evidence 배열에 없다 (링크가 깨진다)`
    case 'timestamp_mismatch':
      return `${v.id}: timestamp 불일치 — 주장 ${v.claimed}, 실제 ${v.actual}`
    case 'quote_mismatch':
      // ⛔ 무엇이 다른지 보여준다. "다르다"만 말하면 프롬프트를 고칠 수도,
      //    모델이 뭘 잘못했는지 판단할 수도 없다 (실제로 겪었다).
      return `${v.id}: quote가 원문에 없다 — 인용 ${JSON.stringify(v.claimed)}, 원문 ${JSON.stringify(v.actual)}`
    case 'duplicate_evidence_id':
      return `${v.id}: evidence 배열에 중복 ID`
  }
}
