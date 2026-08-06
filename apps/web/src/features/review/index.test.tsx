/**
 * 페이지 B 화면 계약 — Phase 5.
 *
 * ⛔ 여기서 지키는 것은 취향이 아니라 계약이다.
 *    · 전사 확정 전에는 AI 결과를 **생성하지도 표시하지도** 않는다
 *    · 재생 영역은 **오디오**다. 영상 player가 아니다
 *    · 녹음 화면과 결과 화면이 한 페이지로 합쳐져 있지 않다
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ReviewPage } from './index'
import type { RevisionView } from './revision'

afterEach(() => vi.restoreAllMocks())

const REVISION = (over: Partial<RevisionView> = {}): RevisionView => ({
  revisionId: 'rev_src_01_1',
  sourceId: 'src_01',
  jobId: 'tr_src_01_1',
  revisionState: 'transcript_reviewing',
  approvedAt: null,
  segments: [
    {
      id: 'seg_0',
      startMs: 0,
      endMs: 2120,
      timestamp: '00:00:00',
      text: '미경험 엔지니어라고 해서',
      original: '미경험 엔지니어라고 해서',
      edited: false,
    },
    {
      id: 'seg_1',
      startMs: 2120,
      endMs: 7740,
      timestamp: '00:00:02',
      text: '아예 아무것도 모르는 사람도 채용을 해요.',
      original: '아예 아무것도 모르는 사람도 채용을 해요.',
      edited: false,
    },
  ],
  ...over,
})

/** 아직 정리하지 않은 상태 */
const NO_DOCUMENT = { documentRunState: null, proposal: null }

/** 정리가 끝난 상태. 근거는 문장 안에 있다 */
const WITH_DOCUMENT = {
  runId: 'doc_1',
  documentRunState: 'proposed',
  revisionId: 'rev_src_01_1',
  error: null,
  violations: [],
  elapsedMs: 1000,
  proposal: {
    summary: { text: '미경험 엔지니어도 채용한다[seg_1].', evidence: ['seg_1'] },
    decisions: [],
    tasks: [],
    evidence: [
      { id: 'seg_1', timestamp: '00:00:02', quote: '아예 아무것도 모르는 사람도 채용을 해요.' },
    ],
  },
}

/** 서버 대역. PATCH는 보낸 텍스트를 반영해 돌려준다 — 실제 서버와 같게. */
function server(initial = REVISION(), document: unknown = NO_DOCUMENT) {
  let state = initial
  const calls: { url: string; method: string; body?: unknown }[] = []

  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })

    // AI 정리는 별도 자원이다. 교정본 응답을 그대로 돌려주면 화면이 이상한
    // 상태를 그리고, 무엇이 깨졌는지 알 수 없게 된다.
    if (url.includes('/document')) {
      return {
        ok: true,
        status: 200,
        json: async () => document,
      } as unknown as Response
    }

    if (method === 'PATCH') {
      const patches = new Map(
        (body.segments as { id: string; text: string }[]).map((s) => [s.id, s.text])
      )
      state = {
        ...state,
        segments: state.segments.map((s) =>
          patches.has(s.id)
            ? { ...s, text: patches.get(s.id)!, edited: patches.get(s.id) !== s.original }
            : s
        ),
      }
    }
    if (url.endsWith('/approve')) {
      state = { ...state, revisionState: 'transcript_approved', approvedAt: 'now' }
    }
    if (url.endsWith('/reopen')) {
      state = { ...state, revisionState: 'transcript_reviewing', approvedAt: null }
    }
    return {
      ok: true,
      status: 200,
      json: async () => state,
    } as unknown as Response
  })

  return { fetchFn, calls, get state() { return state } }
}

const setup = async (s = server()) => {
  const screen = await render(
    <ReviewPage sourceId='src_01' deps={{ fetch: s.fetchFn as never, saveDelayMs: 20 }} />
  )
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[data-testid=review-layout]')).toBeTruthy()
  )
  return { screen, ...s }
}

