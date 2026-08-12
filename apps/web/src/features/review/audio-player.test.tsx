import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import type {
  AudioController,
  AudioPlaybackState,
  useAudioController,
} from './audio-controller'
import { AudioPlayer } from './audio-player'

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]

afterEach(() => {
  vi.restoreAllMocks()
  page.viewport(1440, 900)
})

function controller(
  state: AudioPlaybackState,
  over: Partial<AudioController> = {}
): AudioController {
  return {
    seek: vi.fn(),
    playAt: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    currentMs: 15_000,
    playing: state === 'playing',
    state,
    error:
      state === 'error'
        ? '오디오를 불러오지 못했습니다. 조각이 아직 정리되지 않았을 수 있습니다.'
        : null,
    duration: state === 'loading' ? null : 60_000,
    ...over,
  }
}

const bind = {
  onLoadStart: vi.fn(),
  onTimeUpdate: vi.fn(),
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onWaiting: vi.fn(),
  onCanPlay: vi.fn(),
  onEnded: vi.fn(),
  onLoadedMetadata: vi.fn(),
  onError: vi.fn(),
} satisfies ReturnType<typeof useAudioController>['bind']

async function setup(
  state: AudioPlaybackState,
  over?: Partial<AudioController>
) {
  const audioRef = createRef<HTMLAudioElement>()
  const value = controller(state, over)
  const screen = await render(
    <AudioPlayer
      sourceId='src_01'
      controller={value}
      audioRef={audioRef}
      bind={bind}
    />
  )
  return { screen, value, audioRef }
}

describe('플레이어 상태 5종', () => {
  it.each([
    ['loading', '오디오 불러오는 중'],
    ['paused', '재생 준비'],
    ['playing', '재생 중'],
    ['ended', '재생 완료'],
    ['error', '오디오 오류'],
  ] as const)('%s 상태를 문구와 아이콘으로 구분한다', async (state, label) => {
    const { screen } = await setup(state)
    const player = screen.getByTestId('audio-player')

    await expect.element(player).toHaveAttribute('data-state', state)
    await expect.element(screen.getByText(label)).toBeInTheDocument()
    expect(player.element().querySelector('[data-state-icon]')).toBeTruthy()
  })

  it('reduced-motion에서는 loading 회전 표시를 정지한다', async () => {
    const { screen } = await setup('loading')
    const icon = screen.container.querySelector('[data-state-icon]')

    expect(icon?.classList.contains('animate-spin')).toBe(true)
    expect(icon?.classList.contains('motion-reduce:animate-none')).toBe(true)
  })

  it('상태 문구만 live region에 두고 시계는 제외한다', async () => {
    const { screen } = await setup('playing')
    const liveRegion = screen.getByRole('status').element()
    const clock = screen.getByTestId('audio-clock').element()

    expect(liveRegion.textContent).toContain('재생 중')
    expect(liveRegion.contains(clock)).toBe(false)
  })
})

describe('플레이어 조작 계약', () => {
  it('재생 중에는 일시정지, 완료 뒤에는 처음부터 재생한다', async () => {
    const playing = await setup('playing')
    await playing.screen.getByRole('button', { name: '일시정지' }).click()
    expect(playing.value.pause).toHaveBeenCalledOnce()

    const ended = await setup('ended')
    await ended.screen.getByRole('button', { name: '처음부터 재생' }).click()
    expect(ended.value.seek).toHaveBeenCalledWith(0)
    expect(ended.value.play).toHaveBeenCalledOnce()
  })

  it('포인터와 키보드로 진행 막대를 탐색한다', async () => {
    const { screen, value } = await setup('paused')
    const slider = screen.getByRole('slider', { name: '재생 위치' })

    await slider.fill('30000')
    expect(value.seek).toHaveBeenLastCalledWith(30_000)

    slider.element().focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(value.seek).toHaveBeenLastCalledWith(16_000)
    expect(getComputedStyle(slider.element()).height).toBe('44px')
  })

  it('source가 바뀌면 상태와 브라우저 오디오를 초기화한다', async () => {
    const load = vi
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => undefined)
    const audioRef = createRef<HTMLAudioElement>()
    const value = controller('paused')
    const screen = await render(
      <AudioPlayer
        sourceId='src_01'
        controller={value}
        audioRef={audioRef}
        bind={bind}
      />
    )

    await screen.rerender(
      <AudioPlayer
        sourceId='src_02'
        controller={value}
        audioRef={audioRef}
        bind={bind}
      />
    )

    expect(value.reset).toHaveBeenCalled()
    expect(load).toHaveBeenCalled()
  })

  it('오류를 숨기지 않고 다시 불러올 수 있다', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(
      () => undefined
    )
    const { screen, value } = await setup('error')

    await expect.element(screen.getByRole('alert')).toBeInTheDocument()
    await screen.getByRole('button', { name: '오디오 다시 불러오기' }).click()
    expect(value.reset).toHaveBeenCalled()
  })
})

describe('플레이어 반응형', () => {
  it.each(VIEWPORTS)(
    '$widthpx에서 수평 오버플로가 없다',
    async ({ width, height }) => {
      await page.viewport(width, height)
      await setup('paused')

      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      )
    }
  )
})
