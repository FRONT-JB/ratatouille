import { describe, expect, it } from 'vitest'
import type { SessionSource } from './session'
import { badgeFor, labelFor, toMeetingItems } from './use-meetings'

const phrase = (label: string) => ({ label, detail: null, provisional: false })

const src = (over: Partial<SessionSource> = {}): SessionSource => ({
  sourceId: 'src_01',
  sourceState: 'ready',
  sourcePhrase: phrase('원본 준비됨'),
  chunkCount: 3,
  missing: {},
  captureMode: 'in_person',
  startedAt: '2026-08-06T09:54:12.777Z',
  job: null,
  nextAction: null,
  ...over,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const job = (state: string): any => ({
  id: 'tr_01',
  sourceId: 'src_01',
  jobState: state,
  phrase: phrase('x'),
  nextAction: null,
  retryable: true,
  error: null,
  warning: null,
  audioMs: null,
  elapsedMs: null,
  segmentCount: 7,
})

describe('⛔ 교정하지 않은 회의도 목록에 나온다', () => {
  // 실제로 겪은 결함: 전사가 끝난 회의 2건이 있는데 사이드바는
  // "아직 회의가 없습니다"였다. 진입 시점에 무엇이 있는지 알 방법이 없었다.

  it('전사 전 회의도 나온다', () => {
    expect(toMeetingItems([src({ job: null })]).length).toBe(1)
  })

  it('전사만 끝나고 교정 안 한 회의도 나온다', () => {
    const items = toMeetingItems([src({ job: job('completed') })])
    expect(items.length).toBe(1)
    expect(items[0]!.badge).toBe('교정 전')
  })

  it('수집이 덜 끝난 회의도 나온다 — 숨기면 재개할 방법이 없다', () => {
    const items = toMeetingItems([src({ sourceState: 'finalizing' })])
    expect(items[0]!.badge).toBe('수집 중')
  })

  it('여러 건이 전부 나온다', () => {
    expect(toMeetingItems([src(), src({ sourceId: 'src_02' })]).length).toBe(2)
  })

  it('최근 것이 위로 온다', () => {
    const items = toMeetingItems([src({ sourceId: 'a' }), src({ sourceId: 'b' })])
    expect(items.map((i) => i.sourceId)).toEqual(['b', 'a'])
  })
})

describe('상태말', () => {
  it.each([
    ['queued', '대기'],
    ['transcribing', '전사 중'],
    ['completed', '교정 전'],
    ['failed_retryable', '실패'],
  ])('job이 %s면 "%s"', (state, expected) => {
    expect(badgeFor(src({ job: job(state) }))).toBe(expected)
  })

  it('job이 없으면 "전사 전"', () => {
    expect(badgeFor(src({ job: null }))).toBe('전사 전')
  })

  it('⛔ 전사 완료를 "완료"로 부르지 않는다 — 교정이 남았다', () => {
    // "완료"라고 쓰면 더 할 일이 없다고 읽힌다. 실제로는 교정·정리가 남았다.
    expect(badgeFor(src({ job: job('completed') }))).not.toContain('완료')
  })

  it('모든 상태에 한국어 말이 있다', () => {
    for (const s of ['queued', 'transcribing', 'completed', 'failed_retryable']) {
      expect(badgeFor(src({ job: job(s) }))).toMatch(/[가-힣]/)
    }
  })
})

describe('이름', () => {
  it('⛔ id를 그대로 쓰지 않는다 — 사람이 읽을 수 없다', () => {
    const label = labelFor(src({ sourceId: 'src_msgszcix' }))
    expect(label).not.toBe('src_msgszcix')
    expect(label).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
  })

  it('시작 시각이 없으면 id로 떨어진다 — 빈 이름을 만들지 않는다', () => {
    expect(labelFor(src({ startedAt: null }))).toBe('src_01')
  })

  it('망가진 시각도 id로 떨어진다', () => {
    expect(labelFor(src({ startedAt: '깨짐' }))).toBe('src_01')
  })
})
