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
  narrative: [
    {
      heading: '결제 모듈 오픈',
      body: '오픈 일정을 두고 논의했고[seg_0] 3월 16일로 미루기로 했다[seg_1].',
    },
  ],
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

/**
 * ⛔ 이 컴포넌트는 **순수 뷰**다. 조회도 조작도 부모가 갖는다.
 *    그래서 서버 대역이 필요 없다 — 보여줄 것을 그대로 넘긴다.
 */
const setup = async (
  view: DocumentView | null = NONE,
  onSeek = vi.fn(),
  onPlay = vi.fn(),
  onReview = vi.fn(),
  onEdit = vi.fn()
) => {
  const screen = await render(
    <DocumentResult
      view={view}
      error={null}
      revisionId='rev_1'
      segments={SEGMENTS}
      onSeek={onSeek}
      onPlay={onPlay}
      onOpenTranscript={vi.fn()}
      onRetry={vi.fn()}
      onReview={onReview}
      onEdit={onEdit}
    />
  )
  return { screen, onSeek, onPlay, onReview, onEdit }
}

describe('아직 만들지 않았을 때', () => {
  it('무엇이 나오는지 미리 말한다 — 빈 자리를 두지 않는다', async () => {
    const { screen } = await setup()
    expect(screen.container.textContent).toContain('회의 요약')
  })
})

