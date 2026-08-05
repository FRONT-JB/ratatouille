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

export type DocumentProposal = {
  summary: { text: string; evidence: string[] }
  decisions: Array<{ what: string; evidence: string[] }>
  tasks: Array<{ action: string; evidence: string[] }>
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
    if (seg.text.trim() !== e.quote.trim()) {
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
      return `${v.id}: quote가 원문과 다르다 — 근거는 원문 그대로여야 한다`
    case 'duplicate_evidence_id':
      return `${v.id}: evidence 배열에 중복 ID`
  }
}
