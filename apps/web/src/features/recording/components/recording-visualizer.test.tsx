import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { RecordingVisualizer } from './recording-visualizer'

let ctx: AudioContext | null = null

afterEach(async () => {
  await ctx?.close().catch(() => undefined)
  ctx = null
})

/** 실제 소리가 흐르는 MediaStream */
async function toneStream(gain: number): Promise<MediaStream> {
  const audio = new AudioContext()
  ctx = audio
  if (audio.state === 'suspended') await audio.resume()
  const osc = audio.createOscillator()
  osc.frequency.value = 440
  const g = audio.createGain()
  g.gain.value = gain
  const dest = audio.createMediaStreamDestination()
  osc.connect(g).connect(dest)
  osc.start()
  return dest.stream
}

const levelOf = (el: Element) => Number(el.getAttribute('data-level'))

async function settle(ms = 400) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('⛔ visualizer는 실제 오디오 입력에 반응한다', () => {
  // 품질 게이트: "visualizer가 실제 오디오 입력에 반응한다 (무음 시 정지 확인)".
  // 장식 animation이면 마이크가 죽어도 계속 움직여서, 사용자가 30분 뒤에야
  // 무음 파일을 발견한다. 파형이 움직인다는 것 자체가 입력이 살아 있다는 증거여야 한다.

  it('소리가 흐르면 레벨이 올라간다', async () => {
    const stream = await toneStream(0.5)
    const screen = await render(
      <RecordingVisualizer stream={stream} active label='마이크' />
    )
    await settle()

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    expect(levelOf(el)).toBeGreaterThan(0.3)
  })

  it('⛔ 무음이면 파형이 멈춘다', async () => {
    const stream = await toneStream(0)
    const screen = await render(
      <RecordingVisualizer stream={stream} active label='마이크' />
    )
    await settle()

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    expect(levelOf(el)).toBe(0)
  })

  it('stream이 없으면 0이다 — 지어내지 않는다', async () => {
    const screen = await render(
      <RecordingVisualizer stream={null} active label='마이크' />
    )
    await settle(150)

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    expect(levelOf(el)).toBe(0)
  })

  it('일시정지 중에는 소리가 있어도 움직이지 않는다', async () => {
    const stream = await toneStream(0.5)
    const screen = await render(
      <RecordingVisualizer stream={stream} active={false} label='마이크' />
    )
    await settle()

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    expect(levelOf(el)).toBe(0)
  })
})

describe('접근성', () => {
  it('레벨을 스크린리더가 읽을 수 있다', async () => {
    const stream = await toneStream(0.5)
    const screen = await render(
      <RecordingVisualizer stream={stream} active label='마이크' />
    )
    await settle()

    await expect
      .element(screen.getByRole('img', { name: /마이크 입력 레벨/ }))
      .toBeInTheDocument()
  })
})
