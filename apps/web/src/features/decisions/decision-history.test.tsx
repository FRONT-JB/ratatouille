/**
 * 결정 이력 화면 — GOAL 6.10 「화면 연결」.
 *
 * ⛔ 여기서 지키는 것은 취향이 아니라 계약이다.
 *    · 대체·뒤집힌 결정도 **보인다**. 감추면 「왜 바뀌었나」를 볼 길이 없다
 *    · 결정자·이유는 **사람이 채운다**. 빈 값은 「미입력」으로 보이되 `null`로 저장한다
 *    · 대체·뒤집기는 **되돌릴 수 없다**. 확인 없이 일어나지 않는다
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { DecisionHistory } from './decision-history'
import type { DecisionView } from './use-decisions'

afterEach(() => vi.restoreAllMocks())

const DECISION = (over: Partial<DecisionView> = {}): DecisionView => ({
  decisionId: 'dec_1',
  sourceId: 'src_01',
  runId: 'doc_src_01_1',
  what: '오픈을 3월 16일로 연기[seg_1].',
  why: null,
  who: null,
  evidence: ['seg_1'],
  decisionState: 'active',
  decidedAt: '2026-08-06T10:00:00.000Z',
  supersedes: null,
  ...over,
})

/** 서버 대역. 규칙 판정까지 흉내낸다 — 화면이 409를 어떻게 다루는지 봐야 한다 */
function server(initial: DecisionView[] = [DECISION()]) {
  let state = initial
  const calls: { url: string; method: string; body?: unknown }[] = []

  const ok = (payload: unknown) =>
    ({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as unknown as Response
  const conflict = (error: string, rule: string) =>
    ({
      ok: false,
      status: 409,
      json: async () => ({ error, rule }),
    }) as unknown as Response

  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })

    if (method === 'GET') return ok({ decisions: state })

    const id = url.match(/decisions\/([^/]+)/)![1]!
    const target = state.find((d) => d.decisionId === id)
    if (!target)
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: '없는 결정입니다.' }),
      } as unknown as Response
    if (target.decisionState !== 'active') {
      return conflict(
        '이미 다른 결정으로 대체된 결정입니다.',
        'decision-not-active'
      )
    }

    const replace = (next: DecisionView) => {
      state = state.map((d) => (d.decisionId === next.decisionId ? next : d))
      return next
    }

    if (method === 'PATCH')
      return ok(replace({ ...target, ...(body as object) }))

    if (url.endsWith('/reverse'))
      return ok(replace({ ...target, decisionState: 'reversed' }))

    if (url.endsWith('/supersede')) {
      const previousId = (body as { previousId: string }).previousId
      const previous = state.find((d) => d.decisionId === previousId)
      if (!previous) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: '없는 결정입니다.' }),
        } as unknown as Response
      }
      state = state.map((d) =>
        d.decisionId === previousId
          ? { ...d, decisionState: 'superseded' as const }
          : d
      )
      return ok(replace({ ...target, supersedes: previousId }))
    }

    return ok(target)
  })

  return {
    fetchFn,
    calls,
    get state() {
      return state
    },
  }
}

const setup = async (s = server()) => {
  const screen = await render(
    <DecisionHistory sourceId='src_01' deps={{ fetch: s.fetchFn as never }} />
  )
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector('[data-testid=decision-history]')
    ).toBeTruthy()
  )
  return { screen, ...s }
}

