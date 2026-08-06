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

/**
 * 받침에 따라 갈리는 조사.
 *
 * ⛔ **문자열을 그냥 이어붙이지 않는다.** 「원문 근거을」이 실제로 나왔다.
 *    한국어 UI에서 조사가 틀리면 기계가 쓴 티가 나고, 그건 이 앱이 사람의
 *    말을 다루는 도구라 특히 거슬린다.
 *
 * 한글 음절은 유니코드에서 `가`(0xAC00)부터 28개 종성 주기로 늘어선다.
 * 나머지가 0이면 받침이 없다.
 */
export function withParticle(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.trim().at(-1) ?? ''
  const code = last.charCodeAt(0)
  // 한글 음절이 아니면(영문·숫자) 받침이 있는 것으로 친다 — `Action Item을`
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  const hasFinal = !isHangul || (code - 0xac00) % 28 !== 0
  return `${word}${hasFinal ? withFinal : withoutFinal}`
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

/**
 * 산출물별 루브릭 기준 — `review-contract.md` 4절 원문.
 *
 * ⛔ **문구를 여기서 지어내지 않는다.** 계약 문서에 적힌 질문을 그대로 옮긴다.
 *    바꿔 쓰면 "무엇을 확인했는가"가 회의마다 달라진다 — 루브릭이 있는 이유가
 *    바로 그것을 막는 것이다.
 *
 * ⛔ **점수를 매기는 시험이 아니다.** 같은 질문으로 오류·불확실성과 근거를
 *    확인하는 짧은 체크리스트다. 기준을 늘려 «클릭해야 하는 행정 절차»로
 *    만들면 아무도 제대로 안 본다.
 */
export const RUBRIC: Record<
  ReviewSection,
  readonly { id: string; question: string }[]
> = {
  summary: [
    { id: 'purpose-and-result', question: '핵심 목적과 결과가 빠지지 않았는가?' },
    { id: 'no-invention', question: '전사문에 없는 사실이나 추측이 추가되지 않았는가?' },
    { id: 'context-kept', question: '결정 사항·Action Item과 중요한 미해결 맥락이 반영됐는가?' },
    { id: 'readable', question: '불필요한 반복 없이 다시 읽기 쉬운가?' },
  ],
  decisions: [
    // 🔴 Phase 0 결함 B가 정확히 이 기준에 걸린 오류였다
    { id: 'decision-vs-proposal', question: '실제 결정과 단순 제안·논의가 구분됐는가?' },
    { id: 'what-and-state', question: '무엇을 결정했는지와 현재 상태가 명확한가?' },
    { id: 'reason-in-source', question: '결정 이유·결정자와 근거가 원문 범위 안에 있는가?' },
    { id: 'supersession', question: '이전 결정을 대체하거나 뒤집은 관계가 보존됐는가?' },
  ],
  tasks: [
    { id: 'actionable', question: '실행 가능한 동사와 완료 조건으로 표현됐는가?' },
    { id: 'owner-grounded', question: '담당자가 실제 발언 근거에 맞는가?' },
    { id: 'due-only-if-said', question: '회의에서 기한을 말한 경우에만 정확히 반영됐는가?' },
    { id: 'no-duplicates', question: '중복 작업이 없고 근거가 연결됐는가?' },
    { id: 'no-invented-owner', question: '정보가 없는 담당자·기한을 AI가 만들지 않았는가?' },
  ],
  evidence: [
    { id: 'supports-claim', question: '근거 segment가 실제로 그 주장을 뒷받침하는가?' },
    { id: 'timestamp-accurate', question: 'timestamp가 해당 오디오 구간으로 정확히 이동하는가?' },
    { id: 'no-outside-reading', question: '원문 밖의 해석을 근거처럼 표시하지 않았는가?' },
  ],
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
        out.push({
          section,
          reason: `${withParticle(label, '은', '는')} 비어 있을 수 없습니다.`,
        })
      } else if ((counts[section as 'decisions' | 'tasks'] ?? 0) > 0) {
        // ⛔ 항목이 있는데 「없음」으로 넘긴 것은 확인이 아니라 건너뛴 것이다.
        out.push({
          section,
          reason: `${label}에 항목이 있는데 「없음」으로 표시되어 있습니다.`,
        })
      }
    } else if (r.state !== 'accepted' && r.state !== 'edited') {
      out.push({
        section,
        reason: `${withParticle(label, '을', '를')} 아직 확인하지 않았습니다.`,
      })
    }

    /*
     * 루브릭은 section 상태와 **별개로** 막는다. 사람이 `accepted`로 눌렀어도
     * 「수정 필요」가 남아 있으면 그건 아직 끝난 것이 아니다.
     */
    for (const [criterion, verdict] of Object.entries(r.rubric)) {
      if (verdict !== 'fix_required' && verdict !== 'uncertain') continue
      /*
       * ⛔ 기준 **id**를 그대로 보여주지 않는다. `decision-vs-proposal`은
       *    코드가 읽는 이름이지 사람이 읽는 말이 아니다 — 실제로 화면에
       *    그렇게 나왔다. 질문을 찾지 못하면 그때만 id로 떨어진다.
       */
      const question = RUBRIC[section].find((c) => c.id === criterion)?.question
      out.push({
        section,
        reason: `${label} — ${
          verdict === 'fix_required' ? '수정 필요' : '확인 필요'
        }: ${question ?? criterion}`,
      })
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
