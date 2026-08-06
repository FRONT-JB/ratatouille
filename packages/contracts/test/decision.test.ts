/**
 * 결정 사항 entity — PLAN.md 순서 5, GOAL 6.10.
 *
 * ⛔ **결정은 작업과 다른 것이다.** 작업은 «누가 무엇을 한다»이고 결정은
 *    «무엇을 그렇게 하기로 했다»다. 한 곳에 뭉치면 "지난달에 뭘 정했더라"를
 *    물을 수 없다 — 그게 이 앱이 있는 이유의 절반이다.
 *
 * ⛔ **후속 결정이 이전 결정을 대체해도 이전 기록을 삭제하지 않는다.**
 *    바뀐 결론만 남기면 "왜 바뀌었나"가 사라진다.
 */

import { describe, expect, it } from 'vitest'
import {
  type Decision,
  DECISION_STATES,
  RuleViolationError,
  canDecisionTransition,
  reverseDecision,
  supersedeDecision,
} from '../src/index.ts'

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'dec_01',
    sourceId: 'src_01',
    runId: 'doc_src_01_1',
    what: '오픈을 3월 16일로 연기[seg_1].',
    why: null,
    who: null,
    evidence: ['seg_1'],
    state: 'active',
    decidedAt: '2026-08-06T10:00:00.000Z',
    supersedes: null,
    ...over,
  }
}

const ruleOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof RuleViolationError) return e.rule
    throw e
  }
  throw new Error('규칙 위반이 나지 않았다')
}

describe('상태는 셋이다', () => {
  it('active · superseded · reversed', () => {
    expect([...DECISION_STATES]).toEqual(['active', 'superseded', 'reversed'])
  })

  it('살아 있는 결정만 대체되거나 뒤집힌다', () => {
    expect(canDecisionTransition('active', 'superseded')).toBe(true)
    expect(canDecisionTransition('active', 'reversed')).toBe(true)
  })

  /*
   * ⛔ 되살리는 전이를 두지 않는다. 잘못 대체했으면 **새 결정으로 정정한다** —
   *    상태를 되돌리면 "그때 무엇이 유효했나"를 시각으로 재구성할 수 없다.
   */
  it('⛔ 대체되거나 뒤집힌 결정은 되살아나지 않는다', () => {
    expect(canDecisionTransition('superseded', 'active')).toBe(false)
    expect(canDecisionTransition('reversed', 'active')).toBe(false)
    expect(canDecisionTransition('superseded', 'reversed')).toBe(false)
  })
})

describe('⛔ 대체해도 이전 기록은 남는다', () => {
  it('이전 결정은 superseded가 되고, 새 결정이 그것을 가리킨다', () => {
    const prev = decision({ id: 'dec_01' })
    const next = decision({ id: 'dec_02', what: '3월 23일로 다시 연기[seg_9].' })

    const [after, replacement] = supersedeDecision(prev, next)

    expect(after.state).toBe('superseded')
    // 내용은 그대로다 — 상태만 바뀐다
    expect(after.what).toBe(prev.what)
    expect(after.evidence).toEqual(prev.evidence)
    expect(replacement.supersedes).toBe('dec_01')
  })

  /*
   * ⛔ 관계는 **한 방향만** 저장한다(9절). `superseded_by`를 이전 결정에
   *    같이 적으면 같은 사실이 두 파일에 살고, 둘은 반드시 갈라진다.
   *    역방향은 인덱스가 파생한다.
   */
  it('⛔ 이전 결정에 역방향 링크를 적지 않는다', () => {
    const [after] = supersedeDecision(decision({ id: 'dec_01' }), decision({ id: 'dec_02' }))
    expect(Object.keys(after)).not.toContain('supersededBy')
  })

  it('원본을 흔들지 않는다 — 새 객체를 만든다', () => {
    const prev = decision({ id: 'dec_01' })
    supersedeDecision(prev, decision({ id: 'dec_02' }))
    expect(prev.state).toBe('active')
  })

  it('지난 회의의 결정도 대체할 수 있다 — 그게 흔한 경우다', () => {
    const prev = decision({ id: 'dec_01', sourceId: 'src_old', runId: 'doc_src_old_1' })
    const next = decision({ id: 'dec_02', sourceId: 'src_new' })
    expect(supersedeDecision(prev, next)[0].state).toBe('superseded')
  })
})

describe('⛔ 대체가 거절되는 경우', () => {
  it('자기 자신을 대체할 수 없다', () => {
    const d = decision({ id: 'dec_01' })
    expect(ruleOf(() => supersedeDecision(d, d))).toBe('decision-supersedes-itself')
  })

  it('이미 대체된 결정을 다시 대체할 수 없다', () => {
    const prev = decision({ id: 'dec_01', state: 'superseded' })
    expect(ruleOf(() => supersedeDecision(prev, decision({ id: 'dec_02' })))).toBe(
      'decision-not-active'
    )
  })

  it('뒤집힌 결정도 대체할 수 없다', () => {
    const prev = decision({ id: 'dec_01', state: 'reversed' })
    expect(ruleOf(() => supersedeDecision(prev, decision({ id: 'dec_02' })))).toBe(
      'decision-not-active'
    )
  })

  it('한 결정이 두 결정을 대체하지 않는다 — 무엇을 대체했는지 흐려진다', () => {
    const next = decision({ id: 'dec_02', supersedes: 'dec_00' })
    expect(ruleOf(() => supersedeDecision(decision({ id: 'dec_01' }), next))).toBe(
      'decision-already-supersedes'
    )
  })

  it('거절 사유가 사람 말로 나온다', () => {
    try {
      supersedeDecision(decision({ state: 'superseded' }), decision({ id: 'dec_02' }))
    } catch (e) {
      expect((e as Error).message).toMatch(/대체|이미/)
    }
  })
})

describe('뒤집는다', () => {
  it('결정을 뒤집으면 reversed가 된다 — 내용은 그대로다', () => {
    const d = reverseDecision(decision({ what: '연기한다[seg_1].' }))
    expect(d.state).toBe('reversed')
    expect(d.what).toBe('연기한다[seg_1].')
  })

  it('이미 대체된 결정은 뒤집지 않는다', () => {
    expect(ruleOf(() => reverseDecision(decision({ state: 'superseded' })))).toBe(
      'decision-not-active'
    )
  })
})