describe('결정 이력', () => {
  it('확정된 결정을 보여준다', async () => {
    const { screen } = await setup()
    expect(screen.container.textContent).toContain('오픈을 3월 16일로 연기')
  })

  it('⛔ 근거 마커를 사람이 읽는 문장에 그대로 남기지 않는다', async () => {
    // `[seg_1]`이 문장 한가운데 박혀 있으면 읽을 수 없다. 근거는 따로 밝힌다.
    const { screen } = await setup()
    expect(screen.container.textContent).not.toContain('[seg_1]')
    expect(screen.container.textContent).toContain('seg_1')
  })

  it('⛔ 대체된 결정도 보인다 — 감추면 왜 바뀌었는지 볼 길이 없다', async () => {
    const { screen } = await setup(
      server([
        DECISION({
          decisionId: 'dec_1',
          what: '오픈을 3월 9일로[seg_1].',
          decisionState: 'superseded',
        }),
        DECISION({
          decisionId: 'dec_2',
          what: '오픈을 3월 16일로 연기[seg_1].',
          supersedes: 'dec_1',
        }),
      ])
    )
    const text = screen.container.textContent ?? ''
    expect(text).toContain('오픈을 3월 9일로')
    expect(text).toContain('대체됨')
  })

  it('⛔ 뒤집힌 결정도 보인다', async () => {
    const { screen } = await setup(
      server([
        DECISION({ what: '외주를 쓰기로[seg_1].', decisionState: 'reversed' }),
      ])
    )
    expect(screen.container.textContent).toContain('외주를 쓰기로')
    expect(screen.container.textContent).toContain('뒤집힘')
  })

  it('어느 결정이 어느 결정을 대체했는지 이어 보여준다', async () => {
    // 관계는 새 결정 쪽에만 저장된다(9절). 역방향은 화면이 목록에서 파생한다.
    const { screen } = await setup(
      server([
        DECISION({
          decisionId: 'dec_1',
          what: '오픈을 3월 9일로[seg_1].',
          decisionState: 'superseded',
        }),
        DECISION({
          decisionId: 'dec_2',
          what: '오픈을 3월 16일로 연기[seg_1].',
          supersedes: 'dec_1',
        }),
      ])
    )
    const relation = (id: string) =>
      screen.container.querySelector(`[data-testid=relation-${id}]`)
        ?.textContent ?? ''
    // 낡은 쪽은 「무엇으로 바뀌었나」를, 새 쪽은 「무엇을 대체했나」를 말한다
    expect(relation('dec_1')).toContain('오픈을 3월 16일로 연기')
    expect(relation('dec_2')).toContain('오픈을 3월 9일로')
  })

  it('결정이 없으면 왜 비었는지 말한다 — 빈 자리를 두지 않는다', async () => {
    const { screen } = await setup(server([]))
    expect(screen.container.textContent).toContain('확정된 결정이 없습니다')
  })

  it('⛔ 불러오지 못하면 숨기지 않는다', async () => {
    const failing = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ error: '저장소를 열 수 없습니다' }),
        }) as unknown as Response
    )
    const screen = await render(
      <DecisionHistory sourceId='src_01' deps={{ fetch: failing as never }} />
    )
    await expect
      .element(screen.getByText(/저장소를 열 수 없습니다/))
      .toBeInTheDocument()
  })
})

describe('사람이 결정자와 이유를 채운다', () => {
  it('빈 값은 「미입력」으로 보인다', async () => {
    const { screen } = await setup()
    await expect
      .element(screen.getByRole('textbox', { name: '결정 1 결정자' }))
      .toHaveAttribute('placeholder', '미입력')
  })

  it('결정자를 채우면 저장한다', async () => {
    const { screen, calls } = await setup()
    await screen.getByRole('textbox', { name: '결정 1 결정자' }).fill('이한결')
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true)
    )
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      who: '이한결',
    })
  })

  it('이유를 채우면 저장한다', async () => {
    const { screen, calls } = await setup()
    await screen
      .getByRole('textbox', { name: '결정 1 이유' })
      .fill('고객사 일정 때문')
    await userEvent.click(
      screen.getByRole('textbox', { name: '결정 1 결정자' })
    )

    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true)
    )
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      why: '고객사 일정 때문',
    })
  })

  it('⛔ 빈 칸은 `null`로 보낸다 — 「미입력」이라는 이름의 사람은 없다', async () => {
    const { screen, calls } = await setup(server([DECISION({ who: '이한결' })]))
    await screen.getByRole('textbox', { name: '결정 1 결정자' }).fill('')
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true)
    )
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ who: null })
  })

  it('⛔ 대체된 결정에는 입력 칸이 없다 — 서버가 409로 거절한다', async () => {
    const { screen } = await setup(
      server([DECISION({ decisionState: 'superseded' })])
    )
    expect(screen.container.querySelectorAll('input, textarea').length).toBe(0)
    expect(screen.container.textContent).toContain('미입력')
  })

  it('서버가 거절하면 이유를 그대로 보여준다', async () => {
    // 화면이 「저장 실패」만 띄우면 왜 막혔는지 알 수 없다.
    const s = server()
    const original = s.fetchFn
    const failing = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: '이미 뒤집힌 결정입니다.',
            rule: 'decision-not-active',
          }),
        } as unknown as Response
      }
      return original(url, init)
    })
    const { screen } = await setup({ ...s, fetchFn: failing as never })

    await screen.getByRole('textbox', { name: '결정 1 결정자' }).fill('이한결')
    await userEvent.keyboard('{Enter}')

    await expect
      .element(screen.getByText(/이미 뒤집힌 결정입니다/))
      .toBeInTheDocument()
  })
})