describe('⛔ 전사 확정 전에는 AI 결과가 잠겨 있다', () => {
  it('왼쪽이 잠금 상태다', async () => {
    const { screen } = await setup()
    expect(screen.container.querySelector('[data-testid=ai-locked]')).toBeTruthy()
  })

  it('무엇을 하면 열리는지 말한다 — 빈 자리를 두지 않는다', async () => {
    const { screen } = await setup()
    expect(screen.container.textContent).toContain('전사 확정 후 생성')
  })

  it('⛔ AI 결과를 가져오는 요청이 하나도 없다', async () => {
    const { calls } = await setup()
    // 확정 전에 결과를 fetch하면 그 자체로 계약 위반이다.
    const forbidden = calls.filter((c) =>
      /document|summary|proposed|action/i.test(c.url)
    )
    expect(forbidden).toEqual([])
  })

  it('확정하면 잠금이 풀린다', async () => {
    const { screen } = await setup()
    await screen.getByTestId('approve-transcript').click()

    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-testid=ai-result]')).toBeTruthy()
    )
  })

  it('⛔ 확정 전에는 결과 영역을 마운트조차 하지 않는다', async () => {
    // 마운트하면 그 자리에서 조회하고, 조회 자체가 계약 위반이다.
    const { screen } = await setup()
    expect(screen.container.querySelector('[data-testid=ai-result]')).toBeNull()
  })
})

describe('⛔ 화면 계약', () => {
  it('재생 영역이 오디오다 — 영상 player가 아니다', async () => {
    const { screen } = await setup()
    expect(screen.container.querySelector('audio')).toBeTruthy()
    expect(screen.container.querySelector('video')).toBeNull()
  })

  it('결과 영역과 교정 영역이 좌우로 나뉜다', async () => {
    const { screen } = await setup()
    const layout = screen.container.querySelector('[data-testid=review-layout]')!
    expect(layout.className).toContain('grid')
  })

  it('⛔ 녹음 조작이 이 화면에 없다 — 두 화면이 합쳐지지 않았다', async () => {
    const { screen } = await setup()
    const text = screen.container.textContent ?? ''
    for (const word of ['녹음 시작', '녹음 중', '탭 오디오 공유']) {
      expect(text).not.toContain(word)
    }
  })
})

describe('교정', () => {
  it('문장을 고치면 화면에 바로 반영된다', async () => {
    const { screen } = await setup()
    const box = screen.container.querySelectorAll('textarea')[0] as HTMLTextAreaElement

    await screen.getByRole('textbox', { name: '00:00:00 전사 내용' }).fill('고친 문장')

    expect(box.value).toBe('고친 문장')
  })

  it('입력이 멈추면 저장한다 — 타이핑마다 보내지 않는다', async () => {
    const { screen, calls } = await setup()
    await screen.getByRole('textbox', { name: '00:00:00 전사 내용' }).fill('고친 문장')

    await vi.waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').length).toBe(1)
    )
    expect(calls.at(-1)!.body).toEqual({
      segments: [{ id: 'seg_0', text: '고친 문장' }],
    })
  })

  it('저장되면 화면이 알려준다', async () => {
    const { screen } = await setup()
    await screen.getByRole('textbox', { name: '00:00:00 전사 내용' }).fill('x')

    await expect.element(screen.getByText('저장됨')).toBeInTheDocument()
  })

  it('⛔ 고친 줄에 원문이 남는다 — 무엇을 바꿨는지 보여야 한다', async () => {
    const { screen } = await setup()
    await screen.getByRole('textbox', { name: '00:00:00 전사 내용' }).fill('완전히 다른 말')

    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-testid=original-text]')).toBeTruthy()
    )
    expect(
      screen.container.querySelector('[data-testid=original-text]')!.textContent
    ).toBe('미경험 엔지니어라고 해서')
  })

  it('⛔ 저장이 실패하면 숨기지 않는다', async () => {
    const s = server()
    const original = s.fetchFn
    let first = true
    const failing = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH' && first) {
        first = false
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: '디스크가 가득 찼습니다' }),
        } as unknown as Response
      }
      return original(url, init)
    })
    const { screen } = await setup({ ...s, fetchFn: failing as never })

    await screen.getByRole('textbox', { name: '00:00:00 전사 내용' }).fill('x')

    // ⚠️ `getByRole('alert')`으로 기다리면 안 된다. 테스트 환경에는 실제
    //    오디오가 없어서 재생기 오류 alert이 **이미** 떠 있고, 그것이 즉시
    //    통과해버린다. 저장 실패 문구 자체를 기다린다.
    await expect
      .element(screen.getByText(/디스크가 가득 찼습니다/))
      .toBeInTheDocument()
  })
})

