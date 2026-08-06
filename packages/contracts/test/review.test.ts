/**
 * section 검수 상태 — `review-contract.md`, PLAN.md 순서 5.
 *
 * ⛔ **네 결과는 각각 자기 검수 상태를 갖는다.** 하나로 뭉치면 "요약은 봤는데
 *    Action Item은 아직"을 표현할 수 없고, 그러면 사람은 전부 다시 본다.
 *
 * ⛔ **AI 1차 판정만으로 `current`가 되는 경로가 없다.** Phase 0 실측에서
 *    모델이 제안을 결정으로 승격시켰다(결함 B). 루브릭은 행정 절차가 아니라
 *    그걸 잡으라고 있는 것이다.
 */

import { describe, expect, it } from 'vitest'
import {
  REVIEW_SECTIONS,
  RUBRIC,
  RuleViolationError,
  type SectionReview,
  assertCanPromoteToCurrent,
  blockersForCurrent,
  emptyReview,
  reviewAfterEdit,
  withParticle,
} from '../src/index.ts'

const review = (over: Partial<Record<string, SectionReview>> = {}) => ({
  ...emptyReview(),
  ...over,
})

/** 사람이 전부 확인한 상태 */
const allAccepted = () =>
  review({
    summary: { state: 'accepted', rubric: {} },
    decisions: { state: 'accepted', rubric: {} },
    tasks: { state: 'accepted', rubric: {} },
    evidence: { state: 'accepted', rubric: {} },
  })

describe('⛔ 네 결과가 각각 자기 상태를 갖는다', () => {
  it('summary / decisions / tasks / evidence', () => {
    expect([...REVIEW_SECTIONS]).toEqual([
      'summary',
      'decisions',
      'tasks',
      'evidence',
    ])
  })

  it('처음에는 모두 unreviewed다 — 본 적 없는 것을 봤다고 하지 않는다', () => {
    for (const s of REVIEW_SECTIONS) {
      expect(emptyReview()[s].state).toBe('unreviewed')
    }
  })

  it('한 section을 확인해도 다른 section은 그대로다', () => {
    const r = review({ summary: { state: 'accepted', rubric: {} } })
    expect(r.summary.state).toBe('accepted')
    expect(r.tasks.state).toBe('unreviewed')
  })
})

describe('⛔ 검수를 마치기 전에는 current가 되지 않는다', () => {
  it('전부 확인했으면 승격된다', () => {
    expect(() =>
      assertCanPromoteToCurrent(allAccepted(), { decisions: 1, tasks: 1 })
    ).not.toThrow()
  })

  it('하나라도 unreviewed면 막힌다', () => {
    const r = allAccepted()
    r.tasks = { state: 'unreviewed', rubric: {} }
    expect(() =>
      assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })
    ).toThrow(RuleViolationError)
  })

  it('보는 중(in_progress)이어도 막힌다', () => {
    const r = allAccepted()
    r.summary = { state: 'in_progress', rubric: {} }
    expect(() => assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })).toThrow()
  })

  it('사람이 고친 것(edited)은 확인한 것으로 친다', () => {
    const r = allAccepted()
    r.summary = { state: 'edited', rubric: {} }
    expect(() =>
      assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })
    ).not.toThrow()
  })

  it('무엇이 막고 있는지 알려준다 — 못 찾으면 끝낼 수 없다', () => {
    const r = emptyReview()
    expect(blockersForCurrent(r, { decisions: 1, tasks: 1 })).toHaveLength(4)
    expect(blockersForCurrent(r, { decisions: 1, tasks: 1 })[0]).toMatchObject({
      section: 'summary',
    })
  })
})

describe('⛔ 비어 있음은 결정·Action Item에만, 그것도 실제로 없을 때만', () => {
  it('회의에 결정이 없었으면 empty가 맞다', () => {
    const r = allAccepted()
    r.decisions = { state: 'empty', rubric: {} }
    expect(() =>
      assertCanPromoteToCurrent(r, { decisions: 0, tasks: 1 })
    ).not.toThrow()
  })

  it('⛔ 항목이 있는데 empty라고 하면 막힌다 — 안 보고 넘긴 것이다', () => {
    const r = allAccepted()
    r.decisions = { state: 'empty', rubric: {} }
    expect(() => assertCanPromoteToCurrent(r, { decisions: 3, tasks: 1 })).toThrow(
      /결정 사항/
    )
  })

  it('⛔ 회의 요약은 비어 있을 수 없다 — 회의가 있었으면 요약도 있다', () => {
    const r = allAccepted()
    r.summary = { state: 'empty', rubric: {} }
    expect(() => assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })).toThrow()
  })

  it('⛔ 원문 근거도 비어 있을 수 없다 — 근거 없는 결과는 검수할 수 없다', () => {
    const r = allAccepted()
    r.evidence = { state: 'empty', rubric: {} }
    expect(() => assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })).toThrow()
  })

  it('⛔ 비어 있음을 오류로 세지 않는다 — 회의에 그런 항목이 없었을 뿐이다', () => {
    const r = allAccepted()
    r.decisions = { state: 'empty', rubric: {} }
    expect(blockersForCurrent(r, { decisions: 0, tasks: 1 })).toEqual([])
  })
})

