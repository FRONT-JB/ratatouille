/**
 * AI 정리 결과의 순수 판정 — Phase 6.
 *
 * ⛔ 여기서 지키는 것은 `review-contract.md`의 계약이다.
 *    · 네 section을 빼거나 합치지 않는다
 *    · 근거는 evidence ID와 timestamp로 **같은 segment에 닿는다**
 *    · 닿지 못하는 근거는 **깨진 링크로 그리지 않는다**
 */

import { describe, expect, it } from 'vitest'
import {
  type DocumentView,
  SECTIONS,
  citationsOf,
  describeRunState,
  footnoteNumbers,
  isRunning,
  isStale,
} from './document'

const SEGMENTS = [
  { id: 'seg_0', startMs: 0, timestamp: '00:00:00', text: '결제 모듈 오픈을 연기합니다.' },
  { id: 'seg_1', startMs: 4120, timestamp: '00:00:04', text: '3월 16일로 하죠.' },
]

const EVIDENCE = [
  { id: 'seg_0', timestamp: '00:00:00', quote: '결제 모듈 오픈을 연기합니다.' },
  { id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' },
]

describe('⛔ 네 section은 고정이다', () => {
  it('회의 요약 / 결정 사항 / Action Item / 원문 근거', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual([
      '회의 요약',
      '결정 사항',
      'Action Item',
      '원문 근거',
    ])
  })

  it('⛔ 다섯 번째 section이 없다 — 주요 논점·열린 질문을 추가하지 않는다', () => {
    expect(SECTIONS.length).toBe(4)
  })

  it('⛔ 화면 이름은 Action Item이고 내부 entity는 tasks다', () => {
    // 둘을 같은 이름으로 만들면 계약 문서와 코드가 서로 다른 말을 하게 된다.
    expect(SECTIONS.find((s) => s.key === 'tasks')!.title).toBe('Action Item')
  })
})

describe('근거 해석', () => {
  it('인용한 ID가 원문 위치로 이어진다', () => {
    const [c] = citationsOf(['seg_1'], EVIDENCE, SEGMENTS)
    expect(c).toEqual({
      id: 'seg_1',
      timestamp: '00:00:04',
      quote: '3월 16일로 하죠.',
      startMs: 4120,
      index: 1,
      resolved: true,
    })
  })

  it('⛔ 재생 위치는 전사 세그먼트에서 가져온다 — timestamp 문자열을 되파싱하지 않는다', () => {
    // `00:00:04`로 되돌리면 120ms를 잃는다. 정확한 값이 바로 옆에 있는데
    // 굳이 초 단위로 깎을 이유가 없다.
    expect(citationsOf(['seg_1'], EVIDENCE, SEGMENTS)[0]!.startMs).toBe(4120)
  })

  it('⛔ 전사에 없는 ID는 resolved가 아니다 — 깨진 링크를 그리지 않는다', () => {
    const [c] = citationsOf(['seg_999'], EVIDENCE, SEGMENTS)
    expect(c!.resolved).toBe(false)
    expect(c!.startMs).toBeNull()
  })

  it('⛔ evidence 배열에 없어도 전사에 있으면 원문에서 채운다', () => {
    // 서버가 evidence를 채우므로 이 경우는 원래 안 생긴다. 그래도 화면이
    // 스스로 서서, 서버가 바뀌어도 근거가 사라지지 않게 한다.
    const [c] = citationsOf(['seg_0'], [], SEGMENTS)
    expect(c!.resolved).toBe(true)
    expect(c!.quote).toBe('결제 모듈 오픈을 연기합니다.')
  })

  it('같은 ID를 두 번 인용해도 한 번만 나온다', () => {
    expect(citationsOf(['seg_0', 'seg_0'], EVIDENCE, SEGMENTS)).toHaveLength(1)
  })

  it('인용 순서를 지킨다 — 읽는 순서가 곧 근거 순서다', () => {
    expect(citationsOf(['seg_1', 'seg_0'], EVIDENCE, SEGMENTS).map((c) => c.id)).toEqual([
      'seg_1',
      'seg_0',
    ])
  })
})

describe('⛔ 각주 번호', () => {
  it('evidence 배열 순서가 곧 번호다', () => {
    const n = footnoteNumbers(EVIDENCE)
    expect(n.get('seg_0')).toBe(1)
    expect(n.get('seg_1')).toBe(2)
  })

  it('⛔ 세그먼트 순서가 아니라 인용 순서다', () => {
    // 서버가 읽는 순서(요약 → 결정 → 할 일)대로 채운다. 화면이 다시 정렬하면
    // 본문 각주와 각주란의 번호가 어긋난다.
    const n = footnoteNumbers([EVIDENCE[1]!, EVIDENCE[0]!])
    expect(n.get('seg_1')).toBe(1)
    expect(n.get('seg_0')).toBe(2)
  })

  it('인용되지 않은 ID에는 번호가 없다', () => {
    expect(footnoteNumbers(EVIDENCE).get('seg_999')).toBeUndefined()
  })
})

describe('실행 상태', () => {
  it('아직 안 만든 것은 도는 중이 아니다', () => {
    expect(isRunning(null)).toBe(false)
  })

  it.each(['queued', 'documenting', 'waiting_for_model'] as const)('%s는 도는 중이다', (s) => {
    expect(isRunning(s)).toBe(true)
  })

  it.each(['proposed', 'failed_retryable', 'auth_required'] as const)(
    '%s는 멈춘 상태다',
    (s) => {
      expect(isRunning(s)).toBe(false)
    }
  )

  it('⛔ 문구는 documentRun 머신에서 가져온다 — 화면이 지어내지 않는다', () => {
    // `queued`는 transcriptionJob에도 있다. 머신을 안 붙이면 "전사 대기"와
    // "정리 대기"가 같은 말이 된다.
    expect(describeRunState('queued').label).toBe('정리 대기 중')
    expect(describeRunState('failed_retryable').label).toContain('정리 실패')
  })
})

describe('⛔ 재교정하면 결과가 오래된 것이 된다', () => {
  const view = (revisionId: string | null): DocumentView => ({
    runId: 'doc_1',
    documentRunState: 'proposed',
    revisionId,
    error: null,
    violations: [],
    elapsedMs: 1000,
    proposal: null,
  })

  it('다른 revision에서 나온 결과는 stale이다', () => {
    expect(isStale(view('rev_1'), 'rev_2')).toBe(true)
  })

  it('같은 revision이면 최신이다', () => {
    expect(isStale(view('rev_2'), 'rev_2')).toBe(false)
  })

  it('결과가 없으면 stale이 아니다 — 없는 것을 오래됐다고 하지 않는다', () => {
    expect(isStale(view(null), 'rev_2')).toBe(false)
  })
})