describe('⛔ 확정하면 잠긴다', () => {
  it('확정 후에는 편집기가 없다', async () => {
    const { screen } = await setup()
    await screen.getByTestId('approve-transcript').click()

    await vi.waitFor(() =>
      expect(screen.container.querySelectorAll('textarea').length).toBe(0)
    )
  })

  it('재교정 길이 있다 — ⋮ 안이지만 한 번에 닿는다', async () => {
    const { screen } = await setup()
    await screen.getByTestId('approve-transcript').click()
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-testid=more-actions]')).toBeTruthy()
    )
    await screen.getByTestId('more-actions').click()

    await expect
      .element(screen.getByRole('menuitem', { name: '전사 수정' }))
      .toBeInTheDocument()
  })

  it('⛔ 확정 직전 편집이 확정본에 들어간다', async () => {
    // 순서가 뒤바뀌면 마지막에 고친 문장이 확정본에서 빠진다.
    const { screen, calls } = await setup()
    await screen.getByRole('textbox', { name: '00:00:00 전사 내용' }).fill('마지막 교정')
    await screen.getByTestId('approve-transcript').click()

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/approve'))).toBe(true)
    )
    const patchIdx = calls.findIndex((c) => c.method === 'PATCH')
    const approveIdx = calls.findIndex((c) => c.url.endsWith('/approve'))
    expect(patchIdx).toBeGreaterThanOrEqual(0)
    expect(patchIdx).toBeLessThan(approveIdx)
  })
})

