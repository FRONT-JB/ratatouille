/**
 * 결정 사항 entity — technical-foundation 9절, PLAN.md 순서 5.
 *
 * ⛔ **작업과 별도 entity다.** 작업은 «누가 무엇을 한다»이고 결정은 «무엇을
 *    그렇게 하기로 했다»다. 한 곳에 뭉치면 "지난달에 뭘 정했더라"를 물을 수
 *    없다 — 회의록을 쌓는 이유의 절반이 그것이다.
 *
 * ⛔ **후속 결정이 이전 결정을 대체해도 이전 기록을 삭제하지 않는다.**
 *    바뀐 결론만 남기면 "왜 바뀌었나"가 사라진다. 상태만 바꾸고 내용은 둔다.
 *
 * ⛔ **처리 상태(5절)와 다른 머신이다.** `state.ts`의 여섯 머신은 «기계가 지금
 *    무엇을 하고 있나»를 말하고, 이건 «그 결론이 아직 유효한가»를 말한다.
 *    한 표에 섞으면 `queued`·`failed_retryable` 같은 값이 뒤엉킨다.
 */

import { RuleViolationError } from './rules.ts'

export const DECISION_STATES = ['active', 'superseded', 'reversed'] as const
export type DecisionState = (typeof DECISION_STATES)[number]

export type Decision = {
  /**
   * 불변 식별자.
   *
   * ⛔ **파일 경로를 id로 쓰지 않는다.** 파일은 옮겨지고 이름은 바뀐다.
   *    경로가 identity면 사람이 Obsidian에서 파일 하나 옮기는 순간 관계가 끊긴다.
   */
  id: string
  /** 어느 회의에서 나왔나 */
  sourceId: string
  /** 어느 실행의 확정본에서 나왔나. 되짚을 때의 출발점이다 */
  runId: string
  /** 무엇을 결정했나. 근거 마커(`[seg_3]`)가 문장 안에 있다 */
  what: string
  /**
   * 왜 그렇게 정했나.
   *
   * ⛔ **모델에게 받지 않는다.** 이유를 따로 물으면 회의에 없던 근거를 만들어
   *    낸다 — evidence validator는 인용을 검사하지 «그게 진짜 이유인가»를
   *    검사하지 못한다. 사람이 채우고, 안 채우면 `null`이다.
   */
  why: string | null
  /**
   * 누가 결정했나.
   *
   * ⛔ 화자 분리를 접었으므로 모델은 「그렇게 하죠」의 주인을 모른다.
   *    작업의 담당자와 같은 규칙 — 사람이 지정하고, 비면 `null`이다.
   *    `'미입력'`이라는 문자열로 저장하지 않는다. 그런 이름의 사람이 없다.
   */
  who: string | null
  /** 근거 segment id */
  evidence: string[]
  state: DecisionState
  decidedAt: string
  /**
   * 이 결정이 대체한 이전 결정.
   *
   * ⛔ **관계는 한 방향만 저장한다**(9절). 이전 결정 쪽에 `superseded_by`를
   *    같이 적으면 같은 사실이 두 파일에 살고, 둘은 반드시 갈라진다.
   *    역방향이 필요하면 인덱스가 파생한다.
   */
  supersedes: string | null
}

const DECISION_TRANSITIONS: Record<DecisionState, readonly DecisionState[]> = {
  /*
   * ⛔ 되살리는 전이가 없다. 잘못 대체했으면 **새 결정으로 정정한다** —
   *    상태를 되돌리면 "그때 무엇이 유효했나"를 시각으로 재구성할 수 없다.
   */
  active: ['superseded', 'reversed'],
  superseded: [],
  reversed: [],
}

export function canDecisionTransition(from: DecisionState, to: DecisionState): boolean {
  return DECISION_TRANSITIONS[from].includes(to)
}

/**
 * 새 결정이 이전 결정을 대체한다.
 *
 * 이전 결정의 **내용은 그대로 두고 상태만 바꾼다.** 두 개를 새 객체로 돌려주므로
 * 받은 것은 흔들리지 않는다 — 「AI가 뭐라고 했었나」를 되짚을 수 있어야 한다.
 */
export function supersedeDecision(
  previous: Decision,
  replacement: Decision
): [Decision, Decision] {
  if (previous.id === replacement.id) {
    throw new RuleViolationError(
      'decision-supersedes-itself',
      '결정이 자기 자신을 대체할 수 없습니다.'
    )
  }
  assertActive(previous, '대체')
  if (replacement.supersedes !== null) {
    /*
     * ⛔ 한 결정이 둘을 대체하면 «무엇을 대체했나»가 흐려진다. 둘 다 낡았다면
     *    각각을 대체하는 결정을 따로 남긴다.
     */
    throw new RuleViolationError(
      'decision-already-supersedes',
      `이 결정은 이미 다른 결정(${replacement.supersedes})을 대체하고 있습니다.`
    )
  }

  return [
    { ...previous, state: 'superseded' },
    { ...replacement, supersedes: previous.id },
  ]
}

/**
 * 결정을 뒤집는다.
 *
 * 대체와 다르다 — 대체는 «다른 결론으로 바꿨다»이고 뒤집기는 «없던 일로 했다»다.
 * 둘을 한 상태로 뭉치면 회의록을 다시 읽을 때 구분할 수 없다.
 */
export function reverseDecision(decision: Decision): Decision {
  assertActive(decision, '뒤집기')
  return { ...decision, state: 'reversed' }
}

function assertActive(decision: Decision, what: string): void {
  if (decision.state === 'active') return
  throw new RuleViolationError(
    'decision-not-active',
    decision.state === 'superseded'
      ? `이미 다른 결정으로 대체된 결정입니다. ${what}를 하려면 그 결정을 대상으로 하세요.`
      : `이미 뒤집힌 결정입니다. ${what}를 할 수 없습니다.`
  )
}
