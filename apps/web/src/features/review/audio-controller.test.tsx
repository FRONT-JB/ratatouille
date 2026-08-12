import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAudioController } from './audio-controller'

function ControllerProbe() {
  const { controller, audioRef, bind } = useAudioController()

  return (
    <div>
      <audio ref={audioRef} data-testid='audio-probe' {...bind} />
      <output data-testid='playback-state'>{controller.state}</output>
      <output data-testid='current-ms'>{controller.currentMs}</output>
      <button type='button' onClick={() => controller.seek(12_000)}>
        외부 seek
      </button>
      <button type='button' onClick={() => controller.playAt(23_000)}>
        외부 playAt
      </button>
    </div>
  )
}

describe('외부 timestamp 연동', () => {
  it('seek는 위치만 옮기고 playAt은 위치를 옮긴 뒤 재생한다', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    const screen = await render(<ControllerProbe />)
    const audio = screen
      .getByTestId('audio-probe')
      .element() as HTMLAudioElement

    await screen.getByRole('button', { name: '외부 seek' }).click()
    expect(audio.currentTime).toBe(12)
    await expect
      .element(screen.getByTestId('current-ms'))
      .toHaveTextContent('12000')
    expect(play).not.toHaveBeenCalled()

    await screen.getByRole('button', { name: '외부 playAt' }).click()
    expect(audio.currentTime).toBe(23)
    expect(play).toHaveBeenCalledOnce()
  })
})

describe('브라우저 오디오 이벤트를 상태로 변환한다', () => {
  it('loading → paused → playing → ended를 명시적으로 구분한다', async () => {
    const screen = await render(<ControllerProbe />)
    const audio = screen
      .getByTestId('audio-probe')
      .element() as HTMLAudioElement
    const state = screen.getByTestId('playback-state')

    await expect.element(state).toHaveTextContent('loading')

    Object.defineProperty(audio, 'duration', { value: 60, configurable: true })
    audio.dispatchEvent(new Event('loadedmetadata'))
    await expect.element(state).toHaveTextContent('paused')

    audio.dispatchEvent(new Event('play'))
    await expect.element(state).toHaveTextContent('playing')

    audio.dispatchEvent(new Event('ended'))
    await expect.element(state).toHaveTextContent('ended')
  })

  it('오류 이벤트를 error 상태와 사용자 문구로 올린다', async () => {
    const screen = await render(<ControllerProbe />)
    const audio = screen
      .getByTestId('audio-probe')
      .element() as HTMLAudioElement

    audio.dispatchEvent(new Event('error'))

    await expect
      .element(screen.getByTestId('playback-state'))
      .toHaveTextContent('error')
  })
})
