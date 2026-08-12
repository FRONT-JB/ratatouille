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
    // 접혀 있으면 목록이 DOM에 없다 — 먼저 편다
    await screen.getByTestId('evidence-toggle').click()
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
    const box = screen.container.querySelector('[data-section=evidence]')!
    expect(box.getAttribute('data-state')).toBe('closed')
  })

  it('몇 건인지는 접힌 채로도 보인다', async () => {
    const { screen } = await setup(PROPOSED)
    expect(
      screen.container.querySelector('[data-testid=evidence-toggle]')!.textContent
    ).toContain('2건')
  })

  it('⛔ 브라우저 기본 라벨이 새어 나오지 않는다', async () => {
    // `<details>` 규칙을 어기면 브라우저가 「세부정보」를 그린다. 조용해서 위험하다.
    const { screen } = await setup(PROPOSED)
    expect(screen.container.textContent).not.toContain('세부정보')
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

  it('예전 데이터에 섞인 본문용 근거 마커를 입력칸에서 숨긴다', async () => {
    const dirty = {
      ...PROPOSED,
      proposal: {
        ...PROPOSAL,
        tasks: [
          {
            ...PROPOSAL.tasks[0]!,
            owner: '이한결[seg_53]',
            due: '내일[seg_61]',
          },
        ],
      },
    }
    const { screen } = await setup(dirty)
    expect(input(screen, 'Action Item 1 담당자').value).toBe('이한결')
    expect(input(screen, 'Action Item 1 기한').value).toBe('내일')
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

  it('담당자에 붙여 넣은 본문용 근거 마커는 제거해서 저장한다', async () => {
    const { screen, onEdit } = await setup(PROPOSED)
    const el = screen.getByRole('textbox', { name: 'Action Item 2 담당자' })
    await el.fill('지영[seg_1]')
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

  it('⛔ 하나의 토글이다 — 상태와 조작을 두 컨트롤로 쪼개지 않는다', async () => {
    const { screen } = await setup(PROPOSED)
    const el = screen.container.querySelector('[data-review-section=summary]')!
    expect(el.getAttribute('data-review-state')).toBe('unreviewed')

    const btn = el.querySelector('[data-testid=accept-summary]')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.textContent).toContain('확인함')
  })

  it('확인하면 눌린 상태가 된다', async () => {
    const { screen } = await setup({
      ...PROPOSED,
      review: {
        summary: { state: 'accepted', rubric: {} },
        decisions: { state: 'unreviewed', rubric: {} },
        tasks: { state: 'unreviewed', rubric: {} },
        evidence: { state: 'unreviewed', rubric: {} },
      },
    })
    expect(
      screen.container
        .querySelector('[data-testid=accept-summary]')!
        .getAttribute('aria-pressed')
    ).toBe('true')
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
    expect(
      screen.container
        .querySelector('[data-testid=accept-summary]')!
        .hasAttribute('disabled')
    ).toBe(true)
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
    // ⛔ 숫자 하나로 줄였다 — 「1건 남음」은 좁은 제목 줄을 밀어낸다
    expect(
      screen.container.querySelector('[data-review-section=decisions]')!.textContent
    ).toContain('1')
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

/**
 * degraded_draft — 규칙 5, Test 6.4.
 *
 * ⛔ **자동 fallback이 아니다.** 근거 검증에 실패한 결과가 그냥 그려지고 있었다.
 *    그게 곧 자동 fallback이고, 정상 산출물과 구분되지도 않았다.
 *
 * ⛔ **정상 산출물과 시각적으로 구분된다.** 확정할 수 없는 글이 확정할 수 있는
 *    글과 똑같이 보이면, 사람은 그걸 회의록으로 알고 남에게 보낸다.
 */
describe('⛔ 초안은 사람이 요청해야 보인다 — 규칙 5', () => {
  /** 없는 세그먼트를 인용해 검증에 실패했지만 내용은 남아 있는 결과 */
  const unverified: DocumentView = {
    ...PROPOSED,
    documentRunState: 'failed_retryable',
    error: '근거 검증에 실패했습니다 (1건). 다시 시도해 주세요.',
    violations: [{ kind: 'unknown_segment', message: 'seg_999는 전사문에 없다' }],
  }

  it('⛔ 요청 전에는 결과를 그리지 않는다 — 이게 자동 fallback이었다', async () => {
    const { screen } = await setup(unverified)
    expect(screen.container.querySelector('[data-section=decisions]')).toBeNull()
    expect(screen.container.querySelector('[data-testid=degraded-draft]')).toBeNull()
    // 실패한 사실과 이유는 그대로 보인다
    expect(screen.container.textContent).toContain('seg_999는 전사문에 없다')
  })

  /*
   * ⛔ **결과를 감추는 것과 위반을 감추는 것은 다른 일이다.** 서버는 「검증에
   *    실패한 결과도 버리지 않는다 — 못 보면 고칠 수 없다」는 이유로 위반을
   *    보관한다. 초안을 감추면서 위반까지 같이 사라지면 그 보관이 무의미해지고,
   *    사용자는 무엇이 잘못됐는지 알 방법이 없어진다.
   */
  it('⛔ 초안을 감춰도 위반 목록은 사라지지 않는다', async () => {
    const { screen } = await setup(unverified)

    expect(screen.container.querySelector('[data-section]')).toBeNull()
    // 실패 이유와 위반이 둘 다 남는다
    expect(screen.container.textContent).toContain('근거 검증에 실패했습니다')
    expect(screen.container.textContent).toContain('seg_999는 전사문에 없다')
    expect(screen.container.querySelector('[role=alert]')).toBeTruthy()
  })

  it('⛔ 초안을 요청한 뒤에도 위반 목록이 남는다 — 초안을 읽는 사람이 볼 것이 이것이다', async () => {
    const { screen } = await setup({ ...unverified, degradedDraft: true })
    const frame = screen.container.querySelector('[data-testid=degraded-draft]')!

    expect(frame.querySelector('[data-testid=draft-violations]')!.textContent).toContain(
      'seg_999는 전사문에 없다'
    )
  })

  it('⛔ 위반이 화면에 두 번 나오지 않는다 — 어느 쪽이 지금 상태인지 흐려진다', async () => {
    const { screen } = await setup({ ...unverified, degradedDraft: true })
    const text = screen.container.textContent ?? ''
    expect(text.split('seg_999는 전사문에 없다').length - 1).toBe(1)
  })

  it('「그래도 초안으로 보기」로 사람이 요청한다', async () => {
    const onRequestDraft = vi.fn()
    const screen = await render(
      <DocumentResult
        view={unverified}
        error={null}
        revisionId='rev_1'
        segments={SEGMENTS}
        onSeek={vi.fn()}
        onPlay={vi.fn()}
        onOpenTranscript={vi.fn()}
        onRetry={vi.fn()}
        onReview={vi.fn()}
        onEdit={vi.fn()}
        onRequestDraft={onRequestDraft}
      />
    )
    await screen.getByTestId('request-draft').click()
    expect(onRequestDraft).toHaveBeenCalledTimes(1)
  })

  it('⛔ 누르기 전에 무엇을 받게 되는지 말한다 — 확정할 수 없는 글이다', async () => {
    const screen = await render(
      <DocumentResult
        view={unverified}
        error={null}
        revisionId='rev_1'
        segments={SEGMENTS}
        onSeek={vi.fn()}
        onPlay={vi.fn()}
        onOpenTranscript={vi.fn()}
        onRetry={vi.fn()}
        onReview={vi.fn()}
        onEdit={vi.fn()}
        onRequestDraft={vi.fn()}
      />
    )
    expect(screen.container.textContent).toContain('확정할 수 없')
  })

  /*
   * ⛔ **부모가 조작을 안 주면 권하지도 않는다.** 초안을 만들 길이 없는데
   *    버튼을 그리면, 눌러도 아무 일이 없는 버튼이 된다 — 이 레포가 겪은
   *    「테스트가 통과하는 죽은 코드」가 정확히 이 모양이다.
   */
  it('⛔ onRequestDraft가 없으면 초안 버튼을 그리지 않는다 — 죽은 버튼도, 비활성 버튼도 아니다', async () => {
    // setup()은 onRequestDraft를 넘기지 않는다
    const { screen } = await setup(unverified)

    expect(screen.container.querySelector('[data-testid=request-draft]')).toBeNull()
    // 비활성 버튼으로 남아 있지도 않다 — 「초안」이라는 조작 자체가 없다
    const buttons = [...screen.container.querySelectorAll('button')]
    expect(buttons.some((b) => (b.textContent ?? '').includes('초안'))).toBe(false)
  })

  it('⛔ 초안 버튼이 없어도 탈출로는 남는다 — 막다른 골목을 만들지 않는다', async () => {
    const onRetry = vi.fn()
    const screen = await render(
      <DocumentResult
        view={unverified}
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

  it('결과가 없으면 초안을 권하지 않는다 — 보여줄 것이 없다', async () => {
    const screen = await render(
      <DocumentResult
        view={{ ...unverified, proposal: null }}
        error={null}
        revisionId='rev_1'
        segments={SEGMENTS}
        onSeek={vi.fn()}
        onPlay={vi.fn()}
        onOpenTranscript={vi.fn()}
        onRetry={vi.fn()}
        onReview={vi.fn()}
        onEdit={vi.fn()}
        onRequestDraft={vi.fn()}
      />
    )
    expect(screen.container.querySelector('[data-testid=request-draft]')).toBeNull()
  })
})

describe('⛔ 초안은 정상 산출물과 시각적으로 구분된다', () => {
  const draft: DocumentView = {
    ...PROPOSED,
    documentRunState: 'failed_retryable',
    degradedDraft: true,
    error: '근거 검증에 실패했습니다 (1건). 다시 시도해 주세요.',
    violations: [{ kind: 'unknown_segment', message: 'seg_999는 전사문에 없다' }],
  }

  it('요청했으면 내용이 보인다 — 읽으려고 요청한 것이다', async () => {
    const { screen } = await setup(draft)
    expect(screen.container.querySelector('[data-section=decisions]')).toBeTruthy()
    expect(screen.container.textContent).toContain('오픈을 3월 16일로 연기하기로 했다')
  })

  it('초안이라고 말하고, 정상 결과에는 그 표시가 없다', async () => {
    const { screen } = await setup(draft)
    const frame = screen.container.querySelector('[data-testid=degraded-draft]')!
    expect(frame).toBeTruthy()
    expect(frame.textContent).toContain('초안')

    const normal = await setup(PROPOSED)
    expect(
      normal.screen.container.querySelector('[data-testid=degraded-draft]')
    ).toBeNull()
  })

  it('⛔ 결과 자체가 초안 액자 안에 들어간다 — 위쪽 배너 한 줄로는 스크롤하면 사라진다', async () => {
    const { screen } = await setup(draft)
    const frame = screen.container.querySelector('[data-testid=degraded-draft]')!
    expect(frame.querySelector('[data-section=decisions]')).toBeTruthy()
    expect(frame.querySelector('[data-section=tasks]')).toBeTruthy()
  })

  it('⛔ 확정할 수 없다는 말이 결과와 같은 자리에 있다', async () => {
    const { screen } = await setup(draft)
    const frame = screen.container.querySelector('[data-testid=degraded-draft]')!
    expect(frame.textContent).toContain('확정할 수 없')
  })

  it('⛔ 초안은 검수할 수 없다 — 확정 못 하는 것을 확인하게 두지 않는다', async () => {
    const { screen } = await setup(draft)
    expect(
      screen.container
        .querySelector('[data-testid=accept-summary]')!
        .hasAttribute('disabled')
    ).toBe(true)
  })

  it('⛔ 초안은 고칠 수 없다 — 고쳐서 통과시키는 길을 만들지 않는다', async () => {
    const { screen } = await setup(draft)
    expect(screen.container.querySelector('[aria-label="결정 1 고치기"]')).toBeNull()
  })

  it('초안에서도 근거로 음성에 닿는다 — 그러지 못하면 읽을 가치가 없다', async () => {
    const { screen } = await setup(draft)
    const section = screen.container.querySelector('[data-section=decisions]')!
    expect(section.querySelectorAll('button[data-cite]').length).toBeGreaterThan(0)
  })

  it('초안에서 나가는 길이 있다 — 다시 정리하는 것이 정답이다', async () => {
    const onRetry = vi.fn()
    const screen = await render(
      <DocumentResult
        view={draft}
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
    await screen.getByRole('button', { name: '다시 정리' }).click()
    expect(onRetry).toHaveBeenCalled()
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
