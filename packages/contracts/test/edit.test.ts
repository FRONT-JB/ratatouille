/**
 * 사람이 결과를 고친다 — PLAN.md 순서 5, Test 6.5의 전제.
 *
 * ⛔ **고칠 수 없으면 검수는 반쪽이다.** 지금까지는 「수정 필요」로 표시만 할 수
 *    있었고, 그 표시가 확정을 영원히 막았다. Phase 0 결함 B(제안을 결정으로
 *    승격)의 유일한 시정은 **그 항목을 지우는 것**인데, 지울 수가 없었다.
 *
 * ⛔ **사람의 편집도 근거를 지어낼 수 없다.** 모델에 강제한 부분집합 규칙
 *    (결함 A)이 사람 손에서 뚫리면, 규칙이 있는 이유가 사라진다.
 */

import { describe, expect, it } from 'vitest'
import {
  type DocumentProposal,
  type ProposalEdit,
  RuleViolationError,
  applyEdit,
  editedSection,
} from '../src/index.ts'

const BASE: DocumentProposal = {
  narrative: [{ heading: '오픈 일정', body: '길게 논의했다[seg_0].' }],
  summary: { text: '오픈을 연기했다[seg_0].', evidence: ['seg_0'] },
  decisions: [
    { what: '3월 16일로 연기[seg_1].', evidence: ['seg_1'] },
    { what: '앞으로도 이쁘게 만나기로[seg_2].', evidence: ['seg_2'] },
  ],
  tasks: [{ action: '고객사에 공지한다[seg_1].', owner: null, due: null, evidence: ['seg_1'] }],
  evidence: [
    { id: 'seg_0', timestamp: '00:00:00', quote: '오픈을 연기합니다.' },
    { id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' },
    { id: 'seg_2', timestamp: '00:00:09', quote: '앞으로도 이쁘게 만나자.' },
  ],
}

const apply = (edit: ProposalEdit) => applyEdit(BASE, edit)

const ruleOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof RuleViolationError) return e.rule
    throw e
  }
  throw new Error('규칙 위반이 나지 않았다')
}

describe('무엇을 고쳤나', () => {
  it('편집은 자기 section을 안다 — 그 section이 「고침」이 된다', () => {
    expect(editedSection({ section: 'summary', kind: 'text', text: 'x[seg_0]' })).toBe('summary')
    expect(editedSection({ section: 'tasks', kind: 'owner', index: 0, value: '이한결' })).toBe('tasks')
  })
})

describe('고친다', () => {
  it('회의 요약 본문을 바꾼다', () => {
    const next = apply({ section: 'summary', kind: 'text', text: '오픈을 미뤘다[seg_0].' })
    expect(next.summary.text).toBe('오픈을 미뤘다[seg_0].')
  })

  it('회의 내용의 한 주제를 바꾼다', () => {
    const next = apply({ section: 'summary', kind: 'narrative', index: 0, body: '짧게 봤다[seg_0].' })
    expect(next.narrative?.[0]?.body).toBe('짧게 봤다[seg_0].')
  })

  it('결정 사항 한 줄을 바꾼다', () => {
    const next = apply({ section: 'decisions', kind: 'text', index: 0, text: '3월 17일로 연기[seg_1].' })
    expect(next.decisions[0]?.what).toContain('3월 17일')
    expect(next.decisions[1]?.what).toBe(BASE.decisions[1]?.what)
  })

  it('⛔ 결정 사항을 지울 수 있다 — 제안을 결정으로 뽑은 것을 되돌리는 유일한 방법', () => {
    // Phase 0 결함 B: seg151 "우리 앞으로도 이쁘게 만나자"는 제안인데 결정으로 뽑혔다.
    const next = apply({ section: 'decisions', kind: 'remove', index: 1 })
    expect(next.decisions).toHaveLength(1)
    expect(next.decisions[0]?.what).toContain('3월 16일')
  })

  it('Action Item의 담당자와 기한을 사람이 채운다', () => {
    // 화자 분리를 접었으므로 모델은 「제가 하겠습니다」의 주인을 모른다.
    const owned = apply({ section: 'tasks', kind: 'owner', index: 0, value: '이한결' })
    expect(owned.tasks[0]?.owner).toBe('이한결')
    const dated = apply({ section: 'tasks', kind: 'due', index: 0, value: '3월 2일' })
    expect(dated.tasks[0]?.due).toBe('3월 2일')
  })

  it('담당자를 다시 비울 수 있다 — 잘못 지정했을 수도 있다', () => {
    const next = applyEdit(
      apply({ section: 'tasks', kind: 'owner', index: 0, value: '이한결' }),
      { section: 'tasks', kind: 'owner', index: 0, value: null }
    )
    expect(next.tasks[0]?.owner).toBeNull()
  })

  it('⛔ 담당자를 「미입력」이라는 이름으로 저장하지 않는다', () => {
    const next = apply({ section: 'tasks', kind: 'owner', index: 0, value: '  ' })
    // 화면에 보이는 말이지 데이터가 아니다. 그런 이름의 사람과 구분되지 않는다.
    expect(next.tasks[0]?.owner).toBeNull()
  })
})

