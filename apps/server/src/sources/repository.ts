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
import type { Dirent } from 'node:fs'
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
 * 수집 중 상태 파일 이름.
 *
 * ⚠️ 11절의 `sources/<id>/source.json`과 **다른 파일이다.** 그쪽은 ready 이후의
 *    불변 이력(`RunArtifactStore`가 write-once로 관리)이고, 이 파일은 수집이
 *    진행되는 동안 계속 바뀐다. 같은 이름을 쓰면 둘 중 하나가 다른 하나를 덮는다.
 */
const STATE_FILE = 'source.state.json'

/**
 * source 저장소.
 *
 * 조각 바이트와 메타데이터를 **모두 디스크에** 둔다. 메모리 Map은 캐시다.
 *
 * ⛔ 메타데이터를 메모리에만 두면 두 가지가 깨진다.
 *    1. 30분 녹음 도중 서버가 재기동되면 manifest와 조각 기록이 사라져
 *       업로드를 처음부터 다시 해야 한다.
 *    2. **조각 중복 가드가 사라진다.** `putChunk`의 불변성 검사는 메모리의
 *       `chunks` 배열을 본다. 재시작 후 배열이 비어 있으면 같은 순번에 다른
 *       바이트가 와도 그대로 파일을 덮는다 — raw audio 불변 위반(5절).
 */
export class SourceRepository {
  private readonly sources = new Map<string, SourceRecord>()

  constructor(private readonly blobRoot: string) {}

  private chunkPath(sourceId: string, track: TrackKind, seq: number): string {
    return path.join(this.blobRoot, sourceId, track, `${String(seq).padStart(6, '0')}.webm`)
  }

  private statePath(sourceId: string): string {
    return path.join(this.blobRoot, sourceId, STATE_FILE)
  }

  /**
   * 디스크에서 진행 중이던 source를 되살린다. 서버 기동 시 한 번 부른다.
   *
   * 상태 파일 하나가 깨져 있어도 나머지는 살린다 — 조용히 전부 날리는 것보다,
   * 하나를 잃고 서버가 뜨는 편이 복구 가능성이 높다.
   */
  async load(): Promise<{ loaded: number; skipped: string[] }> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(this.blobRoot, { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { loaded: 0, skipped: [] }
      throw e
    }

    let loaded = 0
    const skipped: string[] = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      try {
        const raw = await fs.readFile(this.statePath(e.name), 'utf8')
        const rec = JSON.parse(raw) as SourceRecord
        this.sources.set(rec.id, rec)
        loaded++
      } catch (err) {
        // 상태 파일이 아예 없는 디렉토리는 정상(조각만 남은 잔해)이므로 조용히 넘긴다
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') skipped.push(e.name)
      }
    }
    return { loaded, skipped }
  }

  /** 상태를 원자적으로 저장한다. vault와 같은 규칙: 같은 디렉토리에 쓰고 rename. */
  private async persist(src: SourceRecord): Promise<void> {
    const full = this.statePath(src.id)
    await fs.mkdir(path.dirname(full), { recursive: true })
    const tmp = `${full}.${process.pid}.tmp`
    try {
      await fs.writeFile(tmp, `${JSON.stringify(src, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, full)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw e
    }
  }

  /** 녹음 시작. manifest는 시작 시점에 기록된다 (PLAN.md 순서 2). */
  async create(manifest: RecordingManifest): Promise<SourceRecord> {
    const rec: SourceRecord = {
      id: manifest.sourceId,
      state: 'capturing',
      manifest,
      chunks: [],
      sourceHash: null,
      violations: [],
    }
    this.sources.set(rec.id, rec)
    // 시작 직후 죽어도 manifest는 남아야 한다 — 조각만 있고 manifest가 없으면
    // 무엇을 몇 개 받아야 하는지 알 수 없다.
    // 저장을 기다린다: fire-and-forget으로 두면 뒤이은 putChunk의 저장을
    // 이 쓰기가 덮어 조각 기록이 사라진다.
    await this.persist(rec)
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
    // 바이트를 먼저 쓰고 기록을 남긴다. 사이에서 죽으면 기록 없는 조각이 남는데,
    // 그건 missing으로 잡혀 다시 올라온다. 반대 순서면 없는 조각을 받았다고 믿는다.
    await this.persist(src)
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
  async finalize(
    sourceId: string,
    declared?: { expectedChunks?: Partial<Record<TrackKind, number>> }
  ): Promise<SourceRecord> {
    const src = this.get(sourceId)

    // 조각 개수는 녹음이 끝나야 알 수 있다. 시작 시점 manifest에는 비어 있고
    // 클라이언트가 종료할 때 선언한다. 한 번 선언되면 바꾸지 않는다 —
    // 검증 기준을 사후에 고칠 수 있으면 검증이 아니다.
    if (src.manifest && declared?.expectedChunks) {
      for (const [track, count] of Object.entries(declared.expectedChunks)) {
        const t = track as TrackKind
        if (typeof count !== 'number') continue
        assertImmutable(
          `expectedChunks.${t}`,
          src.manifest.expectedChunks[t] ?? null,
          count
        )
        src.manifest.expectedChunks[t] = count
      }
    }

    if (!src.manifest) {
      src.violations = [{ kind: 'no_chunks', track: 'mic' }]
      await this.persist(src)
      return src
    }

    if (src.state === 'capturing') {
      src.state = transition('source', 'capturing', 'finalizing') as SourceState
    }

    src.violations = verifyManifest(src.manifest, src.chunks)
    if (!canMarkReady(src.violations)) {
      // finalizing에 머문다 — Inbox 잔류. 전사 job을 만들지 않는다.
      await this.persist(src)
      return src
    }

    const hash = await this.computeSourceHash(src)
    // raw audio·source hash는 불변이다 (technical-foundation 5절).
    // 재시작 뒤 finalize를 다시 불러도 같은 hash가 나오므로 통과하고,
    // 조각이 바뀌었다면 여기서 걸린다.
    assertImmutable('sourceHash', src.sourceHash, hash)
    src.sourceHash = hash
    if (src.state !== 'ready') {
      src.state = transition('source', 'finalizing', 'ready') as SourceState
    }
    await this.persist(src)
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
