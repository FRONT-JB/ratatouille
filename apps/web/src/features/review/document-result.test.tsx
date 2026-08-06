/**
 * AI 정리 결과 화면 — Phase 6.
 *
 * ⛔ 여기서 지키는 것은 `review-contract.md`의 계약이다.
 *    · 네 section을 빼거나 하나로 합치지 않는다
 *    · 각 항목의 근거를 눌러 **그 지점의 음성으로 이동**할 수 있다
 *    · 닿지 못하는 근거는 **깨진 링크로 그리지 않는다**
 *    · 모델 장애가 화면 상태로 드러난다 (`auth_required`는 재시도가 아니라 재인증)
 *    · 결과가 없는 section의 비어 있음을 **오류로 표시하지 않는다**
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentResult } from './document-result'
import type { DocumentView } from './document'

afterEach(() => vi.restoreAllMocks())

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
  {
    id: 'seg_1',
    startMs: 4120,
    endMs: 8000,
    timestamp: '00:00:04',
    text: '3월 16일로 하죠.',
    original: '3월 16일로 하죠.',
    edited: false,
  },
]

// ⛔ 근거는 **문장 안에** 있다. 서버가 이 형식을 프롬프트로 요구하고,
//    화면은 마커 자리에 각주 번호를 그린다.
const PROPOSAL = {
  summary: {
    text: '결제 모듈 오픈을 연기하고[seg_0] 3월 16일로 정했다[seg_1].',
    evidence: ['seg_0', 'seg_1'],
  },
  decisions: [{ what: '오픈을 3월 16일로 연기하기로 했다[seg_1].', evidence: ['seg_1'] }],
  tasks: [
    {
      action: '고객사에 일정을 공지한다[seg_1].',
      owner: '이한결',
      due: '3월 2일',
      evidence: ['seg_1'],
    },
    { action: 'PG사에 확인한다[seg_0].', owner: null, due: null, evidence: ['seg_0'] },
  ],
  evidence: [
    { id: 'seg_0', timestamp: '00:00:00', quote: '결제 모듈 오픈을 연기합니다.' },
    { id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' },
  ],
}

const NONE: DocumentView = {
  runId: null,
  documentRunState: null,
  revisionId: null,
  error: null,
  violations: [],
  elapsedMs: null,
  proposal: null,
}

const PROPOSED: DocumentView = {
  runId: 'doc_src_01_1',
  documentRunState: 'proposed',
  revisionId: 'rev_1',
  error: null,
  violations: [],
  elapsedMs: 43279,
  proposal: PROPOSAL,
}

/** 서버 대역. GET은 `state`를, POST는 `afterPost`를 돌려준다. */
function server(state: DocumentView = NONE, afterPost = PROPOSED) {
  let current = state
  const calls: { url: string; method: string }[] = []
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (method === 'POST') current = afterPost
    return { ok: true, status: 200, json: async () => current } as unknown as Response
  })
  return { fetchFn, calls, set: (v: DocumentView) => (current = v) }
}

const setup = async (s = server(), onSeek = vi.fn()) => {
  const screen = await render(
    <DocumentResult
      sourceId='src_01'
      revisionId='rev_1'
      segments={SEGMENTS}
      onSeek={onSeek}
      deps={{ fetch: s.fetchFn as never, pollMs: 10 }}
    />
  )
  await vi.waitFor(() => expect(s.calls.length).toBeGreaterThan(0))
  return { screen, onSeek, ...s }
}