describe('⛔ 되돌릴 수 없는 조작은 확인을 받는다', () => {
  it('뒤집기는 바로 일어나지 않는다', async () => {
    const { screen, calls } = await setup()
    await screen.getByTestId('reverse-dec_1').click()

    await expect.element(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('확인하면 뒤집는다', async () => {
    const { screen, calls } = await setup()
    await screen.getByTestId('reverse-dec_1').click()
    await screen.getByTestId('confirm-reverse').click()

    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/reverse') && c.method === 'POST')
      ).toBe(true)
    )
  })

  it('뒤집으면 화면이 「뒤집힘」으로 바뀐다', async () => {
    const { screen } = await setup()
    await screen.getByTestId('reverse-dec_1').click()
    await screen.getByTestId('confirm-reverse').click()

    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain('뒤집힘')
    )
  })

  it('⛔ 뒤집힌 결정에는 조작이 없다 — 되살리는 전이가 없다', async () => {
    const { screen } = await setup(
      server([DECISION({ decisionState: 'reversed' })])
    )
    expect(
      screen.container.querySelector('[data-testid=reverse-dec_1]')
    ).toBeNull()
    expect(
      screen.container.querySelector('[data-testid=supersede-dec_1]')
    ).toBeNull()
  })
})

describe('대체', () => {
  const two = () =>
    server([
      DECISION({ decisionId: 'dec_1', what: '오픈을 3월 9일로[seg_1].' }),
      DECISION({ decisionId: 'dec_2', what: '오픈을 3월 16일로 연기[seg_1].' }),
    ])

  it('무엇을 대체하는지 고른 뒤에야 대체한다', async () => {
    const { screen, calls } = await setup(two())
    await screen.getByTestId('supersede-dec_2').click()

    // 고르기 전에는 확인 버튼이 눌리지 않는다 — 무엇을 대체하는지 모르는 확인은 확인이 아니다
    await expect.element(screen.getByTestId('confirm-supersede')).toBeDisabled()

    await screen.getByTestId('candidate-dec_1').click()
    await screen.getByTestId('confirm-supersede').click()

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/supersede'))).toBe(true)
    )
    expect(calls.find((c) => c.url.endsWith('/supersede'))!.body).toEqual({
      previousId: 'dec_1',
    })
  })

  it('⛔ 자기 자신은 후보에 없다 — 계약이 409로 거절한다', async () => {
    const { screen } = await setup(two())
    await screen.getByTestId('supersede-dec_2').click()

    await expect
      .element(screen.getByTestId('candidate-dec_1'))
      .toBeInTheDocument()
    expect(document.querySelector('[data-testid=candidate-dec_2]')).toBeNull()
  })

  it('⛔ 이미 대체된 결정은 후보에 없다', async () => {
    const { screen } = await setup(
      server([
        DECISION({ decisionId: 'dec_1', decisionState: 'superseded' }),
        DECISION({ decisionId: 'dec_2' }),
        DECISION({ decisionId: 'dec_3' }),
      ])
    )
    await screen.getByTestId('supersede-dec_2').click()

    await expect
      .element(screen.getByTestId('candidate-dec_3'))
      .toBeInTheDocument()
    expect(document.querySelector('[data-testid=candidate-dec_1]')).toBeNull()
  })

  it('⛔ 대체하고 나면 이전 결정도 새로 읽는다 — 한 조작이 둘을 바꾼다', async () => {
    // 응답 하나만 반영하면 이전 결정이 화면에서 계속 「유효」로 남는다.
    const { screen } = await setup(two())
    await screen.getByTestId('supersede-dec_2').click()
    await screen.getByTestId('candidate-dec_1').click()
    await screen.getByTestId('confirm-supersede').click()

    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain('대체됨')
    )
  })

  it('대체할 상대가 없으면 대체 조작을 내지 않는다', async () => {
    const { screen } = await setup()
    expect(
      screen.container.querySelector('[data-testid=supersede-dec_1]')
    ).toBeNull()
  })

  it('⛔ 이미 다른 결정을 대체한 결정은 또 대체하지 않는다', async () => {
    // 한 결정이 둘을 대체하면 「무엇을 대체했나」가 흐려진다(계약).
    const { screen } = await setup(
      server([
        DECISION({ decisionId: 'dec_1' }),
        DECISION({ decisionId: 'dec_2', supersedes: 'dec_0' }),
      ])
    )
    expect(
      screen.container.querySelector('[data-testid=supersede-dec_2]')
    ).toBeNull()
  })
})
