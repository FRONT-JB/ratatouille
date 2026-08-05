/**
 * 조각 업로드 — Phase 0.3에서 확정한 재전송 protocol의 클라이언트 쪽.
 *
 * 원칙 하나로 정리된다: **로컬이 원본이고 서버는 사본이다.**
 * 업로드가 실패해도 `ChunkStore`의 조각은 그대로 남는다. 서버가 죽어 있어도
 * 녹음은 시작되고 계속된다. 따라잡기는 `resume()`이 한다.
 *
 * ⛔ 순번을 건너뛰며 올리지 않는다. 서버의 재개 질의는 순번 기반이라,
 *    구멍을 내면서 올리면 부분 업로드를 완료로 오인할 수 있다.
 */

import type { RecordingManifest, TrackKind } from '@ratatouille/contracts'
import type { ChunkStore } from './chunk-store'

/** 재시도해도 결과가 같은 실패. 사람이 봐야 한다. */
export class ChunkRejectedError extends Error {
  constructor(
    readonly track: TrackKind,
    readonly seq: number,
    readonly status: number,
    readonly detail: string
  ) {
    super(
      `${track}#${seq} 업로드가 거부되었다 (HTTP ${status}): ${detail}. 재시도해도 같은 결과다.`
    )
    this.name = 'ChunkRejectedError'
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type UploaderOptions = {
  fetch?: FetchLike
  baseUrl?: string
  /** 일시적 실패(5xx·네트워크) 재시도 횟수 */
  retries?: number
  backoffMs?: number
  onProgress?: (p: { uploaded: number; pending: number }) => void
}

export type FlushResult = { uploaded: number; failed: number }

export class ChunkUploader {
  private readonly fetchFn: FetchLike
  private readonly baseUrl: string
  private readonly retries: number
  private readonly backoffMs: number
  private readonly onProgress?: UploaderOptions['onProgress']
  private aborted = false

  constructor(
    private readonly store: ChunkStore,
    opts: UploaderOptions = {}
  ) {
    this.fetchFn = opts.fetch ?? ((u, i) => fetch(u, i))
    this.baseUrl = opts.baseUrl ?? ''
    this.retries = opts.retries ?? 2
    this.backoffMs = opts.backoffMs ?? 300
    this.onProgress = opts.onProgress
  }

  abort(): void {
    this.aborted = true
  }

  /**
   * 서버에 source를 연다.
   *
   * ⛔ 실패해도 던지지 않는다. 서버가 죽어 있다고 녹음을 못 하게 하면,
   *    로컬 우선 설계의 의미가 없다. 조각은 IndexedDB에 쌓이고 나중에 따라잡는다.
   */
  async start(manifest: RecordingManifest): Promise<{ serverReady: boolean }> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/sources`, {
        method: 'POST',
        body: JSON.stringify(manifest),
        headers: { 'content-type': 'application/json' },
      })
      return { serverReady: res.ok }
    } catch {
      return { serverReady: false }
    }
  }

  /** 대기 중인 조각을 순번 순서로 올린다. 첫 일시적 실패에서 멈춘다. */
  async flush(sourceId: string): Promise<FlushResult> {
    if (this.aborted) return { uploaded: 0, failed: 0 }

    const pending = await this.store.pending(sourceId)
    let uploaded = 0

    for (const chunk of pending) {
      if (this.aborted) break
      const blob = await this.store.get(sourceId, chunk.track, chunk.seq)
      if (!blob) continue

      const okUpload = await this.putChunk(sourceId, chunk.track, chunk.seq, blob)
      if (!okUpload) {
        // 순서를 지킨다 — 뒤 조각을 건너뛰며 올리지 않는다
        return { uploaded, failed: 1 }
      }

      await this.store.markUploaded(sourceId, chunk.track, chunk.seq)
      uploaded++
      this.onProgress?.({ uploaded, pending: pending.length - uploaded })
    }

    return { uploaded, failed: 0 }
  }

  /**
   * 서버에 무엇이 있는지 물어보고 어긋난 것만 올린다.
   *
   * 탭이 죽었다 살아나면 로컬의 `uploaded` 표시가 서버 실제와 다를 수 있다.
   * 서버를 진실로 삼아 맞춘다.
   */
  async resume(sourceId: string): Promise<{
    uploaded: number
    unrecoverable: Array<{ track: TrackKind; seq: number }>
  }> {
    const res = await this.fetchFn(`${this.baseUrl}/api/sources/${sourceId}/missing`)
    const body = (await res.json()) as {
      missing?: Partial<Record<TrackKind, number[]>>
    }

    const local = await this.store.list(sourceId)
    const localKeys = new Set(local.map((c) => `${c.track}|${c.seq}`))

    let uploaded = 0
    const unrecoverable: Array<{ track: TrackKind; seq: number }> = []

    for (const [track, seqs] of Object.entries(body.missing ?? {})) {
      for (const seq of seqs ?? []) {
        const t = track as TrackKind
        if (!localKeys.has(`${t}|${seq}`)) {
          // 서버도 없고 로컬도 없다. 복구할 방법이 없으므로 조용히 넘기지 않는다.
          unrecoverable.push({ track: t, seq })
          continue
        }
        const blob = await this.store.get(sourceId, t, seq)
        if (!blob) continue
        if (await this.putChunk(sourceId, t, seq, blob)) {
          await this.store.markUploaded(sourceId, t, seq)
          uploaded++
        }
      }
    }

    return { uploaded, unrecoverable }
  }

  /**
   * 녹음을 종료한다.
   *
   * ⛔ 남은 조각을 다 올리기 전에는 finalize하지 않는다. 서버가 불완전한
   *    상태로 완결성을 판정하면 멀쩡한 녹음이 Inbox에 갇힌다.
   */
  async finalize(
    sourceId: string,
    expectedChunks: Partial<Record<TrackKind, number>>
  ): Promise<{ sourceState: string; [k: string]: unknown }> {
    const r = await this.flush(sourceId)
    if (r.failed > 0 || (await this.store.pending(sourceId)).length > 0) {
      throw new Error(
        '아직 업로드하지 못한 조각이 있어 종료할 수 없다. 네트워크를 확인한 뒤 다시 시도한다. 녹음은 이 브라우저에 남아 있다.'
      )
    }

    const res = await this.fetchFn(`${this.baseUrl}/api/sources/${sourceId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ expectedChunks }),
      headers: { 'content-type': 'application/json' },
    })
    return (await res.json()) as { sourceState: string }
  }

  /** 성공하면 true, 일시적 실패면 false, 영구 실패면 던진다. */
  private async putChunk(
    sourceId: string,
    track: TrackKind,
    seq: number,
    blob: Blob
  ): Promise<boolean> {
    const url = `${this.baseUrl}/api/sources/${sourceId}/chunks/${track}/${seq}`

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.aborted) return false
      try {
        const res = await this.fetchFn(url, { method: 'PUT', body: blob })
        if (res.ok) return true

        // 4xx는 재시도해도 같다. 데이터 문제이므로 사람이 봐야 한다.
        if (res.status >= 400 && res.status < 500) {
          const detail = await res.text().catch(() => '')
          throw new ChunkRejectedError(track, seq, res.status, detail)
        }
        // 5xx는 일시적일 수 있다
      } catch (e) {
        if (e instanceof ChunkRejectedError) throw e
        // 네트워크 오류 — 재시도 대상
      }
      if (attempt < this.retries) await sleep(this.backoffMs * (attempt + 1))
    }
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
