/**
 * MediaStream 하나당 analyser 하나를 **공유한다.**
 *
 * ⛔ 왜 필요한가 (실제로 겪은 결함):
 *    시작 전에는 `LevelMeter`가, 녹음 중에는 `RecordingVisualizer`가 각각
 *    `new AudioContext()` + `createMediaStreamSource(stream)`을 만들었다.
 *    화면이 전환될 때 이전 context의 `close()`는 fire-and-forget이라 아직
 *    살아 있고, **같은 track에 두 번째 source node가 붙으면 Chrome이 데이터를
 *    흘려보내지 않는다.** 소리는 멀쩡히 녹음되는데 파형만 평평해진다.
 *    (실측: 탭 오디오 max_volume -0.0 dB인데 레벨 0)
 *
 * ⛔ AudioContext도 하나만 만든다. 브라우저는 페이지당 개수를 제한하고,
 *    만들고 닫기를 반복하면 그 한도에 걸린다.
 */

export type AnalyserHandle = {
  read: (buffer: Float32Array<ArrayBuffer>) => void
  buffer: Float32Array<ArrayBuffer>
  /** context가 실제로 돌고 있는가. suspended면 데이터가 안 온다 */
  isRunning: () => boolean
}

type Entry = {
  analyser: AnalyserNode
  source: MediaStreamAudioSourceNode
  buffer: Float32Array<ArrayBuffer>
  refs: number
}

const FFT_SIZE = 2048

let sharedCtx: AudioContext | null = null
const entries = new Map<MediaStream, Entry>()

/**
 * 공유 AudioContext.
 *
 * ⚠️ **사용자 제스처 안에서 처음 부르는 것이 안전하다.** Chrome은 sticky
 *    activation 덕에 이후에도 resume되지만, Safari는 제스처 핸들러 밖에서
 *    만든 context를 영영 suspended로 둔다.
 */
export function sharedAudioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext()
  }
  return sharedCtx
}

/**
 * context가 실제로 돌고 있는가.
 *
 * ⚠️ 한 곳에서만 판단한다. 호출부마다 `ctx.state`를 직접 보면, 위에서 한 번
 *    비교한 뒤 TS가 타입을 좁혀 두는 바람에 아래 비교가 컴파일되지 않는다.
 */
export function audioRunning(): boolean {
  return sharedCtx?.state === 'running'
}

/** context가 멈춰 있으면 깨운다. 실패해도 던지지 않는다 — 파형만 안 움직인다. */
export async function resumeAudio(): Promise<boolean> {
  const ctx = sharedAudioContext()
  if (ctx.state !== 'running') {
    try {
      await ctx.resume()
    } catch {
      return false
    }
  }
  return audioRunning()
}

export function acquireAnalyser(stream: MediaStream): AnalyserHandle | null {
  if (stream.getAudioTracks().length === 0) return null

  let entry = entries.get(stream)
  if (!entry) {
    const ctx = sharedAudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    // 스피커로 내보내지 않는다 — 하울링이 생긴다
    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)
    entry = {
      analyser,
      source,
      buffer: new Float32Array(analyser.fftSize),
      refs: 0,
    }
    entries.set(stream, entry)
  }
  entry.refs++

  const e = entry
  return {
    buffer: e.buffer,
    read: (buf) => e.analyser.getFloatTimeDomainData(buf),
    isRunning: audioRunning,
  }
}

/**
 * 참조를 놓는다. 마지막 사용자가 놓을 때만 실제로 끊는다.
 *
 * ⚠️ AudioContext는 닫지 않는다. 다른 stream이 쓰고 있을 수 있고,
 *    닫았다 다시 만드는 것이 애초의 결함 원인이었다.
 */
export function releaseAnalyser(stream: MediaStream): void {
  const entry = entries.get(stream)
  if (!entry) return
  entry.refs--
  if (entry.refs > 0) return
  entry.source.disconnect()
  entry.analyser.disconnect()
  entries.delete(stream)
}

/** 테스트용. 프로덕션 경로에서는 부르지 않는다. */
export async function resetAnalyserPool(): Promise<void> {
  for (const [stream] of entries) releaseAnalyser(stream)
  entries.clear()
  await sharedCtx?.close().catch(() => undefined)
  sharedCtx = null
}
