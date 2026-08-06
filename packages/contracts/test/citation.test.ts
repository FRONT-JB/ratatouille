/**
 * 본문 안 근거 마커.
 *
 * ⛔ **서버와 화면이 같은 형식을 알아야 한다.** 서버는 프롬프트로 이 형식을
 *    요구하고 마커를 뽑아 `evidence` 배열을 만들며, 화면은 같은 형식을 잘라
 *    각주 번호로 그린다. 두 곳이 각자 정규식을 들고 있으면 반드시 어긋난다.
 */

import { describe, expect, it } from 'vitest'
import {
  citedIdsIn,
  footnoteNumbers,
  splitCitations,
  stripCitations,
  toMarkdownFootnotes,
} from '../src/citation.ts'

describe('마커 뽑기', () => {
  it('문장 안의 ID를 순서대로 뽑는다', () => {
    expect(citedIdsIn('작성일자 제한[seg_33], 청구 옵션[seg_41]을 검토했다.')).toEqual([
      'seg_33',
      'seg_41',
    ])
  })

  it('같은 ID를 두 번 인용해도 한 번만 센다', () => {
    expect(citedIdsIn('앞[seg_1] 뒤[seg_1]')).toEqual(['seg_1'])
  })

  it('마커가 없으면 빈 배열이다', () => {
    expect(citedIdsIn('근거 없는 문장')).toEqual([])
  })

  it('⛔ 세그먼트 ID 모양이 아닌 대괄호는 마커가 아니다', () => {
    // 전사문에 `[웃음]` 같은 표기가 섞여 들어와도 근거로 오해하지 않는다.
    expect(citedIdsIn('그래서 [웃음] 넘어갔다[seg_9]')).toEqual(['seg_9'])
  })
})

describe('본문 자르기', () => {
  it('글과 마커가 순서대로 나뉜다', () => {
    expect(splitCitations('앞[seg_1] 뒤')).toEqual([
      { kind: 'text', text: '앞' },
      { kind: 'cite', id: 'seg_1' },
      { kind: 'text', text: ' 뒤' },
    ])
  })

  it('마커로 시작해도 빈 조각을 만들지 않는다', () => {
    expect(splitCitations('[seg_1]뒤')).toEqual([
      { kind: 'cite', id: 'seg_1' },
      { kind: 'text', text: '뒤' },
    ])
  })

  it('마커가 없으면 글 한 덩어리다', () => {
    expect(splitCitations('그냥 문장')).toEqual([{ kind: 'text', text: '그냥 문장' }])
  })

  it('빈 문자열은 아무 조각도 만들지 않는다', () => {
    expect(splitCitations('')).toEqual([])
  })
})

describe('마커 없는 본문', () => {
  it('⛔ Markdown·검색처럼 각주를 그릴 수 없는 곳을 위해 뗄 수 있다', () => {
    expect(stripCitations('작성일자 제한[seg_33]을 검토했다.')).toBe(
      '작성일자 제한을 검토했다.'
    )
  })

  it('마커 앞의 공백을 남기지 않는다', () => {
    expect(stripCitations('검토했다 [seg_1].')).toBe('검토했다.')
  })
})

/**
 * 각주 번호와 Markdown 변환.
 *
 * ⛔ **화면·회의록·결정 파일이 각자 구현하고 있었다.** 셋이 같은 규칙을 따로
 *    들고 있으면 한 곳만 고쳐지는 날이 오고, 그때 본문 각주와 「원문 근거」란의
 *    번호가 어긋난다. 어긋난 각주는 근거가 아니라 오답이다.
 */
describe('각주 번호', () => {
  const EVIDENCE = [{ id: 'seg_5' }, { id: 'seg_1' }, { id: 'seg_9' }]

  it('⛔ 배열 순서가 곧 번호다 — ID 순서가 아니다', () => {
    const n = footnoteNumbers(EVIDENCE)
    expect(n.get('seg_5')).toBe(1)
    expect(n.get('seg_1')).toBe(2)
    expect(n.get('seg_9')).toBe(3)
  })

  it('없는 ID는 번호가 없다', () => {
    expect(footnoteNumbers(EVIDENCE).get('seg_999')).toBeUndefined()
  })

  it('빈 배열도 받는다 — 근거 없는 결과가 터지면 안 된다', () => {
    expect(footnoteNumbers([]).size).toBe(0)
  })
})

describe('Markdown 각주로 바꾸기', () => {
  const numbers = footnoteNumbers([{ id: 'seg_5' }, { id: 'seg_1' }])

  it('마커가 각주 번호가 된다', () => {
    expect(toMarkdownFootnotes('연기했다[seg_5].', numbers)).toBe('연기했다[^1].')
  })

  it('한 문장에 여럿이 있어도 각자 번호를 받는다', () => {
    expect(toMarkdownFootnotes('연기[seg_5]하고 공지[seg_1]한다.', numbers)).toBe(
      '연기[^1]하고 공지[^2]한다.'
    )
  })

  it('⛔ 번호표에 없는 ID는 마커를 지우기만 한다 — 빈 각주는 거짓말이다', () => {
    // 정의 없는 `[^3]`을 남기면 Obsidian에서 빈 링크가 된다.
    expect(toMarkdownFootnotes('지어냈다[seg_99].', numbers)).toBe('지어냈다.')
  })

  it('마커가 없으면 본문 그대로다', () => {
    expect(toMarkdownFootnotes('그냥 문장', numbers)).toBe('그냥 문장')
  })
})
