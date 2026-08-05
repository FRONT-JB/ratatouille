import { afterEach, describe, expect, it } from 'vitest'
import {
  LevelMonitor,
  SILENCE_RMS,
  levelToBarHeight,
  readLevel,
} from './audio-level'

describe('레벨 계산', () => {
  it('무음은 0이다', () => {
    expect(readLevel(new Float32Array(128))).toMatchObject({ rms: 0, silent: true })
  })

  it('소리가 있으면 무음이 아니다', () => {
    const s = new Float32Array(128).fill(0.5)
    const r = readLevel(s)
    expect(r.rms).toBeCloseTo(0.5, 5)
    expect(r.silent).toBe(false)
  })

  it('피크를 따로 잡는다 — RMS에 묻히는 순간 소리', () => {
    const s = new Float32Array(1000)
    s[500] = 0.9
    expect(readLevel(s).peak).toBeCloseTo(0.9, 5)
    expect(readLevel(s).rms).toBeLessThan(0.1)
  })

  it('아주 작은 소리는 무음으로 본다', () => {
    const s = new Float32Array(128).fill(SILENCE_RMS / 2)
    expect(readLevel(s).silent).toBe(true)
  })

  it('빈 배열도 처리한다', () => {
    expect(readLevel(new Float32Array(0)).silent).toBe(true)
  })
})

describe('막대 높이 변환', () => {
  it('무음은 0이다', () => {
    expect(levelToBarHeight(0)).toBe(0)
  })

  it('최대는 1을 넘지 않는다', () => {
    expect(levelToBarHeight(2)).toBe(1)
  })

  it('⛔ 대화 수준 소리가 눈에 보이게 움직인다', () => {
    // RMS를 그대로 높이로 쓰면 대화(0.01~0.1)에서 막대가 1~10%만 움직인다.
    // 사용자는 파형이 죽은 줄 안다.
    const quiet = levelToBarHeight(0.01)
    const loud = levelToBarHeight(0.1)
    expect(quiet).toBeGreaterThan(0.2)
    expect(loud - quiet).toBeGreaterThan(0.15)
  })

  it('클수록 높다', () => {
    expect(levelToBarHeight(0.5)).toBeGreaterThan(levelToBarHeight(0.05))
  })
})

describe('⛔ 실제 MediaStream에 반응한다 — 장식 animation이 아니다', () => {
  // 품질 게이트: "visualizer가 실제 오디오 입력에 반응한다 (무음 시 정지 확인)".
  // 진짜 오디오 그래프를 만들어 확인한다. mock이 아니다.

  let ctx: AudioContext | null = null
  let monitor: LevelMonitor | null = null

  afterEach(async () => {
    await monitor?.dispose()
    monitor = null
    await ctx?.close().catch(() => undefined)
    ctx = null
  })

  /** 실제 소리가 흐르는 MediaStream을 만든다 */
  async function toneStream(gain: number): Promise<{
    stream: MediaStream
    ctx: AudioContext
  }> {
    const audio = new AudioContext()
    if (audio.state === 'suspended') await audio.resume()
    const osc = audio.createOscillator()
    osc.frequency.value = 440
    const g = audio.createGain()
    g.gain.value = gain
    const dest = audio.createMediaStreamDestination()
    osc.connect(g).connect(dest)
    osc.start()
    return { stream: dest.stream, ctx: audio }
  }

  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

  it('소리가 흐르면 레벨이 올라간다', async () => {
    const t = await toneStream(0.5)
    ctx = t.ctx
    monitor = new LevelMonitor()
    await monitor.start(t.stream, t.ctx)
    await settle()

    expect(monitor.read().rms).toBeGreaterThan(SILENCE_RMS)
  })

  it('⛔ 무음이면 레벨이 0에 머문다 — 파형이 멈춘다', async () => {
    const t = await toneStream(0)
    ctx = t.ctx
    monitor = new LevelMonitor()
    await monitor.start(t.stream, t.ctx)
    await settle()

    const r = monitor.read()
    expect(r.silent).toBe(true)
    expect(levelToBarHeight(r.rms)).toBe(0)
  })

  it('소리를 끄면 레벨이 따라 떨어진다', async () => {
    const audio = new AudioContext()
    if (audio.state === 'suspended') await audio.resume()
    ctx = audio
    const osc = audio.createOscillator()
    const g = audio.createGain()
    g.gain.value = 0.5
    const dest = audio.createMediaStreamDestination()
    osc.connect(g).connect(dest)
    osc.start()

    monitor = new LevelMonitor()
    await monitor.start(dest.stream, audio)
    await settle()
    const loud = monitor.read().rms

    g.gain.setValueAtTime(0, audio.currentTime)
    await settle()
    const quiet = monitor.read().rms

    expect(loud).toBeGreaterThan(SILENCE_RMS)
    expect(quiet).toBeLessThan(loud)
  })
})

describe('무음 유예', () => {
  it('짧은 무음으로는 경고하지 않는다 — 말 사이의 쉼', () => {
    let t = 0
    const m = new LevelMonitor({ silenceGraceMs: 3000, now: () => t })
    // start 없이 read()는 무음을 준다
    expect(m.isSilentTooLong()).toBe(false)
    t = 1000
    expect(m.isSilentTooLong()).toBe(false)
  })

  it('유예를 넘기면 경고한다', () => {
    let t = 0
    const m = new LevelMonitor({ silenceGraceMs: 3000, now: () => t })
    m.isSilentTooLong()
    t = 3500
    expect(m.isSilentTooLong()).toBe(true)
  })
})
