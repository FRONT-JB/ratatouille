/**
 * 회의 화면의 **구조** 계약.
 *
 * 배경: 처리 상태·오디오·AI 정리·전사가 한 페이지에 같은 무게로 쌓여서
 * 무엇을 먼저 봐야 하는지 알 수 없었다. 여기서 지키는 것은 취향이 아니라
 * "무엇이 화면의 주인공인가"다.
 *
 * ⛔ 같은 사실을 두 번 말하지 않는다.
 * ⛔ 단계가 지난 정보를 큰 자리에 두지 않는다.
 * ⛔ 눌러도 아무 일도 없는 버튼을 두지 않는다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ProcessingPage } from './index'
import type { SessionSource } from './session'

afterEach(() => vi.restoreAllMocks())

const phrase = (label: string) => ({ label, detail: null, provisional: false })

const SOURCE = (over: Partial<SessionSource> = {}): SessionSource => ({
  sourceId: 'src_01',
  sourceState: 'ready',
  sourcePhrase: phrase('원본 준비됨'),
  chunkCount: 612,
  missing: {},
  captureMode: 'in_person',
  startedAt: '2026-08-06T11:02:00+09:00',
  job: null,
  revisionState: null,
  documentRunState: null,
  nextAction: null,
  ...over,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOB: any = {
  id: 'tr_01',
  sourceId: 'src_01',
  jobState: 'completed',
  phrase: phrase('전사 완료'),
  nextAction: null,
  retryable: true,
  error: null,
  warning: null,
  audioMs: 3081000,
  elapsedMs: 269900,
  segmentCount: 1423,
}

const REVISION = {
  revisionId: 'rev_1',
  sourceId: 'src_01',
  jobId: 'tr_01',
  revisionState: 'transcript_approved',
  approvedAt: 'now',
  segments: [
    {
      id: 'seg_0',
      startMs: 0,
      endMs: 2000,
      timestamp: '00:00:00',
      text: '작성일자 고정하는 내용이었는데요',
      original: '작성일자 고정하는 내용이었는데요',
      edited: false,
    },
  ],
}

const DOCUMENT = {
  runId: 'doc_1',
  documentRunState: 'proposed',
  revisionId: 'rev_1',
  error: null,
  violations: [],
  elapsedMs: 33800,
  proposal: {
    narrative: [
      { heading: '작성일자 제한', body: '선택을 막아두기로 했다[seg_0].' },
    ],
    summary: { text: '작성일자 제한을 검토했다[seg_0].', evidence: ['seg_0'] },
    decisions: [{ what: '선택을 막아두기로 했다[seg_0].', evidence: ['seg_0'] }],
    tasks: [{ action: '라벨을 통일한다[seg_0].', owner: null, due: null, evidence: ['seg_0'] }],
    evidence: [
      { id: 'seg_0', timestamp: '00:00:00', quote: '작성일자 고정하는 내용이었는데요' },
    ],
  },
}

function server(source: SessionSource) {
  return vi.fn(async (url: string) => {
    const body = url.includes('/document')
      ? DOCUMENT
      : url.includes('/revision')
        ? REVISION
        : { sources: [source], inProgress: [] }
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })
}

const setup = async (source: SessionSource) => {
  const screen = await render(
    <ProcessingPage meetingId='src_01' deps={{ fetch: server(source) as never }} />
  )
  await vi.waitFor(() => expect(screen.container.textContent).toContain('08/06'))
  return { screen, text: () => screen.container.textContent ?? '' }
}

const reviewing = () =>
  SOURCE({
    job: JOB,
    revisionState: 'transcript_approved',
    documentRunState: 'proposed',
  })

describe('⛔ 제목은 어느 회의인지 말한다', () => {
  it('시각이 제목이다 — "회의"는 아무것도 말하지 않는다', async () => {
    const { screen } = await setup(SOURCE())
    const h1 = screen.container.querySelector('h1')!
    expect(h1.textContent).toContain('08/06 11:02')
  })

  it('회의를 못 찾았을 때만 대체 제목을 쓴다', async () => {
    const screen = await render(
      <ProcessingPage
        meetingId='없는거'
        deps={{ fetch: server(SOURCE()) as never }}
      />
    )
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-testid=source-missing]')).toBeTruthy()
    )
  })
})

describe('⛔ 같은 사실을 두 번 말하지 않는다', () => {
  it('상태말이 화면에 한 번만 나온다', async () => {
    const { text } = await setup(reviewing())
    const hits = (text().match(/검수 대기/g) ?? []).length
    expect(hits).toBe(1)
  })

  it('⛔ 「전사 확정됨」을 따로 또 적지 않는다 — 상태 배지가 이미 말한다', async () => {
    const { text } = await setup(reviewing())
    expect(text()).not.toContain('전사 확정됨')
  })
})

describe('⛔ 지난 단계 정보는 큰 자리를 차지하지 않는다', () => {
  it('검수 중에는 처리 수치가 본문에 없다', async () => {
    // 「받은 조각 612개」는 결과를 읽는 동안에는 방해다. 전사가 이상할 때만
    // 보므로 전사 원문 패널 안으로 옮겼다.
    const { text } = await setup(reviewing())
    expect(text()).not.toContain('조각 612개')
  })

  it('전사 원문을 열면 부제로 붙어 있다', async () => {
    const { screen } = await setup(reviewing())
    await screen.getByTestId('open-transcript').click()

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid=transcript-drawer]')).toBeTruthy()
    )
    const drawer = document.querySelector('[data-testid=transcript-drawer]')!
    expect(drawer.textContent).toContain('조각 612개')
    expect(drawer.textContent).toContain('세그먼트 1423개')
  })

  it('처리 중에는 처리 화면이 그대로 크게 보인다 — 그때는 그게 전부다', async () => {
    const { screen } = await setup(
      SOURCE({ job: { ...JOB, jobState: 'transcribing' } as never })
    )
    expect(screen.container.querySelector('[data-testid=processing-status]')).toBeTruthy()
  })
})

describe('⛔ 눌러도 아무 일도 없는 버튼을 두지 않는다', () => {
  it('검수 중에는 「검수하기」 버튼이 없다 — 이미 검수 화면이다', async () => {
    // nextAction이 `open_document_review`인데 처리하는 곳이 없었다.
    const { screen } = await setup(reviewing())
    expect(
      screen.container.querySelector('[data-testid=next-action-open_document_review]')
    ).toBeNull()
  })

  it('⛔ 처리 화면 자체가 검수 단계에서는 없다', async () => {
    const { screen } = await setup(reviewing())
    expect(screen.container.querySelector('[data-testid=processing-status]')).toBeNull()
  })

  it('전사 전에는 「전사 시작」이 살아 있다', async () => {
    const { screen } = await setup(
      SOURCE({ nextAction: { kind: 'start_transcription', label: '전사 시작' } })
    )
    expect(
      screen.container.querySelector('[data-testid=next-action-start_transcription]')
    ).toBeTruthy()
  })
})

describe('⛔ 읽는 글이 화면에서 가장 작은 글씨면 안 된다', () => {
  const readable = async () => {
    const { screen } = await setup(reviewing())
    return screen.container.querySelector('[data-section=narrative] p')!
  }

  it('회의 내용이 본문 크기다', async () => {
    expect(getComputedStyle(await readable()).fontSize).toBe('16px')
  })

  it('section 제목은 본문보다 작다 — 라벨이지 읽을 글이 아니다', async () => {
    const { screen } = await setup(reviewing())
    const label = screen.container.querySelector('[data-section=decisions] h3')!
    expect(parseFloat(getComputedStyle(label).fontSize)).toBeLessThan(16)
  })

  it('⛔ 본문 줄이 화면 폭을 따라 무한정 넓어지지 않는다', async () => {
    // 셸이 `max-w-5xl`로 잡아준다. 한글 58자 남짓이라 읽을 수 있는 범위다.
    expect((await readable()).getBoundingClientRect().width).toBeLessThan(1000)
  })
})
