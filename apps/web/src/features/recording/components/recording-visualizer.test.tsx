import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { resetAnalyserPool, resumeAudio, sharedAudioContext } from '../analyser-pool'
import { RecordingVisualizer } from './recording-visualizer'

let ctx: AudioContext | null = null

afterEach(async () => {
  await resetAnalyserPool()
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

describe('⛔ 같은 stream을 두 곳에서 봐도 둘 다 움직인다', () => {
  // 실제로 겪은 결함: 시작 전 `LevelMeter`와 녹음 중 `RecordingVisualizer`가
  // 같은 MediaStream에 **각각** AudioContext를 만들었다. Chrome은 같은 track에
  // 두 번째 source node가 붙으면 데이터를 끊는다. 탭 오디오가 max -0.0 dB로
  // 멀쩡히 녹음되는데 마이크·탭 파형이 **둘 다** 평평했다.

  it('한 stream에 visualizer가 둘이어도 양쪽 다 레벨을 읽는다', async () => {
    const stream = await toneStream(0.5)
    const screen = await render(
      <>
        <RecordingVisualizer stream={stream} active label='마이크' />
        <RecordingVisualizer stream={stream} active label='탭 오디오' />
      </>
    )
    await settle()

    const els = [...screen.container.querySelectorAll('[data-testid=recording-visualizer]')]
    expect(els.length).toBe(2)
    for (const el of els) expect(levelOf(el)).toBeGreaterThan(0.3)
  })

  it('앞의 것이 사라진 뒤 새로 붙어도 읽는다 — 준비 화면 → 녹음 화면 전환', async () => {
    const stream = await toneStream(0.5)
    const screen = await render(
      <RecordingVisualizer key='before' stream={stream} active label='마이크' />
    )
    await settle(200)

    // 준비 화면이 사라지고 녹음 화면이 붙는다. key가 다르므로 unmount → mount다.
    await screen.rerender(<div />)
    await screen.rerender(
      <RecordingVisualizer key='during' stream={stream} active label='마이크' />
    )
    await settle()

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    expect(levelOf(el)).toBeGreaterThan(0.3)
  })
})

describe('⛔ 못 읽는 상태는 무음과 구분된다', () => {
  // 실제로 겪은 결함: 예전 구현은 `await ctx.resume()`이 끝난 **뒤에야** rAF
  // 루프를 시작했다. 사용자 제스처 없이 만든 AudioContext에서 `resume()`은
  // 영영 pending으로 남을 수 있고, 그러면 루프가 아예 안 돈다. 화면은 완전히
  // 평평하고, 그게 무음인지 고장인지 알 방법이 없다 — 실제로 탭 오디오는
  // max -0.0 dB로 멀쩡히 녹음되고 있었다.

  it('context가 멈춰 있어도 루프는 돌고, 그 사실이 화면에 뜬다', async () => {
    const stream = await toneStream(0.5)
    await sharedAudioContext().suspend()

    const screen = await render(
      <RecordingVisualizer stream={stream} active label='마이크' />
    )
    await settle(1200)

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    expect(el.getAttribute('data-reading')).toBe('false')
    expect(screen.container.textContent).toContain('입력 레벨을 읽을 수 없습니다')

    // 깨우면 곧바로 따라온다 — 되돌릴 수 없는 상태가 아니다
    await resumeAudio()
    await settle()
    expect(levelOf(el)).toBeGreaterThan(0.3)
    expect(screen.container.textContent).not.toContain('입력 레벨을 읽을 수 없습니다')
  })

  it('레벨을 읽고 있으면 data-reading이 true다', async () => {
    const stream = await toneStream(0)
    const screen = await render(
      <RecordingVisualizer stream={stream} active label='마이크' />
    )
    await settle()

    const el = screen.container.querySelector('[data-testid=recording-visualizer]')!
    // 무음이지만 **읽고는 있다**. 이 둘이 같은 화면이면 안 된다.
    expect(levelOf(el)).toBe(0)
    expect(el.getAttribute('data-reading')).toBe('true')
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
