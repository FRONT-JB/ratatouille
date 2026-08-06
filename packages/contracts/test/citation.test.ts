/**
 * 본문 안 근거 마커.
 *
 * ⛔ **서버와 화면이 같은 형식을 알아야 한다.** 서버는 프롬프트로 이 형식을
 *    요구하고 마커를 뽑아 `evidence` 배열을 만들며, 화면은 같은 형식을 잘라
 *    각주 번호로 그린다. 두 곳이 각자 정규식을 들고 있으면 반드시 어긋난다.
 */

import { describe, expect, it } from 'vitest'
import { citedIdsIn, splitCitations, stripCitations } from '../src/citation.ts'

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