describe('⛔ 네 section', () => {
  it('네 결과가 모두 닿는다 — 탭 이름 둘 + 제목 둘', async () => {
    const { screen } = await setup(PROPOSED)
    for (const name of ['회의 내용', '요약']) {
      await expect.element(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
    for (const name of ['결정 사항', 'Action Item', '원문 근거']) {
      await expect.element(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('⛔ 결정 사항과 Action Item은 탭에 숨지 않는다', async () => {
    // 탭 뒤에 두면 어느 탭을 보느냐에 따라 할 일이 보였다 안 보였다 한다.
    const { screen } = await setup(PROPOSED)
    expect(screen.container.querySelector('[data-section=decisions]')).toBeTruthy()
    expect(screen.container.querySelector('[data-section=tasks]')).toBeTruthy()
  })

  it('회의 내용이 있으면 그쪽이 먼저 열린다', async () => {
    const { screen } = await setup(PROPOSED)
    expect(screen.container.querySelector('[data-section=narrative]')).toBeTruthy()
    expect(screen.container.textContent).toContain('오픈 일정을 두고 논의했고')
  })

  it('회의 내용이 없는 예전 결과는 요약부터 연다', async () => {
    const { screen } = await setup({
      ...PROPOSED,
      proposal: { ...PROPOSAL, narrative: [] },
    })
    expect(screen.container.querySelector('[data-section=summary]')).toBeTruthy()
  })

  it('⛔ 주요 논점·열린 질문을 만들지 않는다 — Phase 2 유입', async () => {
    const { screen } = await setup(PROPOSED)
    const text = screen.container.textContent ?? ''
    for (const word of ['주요 논점', '열린 질문', '다음 회의']) {
      expect(text).not.toContain(word)
    }
  })

  it('요약과 결정이 그대로 나온다', async () => {
    const { screen } = await setup(PROPOSED)
    await screen.getByTestId('tab-summary').click()
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain('결제 모듈 오픈을 연기하고')
    )
    expect(screen.container.textContent).toContain('오픈을 3월 16일로 연기하기로 했다')
  })

  it('⛔ 마커가 글자로 보이지 않는다 — 각주 번호가 된다', async () => {
    const { screen } = await setup(PROPOSED)
    expect(screen.container.textContent).not.toContain('[seg_0]')
  })
})

describe('⛔ 각주는 그 문장에 붙어 있다', () => {
  it('본문 안에 번호가 있다', async () => {
    const { screen } = await setup(PROPOSED)
    const tab = screen.container.querySelector('[data-section=narrative]')!
    expect(tab.querySelector('sup button[data-cite=seg_0]')?.textContent).toBe('[1]')
    expect(tab.querySelector('sup button[data-cite=seg_1]')?.textContent).toBe('[2]')
  })

  it('⛔ 번호는 각주란과 같다 — 어긋나면 각주가 무의미하다', async () => {
    const { screen } = await setup(PROPOSED)
    const inline = screen.container.querySelector(
      '[data-section=narrative] button[data-cite=seg_1]'
    )!.textContent
    const listed = [
      ...screen.container.querySelectorAll('[data-section=evidence] li'),
    ].find((li) => li.querySelector('[data-cite=seg_1]'))!
    expect(listed.textContent).toContain(inline!.replace(/[[\]]/g, ''))
  })

  it('각주가 무엇을 가리키는지 이름에 담긴다', async () => {
    const { screen } = await setup(PROPOSED)
    const mark = screen.container.querySelector(
      '[data-section=narrative] button[data-cite=seg_1]'
    )!
    expect(mark.getAttribute('aria-label')).toContain('3월 16일로 하죠.')
  })

  it('⛔ 각주란은 기본으로 접혀 있다 — 90건이 펼쳐져 있으면 결과를 못 읽는다', async () => {
    const { screen } = await setup(PROPOSED)
    const details = screen.container.querySelector('details[data-section=evidence]')!
    expect((details as HTMLDetailsElement).open).toBe(false)
  })

  it('몇 건인지는 접힌 채로도 보인다', async () => {
    const { screen } = await setup(PROPOSED)
    const summary = screen.container.querySelector(
      'details[data-section=evidence] > summary'
    )!
    expect(summary.textContent).toContain('2건')
  })
})

describe('Action Item', () => {
  const input = (screen: { container: HTMLElement }, name: string) =>
    screen.container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!

  it('담당자와 기한을 보여준다 — 실측에서 기한 정확도가 4/4였다', async () => {
    const { screen } = await setup(PROPOSED)
    expect(input(screen, 'Action Item 1 담당자').value).toBe('이한결')
    expect(input(screen, 'Action Item 1 기한').value).toBe('3월 2일')
  })

  it('⛔ 없는 담당자를 지어내지 않는다 — 빈 칸으로 남는다', async () => {
    // 화자 분리를 접었으므로 "제가 하겠습니다"는 누가 말했는지 알 수 없다.
    const el = input(await setup(PROPOSED).then((r) => r.screen), 'Action Item 2 담당자')
    expect(el.value).toBe('')
    expect(el.placeholder).toBe('미입력')
  })

  it('담당자를 채우면 저장한다', async () => {
    const { screen, onEdit } = await setup(PROPOSED)
    const el = screen.getByRole('textbox', { name: 'Action Item 2 담당자' })
    await el.fill('지영')
    // ⛔ 타이핑 도중이 아니라 칸을 떠날 때 보낸다 — 이름은 짧아서 중간값이 저장된다
    await screen.getByRole('textbox', { name: 'Action Item 1 담당자' }).click()

    expect(onEdit).toHaveBeenCalledWith({
      section: 'tasks',
      kind: 'owner',
      index: 1,
      value: '지영',
    })
  })

  it('⛔ 확정된 문서에서는 고칠 수 없다', async () => {
    const { screen } = await setup({ ...PROPOSED, documentState: 'current' })
    expect(
      screen.container.querySelector('[aria-label="Action Item 1 담당자"]')
    ).toBeNull()
  })
})

describe('⛔ 고칠 수 없는 검수는 반쪽이다', () => {
  it('요약을 고칠 수 있다', async () => {
    const { screen, onEdit } = await setup(PROPOSED)
    await screen.getByTestId('tab-summary').click()
    await screen.getByRole('button', { name: '요약 고치기' }).click()
    await screen.getByRole('textbox', { name: '요약 내용' }).fill('고친 요약[seg_0].')
    await screen.getByRole('button', { name: '저장' }).click()

    expect(onEdit).toHaveBeenCalledWith({
      section: 'summary',
      kind: 'text',
      text: '고친 요약[seg_0].',
    })
  })

  it('⛔ 편집기에 근거 마커가 그대로 보인다 — 감추면 모르고 지운다', async () => {
    const { screen } = await setup(PROPOSED)
    await screen.getByTestId('tab-summary').click()
    await screen.getByRole('button', { name: '요약 고치기' }).click()

    const box = screen.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="요약 내용"]'
    )!
    expect(box.value).toContain('[seg_0]')
  })

  it('결정을 지울 수 있다 — 결함 B의 시정 수단이다', async () => {
    const { screen, onEdit } = await setup(PROPOSED)
    await screen.getByRole('button', { name: '결정 1 지우기' }).click()

    expect(onEdit).toHaveBeenCalledWith({
      section: 'decisions',
      kind: 'remove',
      index: 0,
    })
  })

  it('취소하면 원래대로 돌아간다', async () => {
    const { screen, onEdit } = await setup(PROPOSED)
    await screen.getByTestId('tab-summary').click()
    await screen.getByRole('button', { name: '요약 고치기' }).click()
    await screen.getByRole('textbox', { name: '요약 내용' }).fill('버릴 글[seg_0].')
    await screen.getByRole('button', { name: '취소' }).click()

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.container.textContent).toContain('결제 모듈 오픈을 연기하고')
  })

  it('⛔ 확정된 문서에는 고치기 버튼이 없다', async () => {
    const { screen } = await setup({ ...PROPOSED, documentState: 'current' })
    expect(
      screen.container.querySelector('[aria-label="결정 1 고치기"]')
    ).toBeNull()
  })
})

describe('⛔ 사람이 눌러야 확인된 것이다', () => {
  it('네 결과에 각각 검수 줄이 있다', async () => {
    const { screen } = await setup(PROPOSED)
    for (const s of ['summary', 'decisions', 'tasks', 'evidence']) {
      expect(screen.container.querySelector(`[data-review-section=${s}]`)).toBeTruthy()
    }
  })

  it('처음에는 전부 「확인 전」이다 — 본 적 없는 것을 봤다고 하지 않는다', async () => {
    const { screen } = await setup(PROPOSED)
    const el = screen.container.querySelector('[data-review-section=summary]')!
    expect(el.getAttribute('data-review-state')).toBe('unreviewed')
    expect(el.textContent).toContain('확인 전')
  })

  it('「확인함」을 누르면 그 section만 바뀐다', async () => {
    const { screen, onReview } = await setup(PROPOSED)
    await screen.getByTestId('accept-decisions').click()

    expect(onReview).toHaveBeenCalledWith('decisions', { state: 'accepted' })
    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it('⛔ 항목이 있으면 「회의에 없었음」을 고를 수 없다 — 건너뛰는 길을 만들지 않는다', async () => {
    const { screen } = await setup(PROPOSED)
    expect(screen.container.querySelector('[data-testid=empty-decisions]')).toBeNull()
  })

  it('실제로 없을 때만 「회의에 없었음」이 나온다', async () => {
    const { screen } = await setup({
      ...PROPOSED,
      proposal: { ...PROPOSAL, decisions: [] },
    })
    expect(screen.container.querySelector('[data-testid=empty-decisions]')).toBeTruthy()
  })

  it('⛔ 확정된 문서에서는 검수를 흔들 수 없다', async () => {
    const { screen } = await setup({ ...PROPOSED, documentState: 'current' })
    expect(screen.container.querySelector('[data-testid=accept-summary]')).toBeNull()
  })
})

describe('⛔ 루브릭은 AI의 자기 채점이 아니다', () => {
  it('결정 사항 기준에 결함 B를 잡는 질문이 있다', async () => {
    const { screen } = await setup(PROPOSED)
    await screen.getByTestId('rubric-decisions').click()

    await expect
      .element(screen.getByText('실제 결정과 단순 제안·논의가 구분됐는가?'))
      .toBeInTheDocument()
  })

  it('⛔ 사용자가 「수정 필요」로 뒤집을 수 있다', async () => {
    const { screen, onReview } = await setup(PROPOSED)
    await screen.getByTestId('rubric-decisions').click()
    await screen.getByTestId('verdict-decision-vs-proposal-fix_required').click()

    expect(onReview).toHaveBeenCalledWith('decisions', {
      rubric: { 'decision-vs-proposal': 'fix_required' },
    })
  })

  it('막고 있는 판정 수를 보여준다', async () => {
    const { screen } = await setup({
      ...PROPOSED,
      review: {
        summary: { state: 'accepted', rubric: {} },
        decisions: {
          state: 'accepted',
          rubric: { 'decision-vs-proposal': 'fix_required' },
        },
        tasks: { state: 'accepted', rubric: {} },
        evidence: { state: 'accepted', rubric: {} },
      },
    })
    expect(
      screen.container.querySelector('[data-review-section=decisions]')!.textContent
    ).toContain('1건 남음')
  })
})

describe('⛔ 결과가 없는 것은 오류가 아니다', () => {
  const empty: DocumentView = {
    ...PROPOSED,
    proposal: { ...PROPOSAL, decisions: [], tasks: [] },
  }

  it('결정이 없으면 없다고 말한다', async () => {
    const { screen } = await setup(empty)
    const section = screen.container.querySelector('[data-section="decisions"]')!
    expect(section.textContent).toContain('없습니다')
  })

  it('⛔ 비어 있음을 오류로 표시하지 않는다', async () => {
    const { screen } = await setup(empty)
    const section = screen.container.querySelector('[data-section="decisions"]')!
    expect(section.querySelector('[role=alert]')).toBeNull()
  })
})

describe('⛔ 근거로 음성에 닿는다', () => {
  it('⛔ 각주를 눌러도 소리가 나지 않는다 — 읽는 중에 재생이 시작되면 방해다', async () => {
    const { screen, onSeek, onPlay } = await setup(PROPOSED)
    await screen.getByRole('button', { name: /근거 2/ }).first().click()

    await expect.element(screen.getByTestId('footnote-card')).toBeInTheDocument()
    expect(onPlay).not.toHaveBeenCalled()
    // 위치는 맞춰 둔다 — 듣기를 누르면 바로 그 지점이다
    expect(onSeek).toHaveBeenCalledWith(4120)
  })

  it('「여기부터 듣기」를 눌러야 재생한다', async () => {
    const { screen, onPlay } = await setup(PROPOSED)
    await screen.getByRole('button', { name: /근거 2/ }).first().click()
    await screen.getByTestId('play-here').click()

    expect(onPlay).toHaveBeenCalledWith(4120)
  })

  it('⛔ 앞뒤 문맥을 함께 보여준다 — 한 줄로는 검수할 수 없다', async () => {
    const { screen } = await setup(PROPOSED)
    await screen.getByRole('button', { name: /근거 2/ }).first().click()

    // ⚠️ Popover는 portal로 나간다 — container 밖에서 찾아야 한다
    const card = document.querySelector('[data-testid=footnote-card]')!
    expect(card.textContent).toContain('결제 모듈 오픈을 연기합니다.')
    expect(card.querySelector('[data-cited=true]')!.textContent).toBe('3월 16일로 하죠.')
  })

  it('⛔ 요약·결정·Action Item 어디서든 같은 segment로 간다', async () => {
    // review-contract: "다른 세 결과에서도 같은 segment로 이동할 수 있어야 한다"
    const { screen } = await setup(PROPOSED)
    for (const key of ['narrative', 'decisions', 'tasks']) {
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
    const { screen } = await setup(broken)
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
    const { screen } = await setup(failed)
    await expect
      .element(screen.getByText(/모델 호출이 실패했습니다/))
      .toBeInTheDocument()
  })

  it('위반 목록을 보여준다 — 못 보면 고칠 수 없다', async () => {
    const { screen } = await setup(failed)
    expect(screen.container.textContent).toContain('seg_999는 전사문에 없다')
  })

  it('다시 시도할 수 있다', async () => {
    const onRetry = vi.fn()
    const screen = await render(
      <DocumentResult
        view={failed}
        error={null}
        revisionId='rev_1'
        segments={SEGMENTS}
        onSeek={vi.fn()}
        onPlay={vi.fn()}
        onOpenTranscript={vi.fn()}
        onRetry={onRetry}
        onReview={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    await screen.getByRole('button', { name: '다시 시도' }).click()
    expect(onRetry).toHaveBeenCalled()
  })

  it('⛔ 인증 만료는 재시도가 아니라 재인증이다', async () => {
    // 재시도 버튼만 주면 사용자는 눌러도 안 되는 버튼을 반복해서 누른다.
    const { screen } = await setup({ ...failed, documentRunState: 'auth_required' })
    expect(screen.container.textContent).toContain('로그인')
    expect(screen.container.querySelector('[data-testid=reauth]')).toBeTruthy()
  })

  it('⛔ 인증 만료여도 전사 산출물은 그대로다', async () => {
    // 결과 영역이 실패했다고 전사를 지우면, 사람이 고친 것이 사라진다.
    const { screen } = await setup({ ...failed, documentRunState: 'auth_required' })
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

  it('⛔ 결과 자리를 가짜로 채우지 않는다', async () => {
    const { screen } = await setup(running)
    expect(screen.container.querySelector('[data-section]')).toBeNull()
  })
})

describe('⛔ 재교정하면 오래된 결과가 된다', () => {
  it('다른 교정본에서 나온 결과는 재검토 필요로 표시된다', async () => {
    const { screen } = await setup({ ...PROPOSED, revisionId: 'rev_0' })
    expect(screen.container.textContent).toContain('재검토 필요')
  })

  it('⛔ 오래됐다고 지우지 않는다 — 사람이 보고 판단한다', async () => {
    const { screen } = await setup({ ...PROPOSED, revisionId: 'rev_0' })
    expect(screen.container.textContent).toContain('오픈 일정을 두고 논의했고')
  })
})
