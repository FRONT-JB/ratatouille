/**
 * 좁은 화면 — PLAN.md 순서 6 「좁은 화면 가로 잘림」.
 *
 * ⛔ **가로로 넘치면 안 된다.** 넘치는 순간 사용자는 좌우로 흔들며 읽게 되고,
 *    잘린 쪽은 아예 못 본다. 이건 취향이 아니라 읽을 수 있느냐의 문제다.
 *
 * ⛔ **기능을 잘라내지 않는다.** 좁다고 검수 버튼이나 각주를 없애면, 폰에서는
 *    확정할 수 없는 앱이 된다.
 */

import { page } from '@vitest/browser/context'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentResult } from './document-result'
import { ReviewPage } from './index'
import type { DocumentView } from './document'

/** iPhone 13 mini 세로. 요즘 폰 중 좁은 축이다 */
const PHONE = { width: 375, height: 812 }

beforeEach(() => page.viewport(PHONE.width, PHONE.height))
afterEach(() => {
  vi.restoreAllMocks()
  page.viewport(1440, 900)
})

const SEGMENTS = [
  {
    id: 'seg_0',
    startMs: 0,
    endMs: 4000,
    timestamp: '00:00:00',
    text: '결제 모듈 오픈을 연기합니다.',
    original: '결제 모듈 오픈을 연기합니다.',
    edited: false,
  },
]

const VIEW: DocumentView = {
  runId: 'doc_1',
  documentRunState: 'proposed',
  revisionId: 'rev_1',
  error: null,
  violations: [],
  elapsedMs: 43279,
  proposal: {
    narrative: [
      {
        heading: '결제 모듈 오픈 일정과 후속 처리',
        body: '오픈 일정을 두고 길게 논의했고 결국 미루기로 했다[seg_0].',
      },
    ],
    summary: { text: '오픈을 연기했다[seg_0].', evidence: ['seg_0'] },
    decisions: [{ what: '오픈을 3월 16일로 연기하기로 했다[seg_0].', evidence: ['seg_0'] }],
    tasks: [
      {
        action: '고객사에 일정 변경을 공지한다[seg_0].',
        owner: null,
        due: null,
        evidence: ['seg_0'],
      },
    ],
    evidence: [
      { id: 'seg_0', timestamp: '00:00:00', quote: '결제 모듈 오픈을 연기합니다.' },
    ],
  },
}

const setup = async () =>
  render(
    <DocumentResult
      view={VIEW}
      error={null}
      revisionId='rev_1'
      segments={SEGMENTS}
      onSeek={vi.fn()}
      onPlay={vi.fn()}
      onOpenTranscript={vi.fn()}
      onRetry={vi.fn()}
      onReview={vi.fn()}
      onEdit={vi.fn()}
    />
  )

/** 가로로 넘쳤나. 스크롤 폭이 화면보다 크면 넘친 것이다 */
const overflowed = () =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth

describe('⛔ 좁은 화면에서 가로로 넘치지 않는다', () => {
  it('결과 화면이 화면 폭 안에 들어온다', async () => {
    await setup()
    expect(overflowed()).toBe(false)
  })

  it('⛔ 각주 팝오버가 화면을 넘지 않는다', async () => {
    const screen = await setup()
    await screen.getByRole('button', { name: /근거 1/ }).first().click()
    await expect.element(screen.getByTestId('footnote-card')).toBeInTheDocument()

    const card = document.querySelector('[data-testid=footnote-card]')!
    expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(PHONE.width)
    expect(overflowed()).toBe(false)
  })

  it('⛔ 루브릭 메뉴가 화면을 넘지 않는다', async () => {
    const screen = await setup()
    await screen.getByTestId('rubric-decisions').click()
    await expect
      .element(screen.getByText('실제 결정과 단순 제안·논의가 구분됐는가?'))
      .toBeInTheDocument()

    const menu = document.querySelector('[role=menu]')!
    expect(menu.getBoundingClientRect().width).toBeLessThanOrEqual(PHONE.width)
  })
})

describe('⛔ 조작 줄이 좁은 화면에서 어정쩡하게 갈라지지 않는다', () => {
  const REVISION = {
    revisionId: 'rev_1',
    sourceId: 'src_01',
    jobId: 'tr_1',
    revisionState: 'transcript_approved' as const,
    approvedAt: 'now',
    segments: SEGMENTS,
  }

  const server = () =>
    vi.fn(async (url: string) => {
      const body = url.includes('/document') ? VIEW : REVISION
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })

  it('폰에서는 오른쪽 조작이 한 줄을 통째로 쓴다', async () => {
    const screen = await render(
      <ReviewPage sourceId='src_01' deps={{ fetch: server() as never }} />
    )
    await expect.element(screen.getByTestId('more-actions')).toBeInTheDocument()

    const toolbar = screen.container
      .querySelector('[data-testid=open-transcript]')!
      .closest('div')!
    const group = screen.container.querySelector('[data-testid=more-actions]')!
      .closest('div')!
    // 남은 폭에 밀려 어중간하게 뜨지 않고 왼쪽에서 시작한다
    expect(Math.round(group.getBoundingClientRect().left)).toBe(
      Math.round(toolbar.getBoundingClientRect().left)
    )
  })
})

describe('⛔ 좁다고 기능을 잘라내지 않는다', () => {
  it('검수 버튼이 폰에서도 있다 — 없으면 폰에서는 확정할 수 없다', async () => {
    const screen = await setup()
    expect(screen.container.querySelector('[data-testid=accept-decisions]')).toBeTruthy()
  })

  it('각주가 폰에서도 눌린다', async () => {
    const screen = await setup()
    const mark = screen.container.querySelector('sup button[data-cite]')!
    const box = mark.getBoundingClientRect()
    // ⛔ 손가락으로 누를 수 있어야 한다. 높이 0이면 못 누른다
    expect(box.height).toBeGreaterThan(0)
    expect(box.width).toBeGreaterThan(0)
  })

  it('탭 두 개가 모두 보인다', async () => {
    const screen = await setup()
    for (const name of ['회의 내용', '요약']) {
      await expect.element(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })
})