describe('⛔ 루브릭 판정과 section 상태는 다른 namespace다', () => {
  it('fix_required가 하나라도 있으면 막힌다', () => {
    const r = allAccepted()
    r.decisions = {
      state: 'accepted',
      // 실측 결함 B: 제안을 결정으로 승격시켰다
      rubric: { 'decision-vs-proposal': 'fix_required' },
    }
    expect(() => assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })).toThrow(
      /수정 필요/
    )
  })

  it('uncertain이 남아 있어도 막힌다 — 모르겠다는 것은 확인이 아니다', () => {
    const r = allAccepted()
    r.summary = { state: 'accepted', rubric: { faithful: 'uncertain' } }
    expect(() => assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })).toThrow(
      /확인 필요/
    )
  })

  it('pass는 막지 않는다', () => {
    const r = allAccepted()
    r.summary = { state: 'accepted', rubric: { faithful: 'pass' } }
    expect(() =>
      assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })
    ).not.toThrow()
  })

  it('⛔ not_applicable이 section 상태를 자동으로 바꾸지 않는다', () => {
    // 루브릭 기준 하나가 «해당 없음»인 것과, 사람이 그 section을 확인한 것은
    // 전혀 다른 사실이다. 자동으로 넘기면 아무도 안 본 결과가 확정된다.
    const r = emptyReview()
    r.summary = { state: 'unreviewed', rubric: { faithful: 'not_applicable' } }
    expect(r.summary.state).toBe('unreviewed')
    expect(() => assertCanPromoteToCurrent(r, { decisions: 1, tasks: 1 })).toThrow()
  })
})

describe('⛔ 루브릭 기준은 계약 문서 그대로다', () => {
  it('네 산출물 모두 기준을 갖는다', () => {
    for (const s of REVIEW_SECTIONS) {
      expect(RUBRIC[s].length).toBeGreaterThan(0)
    }
  })

  it('🔴 결정 사항의 첫 기준이 결함 B를 잡는 그 질문이다', () => {
    expect(RUBRIC.decisions[0]).toEqual({
      id: 'decision-vs-proposal',
      question: '실제 결정과 단순 제안·논의가 구분됐는가?',
    })
  })

  it('⛔ 기준이 지나치게 많지 않다 — 행정 절차가 되면 아무도 안 본다', () => {
    // 계약: "각 산출물은 핵심 기준 3~5개로 시작한다"
    for (const s of REVIEW_SECTIONS) {
      expect(RUBRIC[s].length).toBeGreaterThanOrEqual(3)
      expect(RUBRIC[s].length).toBeLessThanOrEqual(5)
    }
  })

  it('기준 id가 section 안에서 겹치지 않는다', () => {
    for (const s of REVIEW_SECTIONS) {
      const ids = RUBRIC[s].map((r) => r.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('⛔ 조사가 받침을 따라간다', () => {
  // 「원문 근거을」이 실제로 나왔다. 한국어 UI에서 조사가 틀리면 기계가 쓴
  // 티가 나고, 이 앱은 사람의 말을 다루는 도구라 특히 거슬린다.

  it.each([
    ['회의 요약', '을'],
    ['결정 사항', '을'],
    ['원문 근거', '를'],
    ['Action Item', '을'],
  ])('%s + %s', (word, expected) => {
    expect(withParticle(word, '은/을', '는/를')).toBe(
      word + (expected === '을' ? '은/을' : '는/를')
    )
  })

  it('⛔ 막는 이유에 기준 id가 아니라 질문이 나온다', () => {
    // `decision-vs-proposal`은 코드가 읽는 이름이다. 실제로 화면에 그렇게 떴다.
    const r = emptyReview()
    r.decisions = {
      state: 'accepted',
      rubric: { 'decision-vs-proposal': 'fix_required' },
    }
    const reasons = blockersForCurrent(r, { decisions: 1, tasks: 1 }).map(
      (b) => b.reason
    )
    expect(reasons).toContain(
      '결정 사항 — 수정 필요: 실제 결정과 단순 제안·논의가 구분됐는가?'
    )
    expect(reasons.join()).not.toContain('decision-vs-proposal')
  })

  it('막는 이유 문구에 실제로 적용된다', () => {
    const reasons = blockersForCurrent(emptyReview(), {
      decisions: 1,
      tasks: 1,
    }).map((b) => b.reason)
    expect(reasons).toContain('원문 근거를 아직 확인하지 않았습니다.')
    expect(reasons).toContain('회의 요약을 아직 확인하지 않았습니다.')
  })
})

describe('사람이 고치면 edited가 된다', () => {
  it('accepted였어도 고치면 edited다', () => {
    expect(reviewAfterEdit({ state: 'accepted', rubric: {} }).state).toBe('edited')
  })

  it('⛔ 고친 뒤에도 루브릭 판정은 그대로 남는다 — 사람이 다시 본다', () => {
    const next = reviewAfterEdit({
      state: 'accepted',
      rubric: { faithful: 'pass' },
    })
    expect(next.rubric).toEqual({ faithful: 'pass' })
  })
})