describe('⛔ AI 정리 조작은 한 줄에 있다', () => {
  const approvedWith = async (document: unknown) => {
    const s = server(REVISION(), document)
    const r = await setup(s)
    await r.screen.getByTestId('approve-transcript').click()
    await vi.waitFor(() =>
      expect(r.screen.container.querySelector('[data-testid=ai-result]')).toBeTruthy()
    )
    return r
  }

  it('⛔ 자동으로 만들지 않는다 — 사용자가 시작한다', async () => {
    const { calls } = await approvedWith(NO_DOCUMENT)
    expect(calls.filter((c) => c.url.includes('/document') && c.method === 'POST')).toEqual(
      []
    )
  })

  it('⛔ 주 조작은 하나다 — 나머지는 ⋮ 안에 있다', async () => {
    // 넷을 나란히 두면 이 화면이 무엇을 하는 곳인지 사라진다.
    const { screen } = await approvedWith(NO_DOCUMENT)
    expect(screen.container.querySelector('[data-testid=generate]')).toBeNull()
    await expect.element(screen.getByTestId('more-actions')).toBeInTheDocument()
  })

  it('⋮를 열면 시작 항목이 있다', async () => {
    const { screen } = await approvedWith(NO_DOCUMENT)
    await screen.getByTestId('more-actions').click()
    await expect
      .element(screen.getByRole('menuitem', { name: 'AI 정리 시작' }))
      .toBeInTheDocument()
  })

  it('결과가 있으면 「다시 정리」다', async () => {
    const { screen } = await approvedWith(WITH_DOCUMENT)
    await screen.getByTestId('more-actions').click()
    await expect
      .element(screen.getByRole('menuitem', { name: '다시 정리' }))
      .toBeInTheDocument()
  })

  it('누르면 만든다', async () => {
    const { screen, calls } = await approvedWith(NO_DOCUMENT)
    await screen.getByTestId('more-actions').click()
    await screen.getByTestId('generate').click()

    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.url.includes('/document') && c.method === 'POST')
      ).toBe(true)
    )
  })

  it('⛔ 도는 동안에는 시작할 수 없다 — 같은 회의를 두 번 돌리지 않는다', async () => {
    const { screen } = await approvedWith({
      ...WITH_DOCUMENT,
      documentRunState: 'documenting',
      proposal: null,
    })
    await screen.getByTestId('more-actions').click()
    expect(
      document.querySelector('[data-testid=generate]')!.getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('도는 동안에는 도는 중이라고 말한다', async () => {
    const { screen } = await approvedWith({
      ...WITH_DOCUMENT,
      documentRunState: 'documenting',
      proposal: null,
    })
    await expect.element(screen.getByText('정리 중')).toBeInTheDocument()
  })
})

describe('⛔ 확정 뒤에는 검수가 주 작업이다', () => {
  const approved = async () => {
    const s = await setup()
    await s.screen.getByTestId('approve-transcript').click()
    await vi.waitFor(() =>
      expect(s.screen.container.querySelector('[data-testid=ai-result]')).toBeTruthy()
    )
    return s
  }

  it('⛔ 전사가 화면 절반을 계속 차지하지 않는다', async () => {
    // 확정 뒤에도 절반을 전사에 내주면 정작 읽어야 할 결과가 좁은 칸에 갇힌다.
    const { screen } = await approved()
    const layout = screen.container.querySelector('[data-testid=review-layout]')!
    expect(layout.className).not.toContain('lg:grid-cols')
  })

  it('전사는 닫혀 있다', async () => {
    await approved()
    expect(document.querySelector('[data-testid=transcript-drawer]')).toBeNull()
  })

  it('열어서 볼 수 있다', async () => {
    const { screen } = await approved()
    await screen.getByTestId('open-transcript').click()

    await expect
      .element(screen.getByRole('dialog', { name: '전사 원문' }))
      .toBeInTheDocument()
  })

  it('⛔ 닫는 길이 있다 — 덮은 것에서 빠져나오지 못하면 갇힌 것이다', async () => {
    const { screen } = await approved()
    await screen.getByTestId('open-transcript').click()
    await screen.getByRole('button', { name: '닫기' }).click()

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid=transcript-drawer]')).toBeNull()
    )
  })

  it('⛔ 되돌릴 길을 전사 서랍 안에 숨기지 않는다', async () => {
    // ⋮는 늘 보이는 자리다. 전사 서랍은 먼저 열어야 하므로 다르다.
    const { screen } = await approved()
    await screen.getByTestId('more-actions').click()
    await expect
      .element(screen.getByRole('menuitem', { name: '전사 수정' }))
      .toBeInTheDocument()
    expect(document.querySelector('[data-testid=transcript-drawer]')).toBeNull()
  })

  it('⛔ 각주를 눌러도 전사가 튀어나오지 않는다', async () => {
    // 하나를 눌렀는데 소리가 나고 서랍이 열리고 목록이 스크롤되면, 무엇을
    // 한 것인지 알 수 없다. 각주는 근거를 보여줄 뿐이다.
    const s = server(REVISION(), WITH_DOCUMENT)
    const { screen } = await setup(s)
    await screen.getByTestId('approve-transcript').click()
    await vi.waitFor(() =>
      expect(screen.container.querySelector('button[data-cite=seg_1]')).toBeTruthy()
    )

    await screen.getByRole('button', { name: /근거 1/ }).first().click()
    await expect.element(screen.getByTestId('footnote-card')).toBeInTheDocument()
    expect(document.querySelector('[data-testid=transcript-drawer]')).toBeNull()
  })

  it('「전사에서 보기」를 눌러야 전사가 열리고 그 지점으로 간다', async () => {
    const s = server(REVISION(), WITH_DOCUMENT)
    const { screen } = await setup(s)
    await screen.getByTestId('approve-transcript').click()
    await vi.waitFor(() =>
      expect(screen.container.querySelector('button[data-cite=seg_1]')).toBeTruthy()
    )

    const audio = screen.container.querySelector('audio') as HTMLAudioElement
    await screen.getByRole('button', { name: /근거 1/ }).first().click()
    await screen.getByTestId('open-in-transcript').click()

    await expect
      .element(screen.getByRole('dialog', { name: '전사 원문' }))
      .toBeInTheDocument()
    expect(audio.currentTime).toBeCloseTo(2.12, 2)
  })

  it('⛔ 열어도 편집기가 아니다 — 확정본은 고칠 수 없다', async () => {
    const { screen } = await approved()
    await screen.getByTestId('open-transcript').click()

    await vi.waitFor(() =>
      // ⚠️ Sheet는 portal로 나간다
      expect(document.querySelector('[data-testid=transcript-drawer]')).toBeTruthy()
    )
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })
})

describe('timestamp로 듣기', () => {
  it('timestamp가 버튼이다 — keyboard로 닿는다', async () => {
    const { screen } = await setup()
    await expect
      .element(screen.getByRole('button', { name: '00:00:00부터 듣기' }))
      .toBeInTheDocument()
  })

  it('누르면 그 지점으로 이동한다', async () => {
    const { screen } = await setup()
    const audio = screen.container.querySelector('audio') as HTMLAudioElement
    // 실제 오디오가 없으므로 재생은 실패한다. 이동만 확인한다.
    await screen.getByRole('button', { name: '00:00:02부터 듣기' }).click()

    expect(audio.currentTime).toBeCloseTo(2.12, 2)
  })
})
