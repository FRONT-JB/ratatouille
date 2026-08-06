import { describe, expect, it } from 'vitest'
import { activeSegmentId, editedCount, isLocked } from './revision'

const segs = [
  { id: 'seg_0', startMs: 0 },
  { id: 'seg_1', startMs: 2120 },
  { id: 'seg_2', startMs: 9740 },
]

describe('⛔ 지금 들리는 말이 어느 줄인지', () => {
  // 재교정의 핵심 동작이다. 소리와 글이 어긋나면 무엇을 고쳐야 할지 알 수 없다.

  it('시작 전에는 첫 줄이다', () => {
    expect(activeSegmentId(segs, 0)).toBe('seg_0')
  })

  it('중간이면 그 줄이다', () => {
    expect(activeSegmentId(segs, 3000)).toBe('seg_1')
  })

  it('마지막 줄을 지나도 마지막 줄이다', () => {
    expect(activeSegmentId(segs, 99999)).toBe('seg_2')
  })

  it('⛔ 세그먼트 사이 빈 구간에서도 강조가 사라지지 않는다', () => {
    // seg_1은 7740ms에 끝나고 seg_2는 9740ms에 시작한다. 그 사이 8000ms는
    // 어느 세그먼트에도 안 들어간다 — `start <= t < end`로 고르면 여기서
    // 강조가 깜빡인다. 깜빡이는 강조는 없는 것만 못하다.
    expect(activeSegmentId(segs, 8000)).toBe('seg_1')
  })

  it('재생 위치를 모르면 아무것도 강조하지 않는다', () => {
    expect(activeSegmentId(segs, null)).toBeNull()
  })

  it('세그먼트가 없으면 null이다', () => {
    expect(activeSegmentId([], 100)).toBeNull()
  })
})

describe('몇 개를 고쳤나', () => {
  it('고친 것만 센다', () => {
    expect(
      editedCount([{ edited: true }, { edited: false }, { edited: true }])
    ).toBe(2)
  })

  it('안 고쳤으면 0이다', () => {
    expect(editedCount([{ edited: false }])).toBe(0)
  })
})

describe('확정하면 잠긴다', () => {
  it('교정 중에는 열려 있다', () => {
    expect(isLocked('transcript_reviewing')).toBe(false)
  })

  it('확정하면 잠긴다 — 고치려면 재교정을 열어야 한다', () => {
    expect(isLocked('transcript_approved')).toBe(true)
  })
})
