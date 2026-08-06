/**
 * section 검수 상태 — `review-contract.md`, PLAN.md 순서 5.
 *
 * ⛔ **네 결과는 각각 자기 검수 상태를 갖는다.** 하나로 뭉치면 "요약은 봤는데
 *    Action Item은 아직"을 표현할 수 없고, 그러면 사람은 전부 다시 본다.
 *
 * ⛔ **AI 1차 판정만으로 `current`가 되는 경로가 없다.** Phase 0 실측에서
 *    모델이 제안을 결정으로 승격시켰다(결함 B — seg151 "우리 앞으로도 이쁘게
 *    만나자"는 제안인데 결정으로 뽑혔고, 동의 발화가 아예 없었다).
 *    루브릭은 행정 절차가 아니라 그걸 잡으라고 있는 것이다.
 */

import { RuleViolationError } from './rules.ts'

/**
 * 화면의 네 결과.
 *
 * ⚠️ `narrative`(회의 내용)는 여기 없다. 요약과 같은 내용을 길게 편 것이라
 *    `summary`의 검수 상태가 둘 다를 덮는다 — 화면에서도 한 탭 묶음이다.
 *    별도 상태를 두면 "요약은 맞는데 전문은 틀렸다"는 상태가 생기는데,
 *    그건 같은 내용이므로 실제로는 둘 다 틀린 것이다.
 */
export const REVIEW_SECTIONS = [
  'summary',
  'decisions',
  'tasks',
  'evidence',
] as const
export type ReviewSection = (typeof REVIEW_SECTIONS)[number]

/**
 * 한 section의 검수 상태.
 *
 * `empty`는 **회의에 그 항목이 없었다**는 뜻이지 "안 봤다"가 아니다.
 * 둘을 구분하지 못하면, 결정이 없는 회의를 영영 확정할 수 없거나
 * 반대로 안 본 것이 조용히 넘어간다.
 */
export const SECTION_REVIEW_STATES = [
  'unreviewed',
  'in_progress',
  'accepted',
  'edited',
  'empty',
] as const
export type SectionReviewState = (typeof SECTION_REVIEW_STATES)[number]

/**
 * 루브릭 한 기준에 대한 판정.
 *
 * ⛔ **section의 검수 상태와 다른 namespace다.** 같은 이름을 쓰면 "루브릭이
 *    pass니까 section도 확인된 것"이라는 자동 승격이 슬며시 생긴다.
 *    루브릭은 **검수 보조**이고, section 상태는 **사람의 최종 판정**이다.
 */
export const RUBRIC_VERDICTS = [
  'pass',
  'fix_required',
  'uncertain',
  'not_applicable',
] as const
export type RubricVerdict = (typeof RUBRIC_VERDICTS)[number]

export type SectionReview = {
  state: SectionReviewState
  /** 기준 id → 판정. AI가 1차로 채우고 사람이 뒤집을 수 있다 */
  rubric: Record<string, RubricVerdict>
}

export type DocumentReview = Record<ReviewSection, SectionReview>

/** 아무도 아직 보지 않은 상태 */
export function emptyReview(): DocumentReview {
  return {
    summary: { state: 'unreviewed', rubric: {} },
    decisions: { state: 'unreviewed', rubric: {} },
    tasks: { state: 'unreviewed', rubric: {} },
    evidence: { state: 'unreviewed', rubric: {} },
  }
}

/**
 * 사람이 내용을 고쳤다.
 *
 * ⛔ 루브릭 판정은 **지우지 않는다.** AI가 무엇을 지적했는지는 고친 뒤에도
 *    남아야 사람이 "그래서 그 지적이 해소됐나"를 다시 볼 수 있다.
 */
export function reviewAfterEdit(r: SectionReview): SectionReview {
  return { ...r, state: 'edited' }
}

/** 화면에 보이는 이름. 오류 문구가 사용자 말과 같아야 찾을 수 있다 */
const LABEL: Record<ReviewSection, string> = {
  summary: '회의 요약',
  decisions: '결정 사항',
  tasks: 'Action Item',
  evidence: '원문 근거',
}

/** 회의에 실제로 항목이 있었나. `empty`가 정직한지 판정하는 근거다 */
export type ItemCounts = { decisions: number; tasks: number }

/**
 * ⛔ **비어 있음을 허용하는 section은 둘뿐이다.**
 *    회의가 있었으면 요약도 있고, 결과가 있으면 근거도 있다.
 *    결정과 할 일은 실제로 없을 수 있다.
 */
const CAN_BE_EMPTY: Record<ReviewSection, boolean> = {
  summary: false,
  decisions: true,
  tasks: true,
  evidence: false,
}

export type ReviewBlocker = {
  section: ReviewSection
  reason: string
}

/**
 * 무엇이 `current` 승격을 막고 있나.
 *
 * ⛔ **막는 것만으로는 부족하다.** 무엇을 더 해야 하는지 말해주지 않으면
 *    사용자는 네 section을 전부 다시 훑어야 한다.
 */
export function blockersForCurrent(
  review: DocumentReview,
  counts: ItemCounts
): ReviewBlocker[] {
  const out: ReviewBlocker[] = []

  for (const section of REVIEW_SECTIONS) {
    const r = review[section]
    const label = LABEL[section]

    if (r.state === 'empty') {
      if (!CAN_BE_EMPTY[section]) {
        out.push({ section, reason: `${label}은 비어 있을 수 없습니다.` })
      } else if ((counts[section as 'decisions' | 'tasks'] ?? 0) > 0) {
        // ⛔ 항목이 있는데 「없음」으로 넘긴 것은 확인이 아니라 건너뛴 것이다.
        out.push({
          section,
          reason: `${label}에 항목이 있는데 「없음」으로 표시되어 있습니다.`,
        })
      }
    } else if (r.state !== 'accepted' && r.state !== 'edited') {
      out.push({ section, reason: `${label}을 아직 확인하지 않았습니다.` })
    }

    /*
     * 루브릭은 section 상태와 **별개로** 막는다. 사람이 `accepted`로 눌렀어도
     * 「수정 필요」가 남아 있으면 그건 아직 끝난 것이 아니다.
     */
    for (const [criterion, verdict] of Object.entries(r.rubric)) {
      if (verdict === 'fix_required') {
        out.push({ section, reason: `${label} — 수정 필요: ${criterion}` })
      } else if (verdict === 'uncertain') {
        out.push({ section, reason: `${label} — 확인 필요: ${criterion}` })
      }
    }
  }

  return out
}

/**
 * 규칙 7 — 검수를 마치기 전에는 문서가 `current`가 되지 않는다.
 */
export function assertCanPromoteToCurrent(
  review: DocumentReview,
  counts: ItemCounts
): void {
  const blockers = blockersForCurrent(review, counts)
  if (blockers.length > 0) {
    throw new RuleViolationError(
      'document-requires-completed-review',
      blockers.map((b) => b.reason).join(' / ')
    )
  }
}
