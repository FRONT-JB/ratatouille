/**
 * MediaStream의 실제 입력 레벨 측정.
 *
 * ⛔ 화면 계약: "visualizer는 **실제 `MediaStream` level에 반응**한다.
 *    장식 animation이 아니다."
 *
 * 이유가 있다. 장식 animation은 마이크가 죽어도 계속 움직인다. 사용자는
 * 30분 동안 녹음이 되고 있다고 믿다가 끝나고 나서야 무음 파일을 발견한다.
 * 파형이 소리에 반응한다는 것 자체가 **입력이 살아 있다는 증거**여야 한다.
 *
 * 그래서 무음 판정도 여기서 한다 — `silent`는 화면 경고의 근거가 된다.
 */

/** 이 값 아래는 무음으로 본다. RMS 기준. */
export const SILENCE_RMS = 0.005

/** 무음이 이만큼 이어지면 경고한다 */
const SILENCE_GRACE_MS = 3000

export type LevelReading = {
  /** 0~1로 정규화된 RMS */
  rms: number
  /** 최근 구간의 최대값 — 순간 피크를 놓치지 않게 */
  peak: number
  silent: boolean
}

export function readLevel(samples: Float32Array): LevelReading {
  if (samples.length === 0) return { rms: 0, peak: 0, silent: true }

  let sum = 0
  let peak = 0
  for (const v of samples) {
    sum += v * v
    const a = Math.abs(v)
    if (a > peak) peak = a
  }
  const rms = Math.sqrt(sum / samples.length)
  return { rms, peak, silent: rms < SILENCE_RMS }
}

/**
 * 파형 막대 높이로 바꾼다.
 *
 * RMS를 그대로 쓰면 사람 말소리 구간에서 거의 움직이지 않는다(대화 RMS는
 * 보통 0.01~0.1). 로그 스케일로 펴서 눈에 보이게 한다.
 */
export function levelToBarHeight(rms: number): number {
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  // -60dB ~ 0dB를 0~1로
  return Math.min(1, Math.max(0, (db + 60) / 60))
}

export type LevelMonitorOptions = {
  fftSize?: number
  silenceGraceMs?: number
  now?: () => number
}

/**
 * MediaStream 하나를 계속 관찰한다.
 *
 * `AudioContext`는 사용자 제스처 없이는 suspended로 남는다(Phase 0에서 실측).
 * `start()`가 `resume()`을 부르지만, 호출부가 클릭 핸들러 안에 있어야 한다.
 */
export class LevelMonitor {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private buffer: Float32Array<ArrayBuffer> | null = null
  private silentSince: number | null = null
  private readonly silenceGraceMs: number
  private readonly fftSize: number
  private readonly now: () => number

  constructor(opts: LevelMonitorOptions = {}) {
    this.fftSize = opts.fftSize ?? 2048
    this.silenceGraceMs = opts.silenceGraceMs ?? SILENCE_GRACE_MS
    this.now = opts.now ?? (() => performance.now())
  }

  async start(stream: MediaStream, ctx?: AudioContext): Promise<void> {
    this.stop()
    this.ctx = ctx ?? new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = this.fftSize
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    // 스피커로 내보내지 않는다 — 하울링이 생긴다
    this.silentSince = null
  }

  read(): LevelReading {
    if (!this.analyser || !this.buffer) return { rms: 0, peak: 0, silent: true }
    this.analyser.getFloatTimeDomainData(this.buffer)
    return readLevel(this.buffer)
  }

  /**
   * 무음이 유예 시간을 넘겼는지.
   *
   * 순간 무음(말 사이의 쉼)으로 경고하면 회의 내내 경고가 깜빡인다.
   */
  isSilentTooLong(): boolean {
    const { silent } = this.read()
    const t = this.now()
    if (!silent) {
      this.silentSince = null
      return false
    }
    if (this.silentSince === null) {
      this.silentSince = t
      return false
    }
    return t - this.silentSince >= this.silenceGraceMs
  }

  stop(): void {
    this.source?.disconnect()
    this.analyser?.disconnect()
    // AudioContext는 호출부가 준 것일 수 있으므로 닫지 않는다.
    // 우리가 만든 것만 닫는다.
    this.source = null
    this.analyser = null
    this.buffer = null
    this.silentSince = null
  }

  async dispose(): Promise<void> {
    this.stop()
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
  }
}
