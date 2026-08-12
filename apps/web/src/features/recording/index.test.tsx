import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { RecordingPage } from './index'
import type { RecordingDeps } from './use-recording'

let ctx: AudioContext | null = null

afterEach(async () => {
  await ctx?.close().catch(() => undefined)
  ctx = null
})

async function toneStream(gain = 0.4): Promise<MediaStream> {
  const audio = ctx ?? new AudioContext()
  ctx = audio
  if (audio.state === 'suspended') await audio.resume()
  const osc = audio.createOscillator()
  const g = audio.createGain()
  g.gain.value = gain
  const dest = audio.createMediaStreamDestination()
  osc.connect(g).connect(dest)
  osc.start()
  return dest.stream
}

/** 마이크 권한이 승인되고 장치가 하나 있는 상태 */
async function grantedDeps(
  over: Partial<RecordingDeps> = {}
): Promise<RecordingDeps> {
  const stream = await toneStream()
  return {
    getUserMedia: async () => stream,
    getDisplayMedia: async () => {
      throw new Error('사용자가 취소')
    },
    ...over,
  }
}

const q = (root: Element, sel: string) => root.querySelector(sel)

describe('⛔ 자동으로 녹음이 시작되지 않는다', () => {
  it('마운트만으로 마이크를 켜지 않는다', async () => {
    const gum = vi.fn(async () => new MediaStream())
    await render(<RecordingPage deps={{ getUserMedia: gum }} />)

    expect(gum).not.toHaveBeenCalled()
  })

  it('권한을 받아도 저절로 시작하지 않는다', async () => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)

    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )
    await expect
      .element(screen.getByRole('button', { name: /녹음 시작/ }))
      .toBeInTheDocument()

    // 시작 버튼이 보이는 것이지 시작된 것이 아니다
    expect(q(screen.container, '[data-testid=recording-status]')).toBeNull()
  })
})

describe('⛔ 온라인 모드는 탭 track 없이 시작되지 않는다', () => {
  // PLAN.md 순서 2 완료 조건 1.

  it('경고가 표시된다', async () => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )
    await userEvent.click(screen.getByRole('radio', { name: /온라인 회의/ }))

    await expect
      .element(screen.getByText(/상대방 목소리가 녹음되지 않습니다/))
      .toBeInTheDocument()
  })

  it('시작 버튼이 사라진다 — 누를 수 있는 상태로 두지 않는다', async () => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )
    await userEvent.click(screen.getByRole('radio', { name: /온라인 회의/ }))

    expect(
      screen.container.querySelector(
        '[data-testid=blocker-online_requires_remote]'
      )
    ).not.toBeNull()
    await expect
      .element(screen.getByRole('button', { name: /녹음 시작/ }))
      .not.toBeInTheDocument()
  })

  it('대면 모드는 탭 없이 시작할 수 있다', async () => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )

    await expect
      .element(screen.getByRole('button', { name: /녹음 시작/ }))
      .toBeInTheDocument()
  })

  it('회의 방식은 방향키로 바꿀 수 있다', async () => {
    const screen = await render(<RecordingPage />)
    const inPerson = screen.getByRole('radio', { name: /대면 회의/ })
    const online = screen.getByRole('radio', { name: /온라인 회의/ })

    inPerson.element().focus()
    await userEvent.keyboard('{ArrowRight}')

    expect((online.element() as HTMLInputElement).checked).toBe(true)
  })

  it('탭을 공유했지만 오디오가 없으면 그 사실을 알린다', async () => {
    // 사용자가 "탭 오디오도 공유"를 체크하지 않은 흔한 실수.
    // 조용히 통과시키면 상대방 목소리 없는 녹음이 된다.
    const videoOnly = new MediaStream()
    const screen = await render(
      <RecordingPage
        deps={await grantedDeps({ getDisplayMedia: async () => videoOnly })}
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )
    await userEvent.click(screen.getByRole('radio', { name: /온라인 회의/ }))
    await userEvent.click(
      screen.getByRole('button', { name: '탭 오디오 공유' })
    )

    await expect
      .element(screen.getByText(/탭 오디오도 공유/))
      .toBeInTheDocument()
  })
})