describe('아직 만들지 않았을 때', () => {
  it('생성 버튼이 있다', async () => {
    const { screen } = await setup()
    await expect
      .element(screen.getByRole('button', { name: 'AI 정리 시작' }))
      .toBeInTheDocument()
  })

  it('⛔ 자동으로 만들지 않는다 — 사용자가 시작한다', async () => {
    const { calls } = await setup()
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('무엇이 나오는지 미리 말한다 — 빈 자리를 두지 않는다', async () => {
    const { screen } = await setup()
    expect(screen.container.textContent).toContain('회의 요약')
  })
})

describe('⛔ 네 section', () => {
  const proposed = () => server(PROPOSED)

  it('네 제목이 모두 있다', async () => {
    const { screen } = await setup(proposed())
    for (const title of ['회의 요약', '결정 사항', 'Action Item', '원문 근거']) {
      await expect.element(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('⛔ 다섯 번째 section이 없다', async () => {
    const { screen } = await setup(proposed())
    const headings = [...screen.container.querySelectorAll('[data-section]')]
    expect(headings).toHaveLength(4)
  })

  it('⛔ 주요 논점·열린 질문을 만들지 않는다 — Phase 2 유입', async () => {
    const { screen } = await setup(proposed())
    const text = screen.container.textContent ?? ''
    for (const word of ['주요 논점', '열린 질문', '다음 회의']) {
      expect(text).not.toContain(word)
    }
  })

  it('요약과 결정이 그대로 나온다', async () => {
    const { screen } = await setup(proposed())
    expect(screen.container.textContent).toContain('결제 모듈 오픈을 연기하고')
    expect(screen.container.textContent).toContain('오픈을 3월 16일로 연기하기로 했다')
  })

  it('⛔ 마커가 글자로 보이지 않는다 — 각주 번호가 된다', async () => {
    const { screen } = await setup(proposed())
    expect(screen.container.textContent).not.toContain('[seg_0]')
  })
})

describe('⛔ 각주는 그 문장에 붙어 있다', () => {
  it('본문 안에 번호가 있다', async () => {
    const { screen } = await setup(server(PROPOSED))
    const summary = screen.container.querySelector('[data-section=summary]')!
    expect(summary.querySelector('sup button[data-cite=seg_0]')?.textContent).toBe('[1]')
    expect(summary.querySelector('sup button[data-cite=seg_1]')?.textContent).toBe('[2]')
  })

  it('⛔ 번호는 각주란과 같다 — 어긋나면 각주가 무의미하다', async () => {
    const { screen } = await setup(server(PROPOSED))
    const inline = screen.container.querySelector(
      '[data-section=summary] button[data-cite=seg_1]'
    )!.textContent
    const listed = [
      ...screen.container.querySelectorAll('[data-section=evidence] li'),
    ].find((li) => li.querySelector('[data-cite=seg_1]'))!
    expect(listed.textContent).toContain(inline!.replace(/[[\]]/g, ''))
  })

  it('마우스를 올리면 인용문이 뜬다 — 한 단계 덜 가고도 확인할 수 있다', async () => {
    const { screen } = await setup(server(PROPOSED))
    const mark = screen.container.querySelector(
      '[data-section=summary] button[data-cite=seg_1]'
    )!
    expect(mark.getAttribute('title')).toContain('3월 16일로 하죠.')
  })

  it('⛔ 각주란은 기본으로 접혀 있다 — 90건이 펼쳐져 있으면 결과를 못 읽는다', async () => {
    const { screen } = await setup(server(PROPOSED))
    const details = screen.container.querySelector('details[data-section=evidence]')!
    expect((details as HTMLDetailsElement).open).toBe(false)
  })

  it('몇 건인지는 접힌 채로도 보인다', async () => {
    const { screen } = await setup(server(PROPOSED))
    const summary = screen.container.querySelector(
      'details[data-section=evidence] > summary'
    )!
    expect(summary.textContent).toContain('2건')
  })
})

describe('Action Item', () => {
  it('담당자와 기한을 보여준다 — 실측에서 기한 정확도가 4/4였다', async () => {
    const { screen } = await setup(server(PROPOSED))
    const item = screen.container.querySelector('[data-task="0"]')!
    expect(item.textContent).toContain('이한결')
    expect(item.textContent).toContain('3월 2일')
  })

  it('⛔ 없는 담당자를 지어내지 않는다 — 미입력으로 남는다', async () => {
    // 화자 분리를 접었으므로 "제가 하겠습니다"는 누가 말했는지 알 수 없다.
    const { screen } = await setup(server(PROPOSED))
    expect(screen.container.querySelector('[data-task="1"]')!.textContent).toContain(
      '미입력'
    )
  })
})

describe('⛔ 결과가 없는 것은 오류가 아니다', () => {
  const empty: DocumentView = {
    ...PROPOSED,
    proposal: { ...PROPOSAL, decisions: [], tasks: [] },
  }

  it('결정이 없으면 없다고 말한다', async () => {
    const { screen } = await setup(server(empty))
    const section = screen.container.querySelector('[data-section="decisions"]')!
    expect(section.textContent).toContain('없습니다')
  })

  it('⛔ 비어 있음을 오류로 표시하지 않는다', async () => {
    const { screen } = await setup(server(empty))
    const section = screen.container.querySelector('[data-section="decisions"]')!
    expect(section.querySelector('[role=alert]')).toBeNull()
  })
})

describe('⛔ 근거로 음성에 닿는다', () => {
  it('근거를 누르면 그 지점으로 이동한다', async () => {
    const { screen, onSeek } = await setup(server(PROPOSED))
    await screen
      .getByRole('button', { name: '00:00:04부터 듣기 — 3월 16일로 하죠.' })
      .first()
      .click()

    expect(onSeek).toHaveBeenCalledWith(4120)
  })

  it('⛔ 요약·결정·Action Item 어디서든 같은 segment로 간다', async () => {
    // review-contract: "다른 세 결과에서도 같은 segment로 이동할 수 있어야 한다"
    const { screen } = await setup(server(PROPOSED))
    for (const key of ['summary', 'decisions', 'tasks']) {
      const section = screen.container.querySelector(`[data-section="${key}"]`)!
      expect(section.querySelectorAll('button[data-cite]').length).toBeGreaterThan(0)
    }
  })

  it('⛔ 전사에 없는 근거는 버튼이 아니다 — 깨진 링크를 그리지 않는다', async () => {
    const broken: DocumentView = {
      ...PROPOSED,
      proposal: {
        ...PROPOSAL,
        decisions: [{ what: '없는 근거를 단 결정[seg_999].', evidence: ['seg_999'] }],
      },
    }
    const { screen } = await setup(server(broken))
    const section = screen.container.querySelector('[data-section="decisions"]')!

    expect(section.querySelector('button[data-cite="seg_999"]')).toBeNull()
    // 근거가 있었다는 사실 자체는 숨기지 않는다 — 조용히 지우면 검수가 불가능하다
    expect(section.textContent).toContain('seg_999')
  })
})

describe('⛔ 모델 장애가 화면에 드러난다', () => {
  const failed: DocumentView = {
    ...PROPOSED,
    documentRunState: 'failed_retryable',
    proposal: null,
    error: '모델 호출이 실패했습니다 (종료 코드 1).',
    violations: [{ kind: 'unknown_segment', message: 'seg_999는 전사문에 없다' }],
  }

  it('실패 이유를 보여준다', async () => {
    const { screen } = await setup(server(failed))
    await expect
      .element(screen.getByText(/모델 호출이 실패했습니다/))
      .toBeInTheDocument()
  })

  it('위반 목록을 보여준다 — 못 보면 고칠 수 없다', async () => {
    const { screen } = await setup(server(failed))
    expect(screen.container.textContent).toContain('seg_999는 전사문에 없다')
  })

  it('다시 시도할 수 있다', async () => {
    const { screen, calls } = await setup(server(failed, PROPOSED))
    await screen.getByRole('button', { name: '다시 시도' }).click()

    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    )
  })

  it('⛔ 인증 만료는 재시도가 아니라 재인증이다', async () => {
    // 재시도 버튼만 주면 사용자는 눌러도 안 되는 버튼을 반복해서 누른다.
    const { screen } = await setup(
      server({ ...failed, documentRunState: 'auth_required' })
    )
    expect(screen.container.textContent).toContain('로그인')
    expect(screen.container.querySelector('[data-testid=reauth]')).toBeTruthy()
  })

  it('⛔ 인증 만료여도 전사 산출물은 그대로다', async () => {
    // 결과 영역이 실패했다고 전사를 지우면, 사람이 고친 것이 사라진다.
    const { screen } = await setup(
      server({ ...failed, documentRunState: 'auth_required' })
    )
    // 이 컴포넌트는 전사를 건드릴 수단 자체가 없어야 한다
    expect(screen.container.querySelector('textarea')).toBeNull()
  })
})

describe('돌고 있을 때', () => {
  const running: DocumentView = {
    ...PROPOSED,
    documentRunState: 'documenting',
    proposal: null,
    elapsedMs: null,
  }

  it('정리 중이라고 말한다', async () => {
    const { screen } = await setup(server(running))
    await expect.element(screen.getByText('정리 중')).toBeInTheDocument()
  })

  it('⛔ 도는 동안 다시 시작할 수 없다 — 같은 회의를 두 번 돌리지 않는다', async () => {
    const { screen } = await setup(server(running))
    expect(screen.container.querySelector('[data-testid=generate]')).toBeNull()
  })

  it('끝나면 결과로 바뀐다 — 사용자가 새로고침하지 않는다', async () => {
    const s = server(running)
    const { screen } = await setup(s)
    s.set(PROPOSED)

    await expect
      .element(screen.getByRole('heading', { name: '결정 사항' }))
      .toBeInTheDocument()
  })

  it('⛔ 끝난 뒤에는 폴링을 멈춘다', async () => {
    const { calls } = await setup(server(PROPOSED))
    const before = calls.length
    await new Promise((r) => setTimeout(r, 60))
    expect(calls.length).toBe(before)
  })
})

describe('⛔ 재교정하면 오래된 결과가 된다', () => {
  it('다른 교정본에서 나온 결과는 재검토 필요로 표시된다', async () => {
    const { screen } = await setup(server({ ...PROPOSED, revisionId: 'rev_0' }))
    expect(screen.container.textContent).toContain('재검토 필요')
  })

  it('⛔ 오래됐다고 지우지 않는다 — 사람이 보고 판단한다', async () => {
    const { screen } = await setup(server({ ...PROPOSED, revisionId: 'rev_0' }))
    expect(screen.container.textContent).toContain('결제 모듈 오픈을 연기하고')
  })
})