describe('⛔ 원본을 흔들지 않는다', () => {
  it('편집은 새 객체를 만든다 — 받은 것을 고치지 않는다', () => {
    const before = JSON.stringify(BASE)
    apply({ section: 'decisions', kind: 'remove', index: 0 })
    expect(JSON.stringify(BASE)).toBe(before)
  })

  it('⛔ 항목을 지워도 근거 배열은 그대로다 — 각주 번호가 흔들리면 안 된다', () => {
    // 각주 번호는 evidence 배열 순서다. 여기서 하나 빠지면 남은 항목의
    // 각주가 전부 다른 발언을 가리키게 된다.
    const next = apply({ section: 'decisions', kind: 'remove', index: 1 })
    expect(next.evidence.map((e) => e.id)).toEqual(['seg_0', 'seg_1', 'seg_2'])
  })

  it('⛔ 원문 근거는 사람이 고치지 않는다 — 전사문에서 온 사실이다', () => {
    expect(
      ruleOf(() =>
        applyEdit(BASE, { section: 'evidence', kind: 'text', index: 0, text: '아무거나' } as never)
      )
    ).toBe('edit-section-not-editable')
  })
})

describe('⛔ 사람의 편집도 근거를 지어낼 수 없다', () => {
  it('없는 근거를 인용하면 거절한다', () => {
    expect(
      ruleOf(() => apply({ section: 'summary', kind: 'text', text: '지어냈다[seg_99].' }))
    ).toBe('edit-cites-unknown-evidence')
  })

  it('어느 근거가 문제인지 말해준다', () => {
    try {
      apply({ section: 'decisions', kind: 'text', index: 0, text: '고침[seg_99].' })
    } catch (e) {
      expect((e as Error).message).toContain('seg_99')
    }
  })

  it('있는 근거로 옮겨 다는 것은 된다', () => {
    const next = apply({ section: 'summary', kind: 'text', text: '오픈을 미뤘다[seg_1].' })
    expect(next.summary.evidence).toEqual(['seg_1'])
  })

  it('⛔ 인용이 있던 항목의 인용을 전부 지울 수 없다', () => {
    // 근거 없는 문장이 남으면 그건 회의록이 아니라 메모다.
    expect(
      ruleOf(() => apply({ section: 'decisions', kind: 'text', index: 0, text: '그냥 연기.' }))
    ).toBe('edit-drops-evidence')
  })

  it('본문의 마커가 그 항목의 근거 배열이 된다', () => {
    const next = apply({
      section: 'decisions',
      kind: 'text',
      index: 0,
      text: '3월 16일로 연기[seg_1]. 이유는 이렇다[seg_0].',
    })
    expect(next.decisions[0]?.evidence).toEqual(['seg_1', 'seg_0'])
  })
})

describe('⛔ 빈 것으로 만들지 않는다', () => {
  it('본문을 빈 문자열로 바꿀 수 없다', () => {
    expect(ruleOf(() => apply({ section: 'summary', kind: 'text', text: '   ' }))).toBe(
      'edit-empty-text'
    )
  })

  it('결정을 지우려면 삭제를 쓴다 — 빈 줄로 남기지 않는다', () => {
    expect(
      ruleOf(() => apply({ section: 'decisions', kind: 'text', index: 0, text: '' }))
    ).toBe('edit-empty-text')
  })
})

describe('⛔ 없는 항목을 고치지 않는다', () => {
  it('범위 밖 index를 거절한다', () => {
    expect(ruleOf(() => apply({ section: 'tasks', kind: 'remove', index: 7 }))).toBe(
      'edit-index-out-of-range'
    )
  })

  it('회의 내용이 없는 예전 결과에 narrative 편집이 오면 거절한다', () => {
    const old = { ...BASE, narrative: undefined }
    expect(
      ruleOf(() => applyEdit(old, { section: 'summary', kind: 'narrative', index: 0, body: 'x[seg_0]' }))
    ).toBe('edit-index-out-of-range')
  })
})