describe('사전 level meter가 각각 표시된다', () => {
  it('마이크 meter가 있다', async () => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )

    await expect
      .element(screen.getByRole('meter', { name: '마이크 입력 레벨' }))
      .toBeInTheDocument()
  })

  it('⛔ 온라인 모드에서는 탭 meter가 따로 있다', async () => {
    // 하나로 합치면 어느 쪽이 죽었는지 알 수 없다.
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )
    await userEvent.click(screen.getByRole('radio', { name: /온라인 회의/ }))

    await expect
      .element(screen.getByRole('meter', { name: '마이크 입력 레벨' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('meter', { name: '탭 오디오 입력 레벨' }))
      .toBeInTheDocument()
  })
})

describe('권한 거부', () => {
  it('별도 상태로 표시된다', async () => {
    const screen = await render(
      <RecordingPage
        deps={{
          getUserMedia: async () => {
            throw new DOMException('거부', 'NotAllowedError')
          },
        }}
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )

    await expect
      .element(screen.getByText(/마이크 권한이 거부되었습니다/))
      .toBeInTheDocument()
  })
})

describe('⛔ 녹음 중 페이지에 없어야 하는 것', () => {
  // PLAN.md 순서 2 금지 항목. 회의 중에 결과를 보여주면
  // 사용자가 회의가 아니라 화면을 보게 된다.

  const FORBIDDEN = [
    '전사',
    '요약',
    '결정 사항',
    'Action Item',
    '할 일',
    '검수',
    '근거',
  ]

  it.each(FORBIDDEN)('"%s" 관련 UI가 없다', async (word) => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )

    expect(screen.container.textContent).not.toContain(word)
  })

  it('입력 필드나 편집 영역이 없다 — 검수 UI의 흔적', async () => {
    const screen = await render(<RecordingPage deps={await grantedDeps()} />)
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )

    expect(screen.container.querySelector('textarea')).toBeNull()
    expect(screen.container.querySelector('input[type=text]')).toBeNull()
  })
})

describe('⛔ 녹음 종료 후 "저장 중"에 갇히지 않는다', () => {
  // 실제로 겪은 결함: 서버는 이미 ready인데 화면이 "저장 중 00:58"에 머물렀다.
  // stop()이 phase를 stopping으로 바꾸고 성공해도 아무것도 하지 않았기 때문이다.
  // 화면 계약: "녹음 종료 후 즉시 페이지 B 로딩 상태로 이동".

  /** 업로드까지 성공하는 가짜 서버 */
  const okFetch = async (url: string) => {
    const body = url.endsWith('/finalize')
      ? { sourceState: 'ready' }
      : url.endsWith('/missing')
        ? { missing: {} }
        : {}
    return new Response(JSON.stringify(body), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  }

  async function recordAndStop(onFinished?: (id: string) => void) {
    const stream = await toneStream()
    const screen = await render(
      <RecordingPage
        onFinished={onFinished}
        deps={{
          getUserMedia: async () => stream,
          newSourceId: () => 'src_stuck_test',
          uploader: undefined,
          // 업로더는 내부에서 만들지만 fetch를 갈아끼울 수 없어
          // 전역 fetch를 잠시 대체한다
        }}
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: '마이크 권한 요청' })
    )
    await userEvent.click(screen.getByRole('button', { name: /녹음 시작/ }))
    await new Promise((r) => setTimeout(r, 300))
    await userEvent.click(screen.getByRole('button', { name: /녹음 종료/ }))
    return screen
  }

  it('종료가 끝나면 onFinished로 알려준다', async () => {
    const original = globalThis.fetch
    globalThis.fetch = okFetch as typeof fetch
    try {
      const done: string[] = []
      await recordAndStop((id) => done.push(id))

      // 종료 처리가 끝날 때까지 기다린다
      const deadline = Date.now() + 5000
      while (done.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(done).toEqual(['src_stuck_test'])
    } finally {
      globalThis.fetch = original
    }
  })

  it('⛔ onFinished가 없어도 갇히지 않는다 — 회의로 가는 길이 화면에 남는다', async () => {
    const original = globalThis.fetch
    globalThis.fetch = okFetch as typeof fetch
    try {
      const screen = await recordAndStop()

      const deadline = Date.now() + 5000
      while (
        !screen.container.querySelector('[data-testid=recording-finished]') &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 50))
      }
      await expect
        .element(screen.getByTestId('recording-finished'))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('link', { name: '회의 열기' }))
        .toBeInTheDocument()
    } finally {
      globalThis.fetch = original
    }
  })
})
