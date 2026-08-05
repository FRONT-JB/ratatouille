/**
 * source 저장소 — 녹음 조각과 manifest의 수명주기.
 *
 * technical-foundation.md 5절·11절:
 *   - source_state: capturing → finalizing → ready
 *   - 모든 조각과 manifest가 확인될 때만 `ready`
 *   - 불완전한 source는 Inbox에 남고 문서화 job을 만들지 않는다
 *   - raw audio와 source hash는 **불변**이다
 *
 * Phase 2 범위: 메모리 + 파일시스템. SQLite 인덱스는 이 위에 파생한다.
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  type ChunkRecord,
  type ManifestViolation,
  type RecordingManifest,
  type SourceState,
  type TrackKind,
  assertImmutable,
  canMarkReady,
  dedupeChunks,
  missingSeqs,
  transition,
  verifyManifest,
} from '@ratatouille/contracts'

export type SourceRecord = {
  id: string
  state: SourceState
  manifest: RecordingManifest | null
  chunks: ChunkRecord[]
  /** 모든 조각을 순서대로 이은 것의 hash. ready가 될 때 확정되고 불변이다 */
  sourceHash: string | null
  violations: ManifestViolation[]
}

export class SourceNotFoundError extends Error {
  constructor(readonly sourceId: string) {
    super(`source ${sourceId}를 찾을 수 없다`)
    this.name = 'SourceNotFoundError'
  }
}

export class ChunkConflictError extends Error {
  constructor(
    readonly track: TrackKind,
    readonly seq: number
  ) {
    super(`${track}#${seq}: 같은 순번인데 내용이 다르다`)
    this.name = 'ChunkConflictError'
  }
}

/**
 * source 저장소.
 *
 * 조각 바이트는 파일시스템에, 메타데이터는 메모리에 둔다.
 * 재시작 복구는 Phase 4에서 SQLite로 옮긴다 — 지금은 계약을 먼저 고정한다.
 */
export class SourceRepository {
  private readonly sources = new Map<string, SourceRecord>()

  constructor(private readonly blobRoot: string) {}

  private chunkPath(sourceId: string, track: TrackKind, seq: number): string {
    return path.join(this.blobRoot, sourceId, track, `${String(seq).padStart(6, '0')}.webm`)
  }

  /** 녹음 시작. manifest는 시작 시점에 기록된다 (PLAN.md 순서 2). */
  create(manifest: RecordingManifest): SourceRecord {
    const rec: SourceRecord = {
      id: manifest.sourceId,
      state: 'capturing',
      manifest,
      chunks: [],
      sourceHash: null,
      violations: [],
    }
    this.sources.set(rec.id, rec)
    return rec
  }

  get(sourceId: string): SourceRecord {
    const s = this.sources.get(sourceId)
    if (!s) throw new SourceNotFoundError(sourceId)
    return s
  }

  has(sourceId: string): boolean {
    return this.sources.has(sourceId)
  }

  /**
   * 조각을 받는다. **멱등하다.**
   *
   * 같은 순번을 다시 받으면:
   *   - hash가 같으면 무시한다 (정상적인 네트워크 재시도)
   *   - hash가 다르면 던진다 (데이터 오염)
   *
   * PLAN.md 순서 3 완료 조건: 재접속 후 같은 source를 중복 업로드하지 않는다.
   */
  async putChunk(
    sourceId: string,
    chunk: { track: TrackKind; seq: number; bytes: Uint8Array }
  ): Promise<{ accepted: boolean; duplicate: boolean }> {
    const src = this.get(sourceId)
    const hash = `sha256:${createHash('sha256').update(chunk.bytes).digest('hex')}`
    const record: ChunkRecord = {
      track: chunk.track,
      seq: chunk.seq,
      bytes: chunk.bytes.byteLength,
      hash,
    }

    const existing = src.chunks.find(
      (c) => c.track === chunk.track && c.seq === chunk.seq
    )
    if (existing) {
      if (existing.hash !== hash || existing.bytes !== record.bytes) {
        throw new ChunkConflictError(chunk.track, chunk.seq)
      }
      // 같은 내용의 재전송 — 디스크를 다시 쓰지 않는다
      return { accepted: true, duplicate: true }
    }

    const p = this.chunkPath(sourceId, chunk.track, chunk.seq)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, chunk.bytes)
    src.chunks.push(record)
    return { accepted: true, duplicate: false }
  }

  /** 재개 시 "어디까지 받았나". 클라이언트는 빠진 순번만 다시 보낸다. */
  missing(sourceId: string): Partial<Record<TrackKind, number[]>> {
    const src = this.get(sourceId)
    if (!src.manifest) return {}
    const out: Partial<Record<TrackKind, number[]>> = {}
    for (const t of src.manifest.tracks) {
      const expected = src.manifest.expectedChunks[t]
      if (expected === undefined) continue
      out[t] = missingSeqs(src.chunks, t, expected)
    }
    return out
  }

  /**
   * 녹음 종료 → 조각·manifest 검증 → `ready` 또는 Inbox 잔류.
   *
   * technical-foundation.md 4절: "종료 후 모든 조각과 manifest가 확인될 때만
   * `ready`가 된다. 불완전한 source는 Inbox에 남고 문서화 job을 만들지 않는다."
   */
  async finalize(sourceId: string): Promise<SourceRecord> {
    const src = this.get(sourceId)
    if (!src.manifest) {
      src.violations = [{ kind: 'no_chunks', track: 'mic' }]
      return src
    }

    if (src.state === 'capturing') {
      src.state = transition('source', 'capturing', 'finalizing') as SourceState
    }

    src.violations = verifyManifest(src.manifest, src.chunks)
    if (!canMarkReady(src.violations)) {
      // finalizing에 머문다 — Inbox 잔류. 전사 job을 만들지 않는다.
      return src
    }

    const hash = await this.computeSourceHash(src)
    // raw audio·source hash는 불변이다 (technical-foundation 5절)
    assertImmutable('sourceHash', src.sourceHash, hash)
    src.sourceHash = hash
    src.state = transition('source', 'finalizing', 'ready') as SourceState
    return src
  }

  /**
   * source hash — 조각 hash를 track·순번 순서로 이어 다시 해시한다.
   *
   * 조각 바이트를 전부 다시 읽지 않는다. 조각 hash가 이미 내용을 대표하므로
   * 30분 녹음(29MB)에서도 비용이 일정하다.
   */
  private async computeSourceHash(src: SourceRecord): Promise<string> {
    const { unique } = dedupeChunks(src.chunks)
    const ordered = [...unique].sort(
      (a, b) => a.track.localeCompare(b.track) || a.seq - b.seq
    )
    const h = createHash('sha256')
    for (const c of ordered) h.update(`${c.track}#${c.seq}:${c.hash}\n`)
    return `sha256:${h.digest('hex')}`
  }

  /** 전사 job을 만들어도 되는지 — `ready`가 유일한 조건이다. */
  canStartTranscription(sourceId: string): boolean {
    return this.get(sourceId).state === 'ready'
  }

  list(): SourceRecord[] {
    return [...this.sources.values()]
  }

  /** 불완전해서 Inbox에 남은 source들 */
  inbox(): SourceRecord[] {
    return this.list().filter((s) => s.state !== 'ready')
  }
}
