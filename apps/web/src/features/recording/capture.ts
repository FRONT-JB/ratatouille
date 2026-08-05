/**
 * 브라우저 오디오 수집 — MediaRecorder 두 대를 나란히 돌린다.
 *
 * Phase 0.4 실측: 두 track을 **동시 시작·동시 일시정지**해야 한다.
 * 편측 정지 시 295ms 드리프트가 생기고, 그만큼 화자 정렬이 어긋난다.
 *
 * ⛔ 조각은 만들어지는 즉시 `ChunkStore`(IndexedDB)에 들어간다. 업로드는
 *    그 뒤의 일이다. 서버가 죽어 있어도, 네트워크가 끊겨도 녹음은 남는다.
 */

import type { TrackKind } from '@ratatouille/contracts'
import { CHUNK_DURATION_MS } from './start-gate'
import type { ChunkStore } from './chunk-store'

export type CaptureTrack = {
  kind: TrackKind
  stream: MediaStream
}

export type CaptureEvents = {
  onChunk?: (info: { track: TrackKind; seq: number; total: number }) => void
  onTrackEnded?: (track: TrackKind) => void
  onError?: (track: TrackKind, error: unknown) => void
}

/** 브라우저가 실제로 지원하는 형식을 고른다. Safari와 Chrome이 다르다. */
export function pickMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export class CaptureSession {
  private recorders = new Map<TrackKind, MediaRecorder>()
  private seqs = new Map<TrackKind, number>()
  private counts = new Map<TrackKind, number>()
  private stopped = false
  /**
   * 진행 중인 저장 작업.
   *
   * ⛔ `ondataavailable`은 동기 콜백이지만 저장은 비동기다(hash + IndexedDB).
   *    이걸 기다리지 않고 `stop()`이 끝나면 **회의 마지막 조각이 사라진다.**
   *    타이머로 "잠깐 기다리기"는 동기화가 아니다 — 부하가 걸리면 그냥 틀린다.
   */
  private writes = new Set<Promise<void>>()

  constructor(
    private readonly sourceId: string,
    private readonly store: ChunkStore,
    private readonly events: CaptureEvents = {}
  ) {}

  /** track별로 실제로 저장된 조각 수 — finalize에서 선언할 값이다 */
  chunkCounts(): Partial<Record<TrackKind, number>> {
    return Object.fromEntries(this.counts)
  }

  /**
   * 모든 track을 **동시에** 시작한다.
   *
   * 순차 시작하면 그 사이만큼 시간축이 어긋난다.
   */
  start(tracks: CaptureTrack[]): void {
    const mimeType = pickMimeType()

    for (const t of tracks) {
      const rec = new MediaRecorder(t.stream, mimeType ? { mimeType } : undefined)
      this.seqs.set(t.kind, 0)
      this.counts.set(t.kind, 0)

      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return
        const write = this.persist(t.kind, e.data)
        this.writes.add(write)
        void write.finally(() => this.writes.delete(write))
      }
      rec.onerror = (e) => this.events.onError?.(t.kind, e)

      // track이 끝나는 것(탭 공유 중단·장치 분리)은 오류가 아니라 사건이다.
      // 어느 track인지 알려야 화면이 마이크와 탭을 구분해 표시할 수 있다.
      for (const track of t.stream.getAudioTracks()) {
        track.addEventListener('ended', () => this.events.onTrackEnded?.(t.kind))
      }

      this.recorders.set(t.kind, rec)
    }

    for (const rec of this.recorders.values()) rec.start(CHUNK_DURATION_MS)
  }

  /**
   * 조각을 **로컬에 먼저** 쓴다.
   *
   * 저장이 실패하면 조용히 넘기지 않는다. 화면의 보존 상태가 뒤처진 것을
   * 드러내야 사용자가 판단할 수 있다.
   */
  private async persist(track: TrackKind, blob: Blob): Promise<void> {
    const seq = this.seqs.get(track) ?? 0
    this.seqs.set(track, seq + 1)
    try {
      await this.store.put({ sourceId: this.sourceId, track, seq, blob })
      this.counts.set(track, (this.counts.get(track) ?? 0) + 1)
      this.events.onChunk?.({ track, seq, total: this.counts.get(track) ?? 0 })
    } catch (e) {
      this.events.onError?.(track, e)
    }
  }

  /** 두 track을 동시에 멈춘다 (Phase 0.4: 편측 정지 시 295ms 드리프트) */
  pause(): void {
    for (const rec of this.recorders.values()) {
      if (rec.state === 'recording') rec.pause()
    }
  }

  resume(): void {
    for (const rec of this.recorders.values()) {
      if (rec.state === 'paused') rec.resume()
    }
  }

  /** 마지막 조각까지 기다린 뒤 끝난다. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true

    await Promise.all(
      [...this.recorders.values()].map(
        (rec) =>
          new Promise<void>((resolve) => {
            if (rec.state === 'inactive') return resolve()
            rec.addEventListener('stop', () => resolve(), { once: true })
            rec.stop()
          })
      )
    )

    // 진행 중인 저장을 **기다린다.** 마지막 조각은 stop 이벤트 직전에
    // 나오므로, 여기서 안 기다리면 회의 마지막 5초가 사라진다.
    // 새 write가 그 사이 추가될 수 있어 비워질 때까지 돈다.
    while (this.writes.size > 0) {
      await Promise.allSettled([...this.writes])
    }

    for (const rec of this.recorders.values()) {
      for (const t of rec.stream.getTracks()) t.stop()
    }
    this.recorders.clear()
  }

  get isActive(): boolean {
    return this.recorders.size > 0 && !this.stopped
  }
}
