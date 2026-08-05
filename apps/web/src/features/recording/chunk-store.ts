/**
 * 녹음 조각의 로컬 보존 — IndexedDB.
 *
 * Phase 0.1 실측으로 IndexedDB를 선택했다(OPFS 대비). Phase 0.2에서 조각 5초,
 * 30분 녹음 = 360조각 ≈ 29MB, 조각당 SHA-256이 0.03ms임을 쟀다.
 *
 * ⛔ **조각은 서버로 보내기 전에 먼저 여기 들어간다.** 업로드가 실패하거나
 *    네트워크가 끊겨도, 심지어 탭이 죽어도 녹음이 사라지면 안 된다.
 *
 * ⛔ **한 번 쓴 조각은 다른 내용으로 덮지 않는다.** raw audio는 불변이다
 *    (technical-foundation 5절). 서버의 `putChunk`와 같은 규칙을 클라이언트에도 건다.
 */

import type { TrackKind } from '@ratatouille/contracts'

const DB_VERSION = 1
const STORE = 'chunks'

export type ChunkMeta = {
  sourceId: string
  track: TrackKind
  seq: number
  size: number
  hash: string
  uploaded: boolean
  capturedAt: number
}

type ChunkRow = ChunkMeta & { key: string; blob: Blob }

const keyOf = (sourceId: string, track: TrackKind, seq: number) =>
  `${sourceId}|${track}|${String(seq).padStart(6, '0')}`

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return `sha256:${[...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

export class ChunkStore {
  private db: IDBDatabase | null = null

  constructor(private readonly dbName = 'ratatouille-chunks') {}

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'key' })
          os.createIndex('bySource', 'sourceId')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('ChunkStore가 열려 있지 않다. open()을 먼저 부른다.')
    return this.db.transaction(STORE, mode).objectStore(STORE)
  }

  /**
   * 조각을 보존한다. 멱등하다.
   *
   * 같은 순번을 같은 내용으로 다시 넣으면 조용히 통과한다(재시도). 내용이
   * 다르면 던진다 — 그건 원본을 덮으려는 것이다.
   */
  async put(input: {
    sourceId: string
    track: TrackKind
    seq: number
    blob: Blob
  }): Promise<ChunkMeta> {
    const hash = await sha256Hex(await input.blob.arrayBuffer())
    const key = keyOf(input.sourceId, input.track, input.seq)

    const existing = await req<ChunkRow | undefined>(this.tx('readonly').get(key))
    if (existing) {
      if (existing.hash !== hash) {
        throw new Error(
          `${key}: 같은 순번에 다른 내용을 쓸 수 없다. 녹음 원본은 덮지 않는다.`
        )
      }
      return stripBlob(existing)
    }

    const row: ChunkRow = {
      key,
      sourceId: input.sourceId,
      track: input.track,
      seq: input.seq,
      size: input.blob.size,
      hash,
      uploaded: false,
      capturedAt: Date.now(),
      blob: input.blob,
    }
    await req(this.tx('readwrite').put(row))
    return stripBlob(row)
  }

  async get(sourceId: string, track: TrackKind, seq: number): Promise<Blob | null> {
    const row = await req<ChunkRow | undefined>(
      this.tx('readonly').get(keyOf(sourceId, track, seq))
    )
    return row?.blob ?? null
  }

  async list(sourceId: string): Promise<ChunkMeta[]> {
    const rows = await req<ChunkRow[]>(
      this.tx('readonly').index('bySource').getAll(sourceId)
    )
    return rows.map(stripBlob).sort(bySeq)
  }

  /** 아직 서버가 받지 않은 조각. 순번 순서다. */
  async pending(sourceId: string): Promise<ChunkMeta[]> {
    return (await this.list(sourceId)).filter((c) => !c.uploaded)
  }

  async markUploaded(sourceId: string, track: TrackKind, seq: number): Promise<void> {
    const key = keyOf(sourceId, track, seq)
    const store = this.tx('readwrite')
    const row = await req<ChunkRow | undefined>(store.get(key))
    if (!row) return
    // blob은 그대로 둔다. 서버 응답을 아직 완전히 믿지 않는다 —
    // finalize가 성공할 때까지 로컬 사본을 유지한다.
    await req(store.put({ ...row, uploaded: true }))
  }

  async counts(sourceId: string): Promise<{ persisted: number; uploaded: number }> {
    const all = await this.list(sourceId)
    return {
      persisted: all.length,
      uploaded: all.filter((c) => c.uploaded).length,
    }
  }

  /** 업로드가 덜 끝난 source들. 탭을 닫았다 돌아왔을 때 복구 후보다. */
  async unfinishedSources(): Promise<string[]> {
    const rows = await req<ChunkRow[]>(this.tx('readonly').getAll())
    const ids = new Set(rows.filter((r) => !r.uploaded).map((r) => r.sourceId))
    return [...ids].sort()
  }

  /** finalize까지 끝난 뒤에만 부른다. */
  async discard(sourceId: string): Promise<void> {
    const store = this.tx('readwrite')
    const rows = await req<ChunkRow[]>(store.index('bySource').getAll(sourceId))
    for (const r of rows) await req(store.delete(r.key))
  }
}

function stripBlob(row: ChunkRow): ChunkMeta {
  const { blob: _blob, key: _key, ...meta } = row
  return meta
}

function bySeq(a: ChunkMeta, b: ChunkMeta): number {
  return a.track.localeCompare(b.track) || a.seq - b.seq
}

function req<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 저장소 보관 권한을 요청한다.
 *
 * ⚠️ 이게 없으면 브라우저가 용량 압박을 받을 때 IndexedDB를 통째로 버릴 수 있다.
 *    Phase 0에서 `persist()`를 **필수**로 정한 이유다. 거부되면 녹음을 막지는
 *    않지만 화면이 "안전함"이라고 말하지 않는다 (screen-state.ts 참조).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
