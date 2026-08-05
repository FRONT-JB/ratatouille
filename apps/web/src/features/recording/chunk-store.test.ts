import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChunkStore, sha256Hex } from './chunk-store'

let store: ChunkStore
let dbName: string
let n = 0

beforeEach(async () => {
  dbName = `rat-chunks-test-${Date.now()}-${n++}`
  store = new ChunkStore(dbName)
  await store.open()
})

afterEach(async () => {
  store.close()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

const blob = (fill: number, size = 64) =>
  new Blob([new Uint8Array(size).fill(fill)], { type: 'audio/webm' })

describe('⛔ 조각을 로컬에 먼저 보존한다', () => {
  // 화면 계약: "조각을 로컬에 먼저 보존하고 서버로 업로드".
  // 업로드가 실패하거나 네트워크가 끊겨도 녹음이 사라지면 안 된다.

  it('넣은 조각을 다시 읽는다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    const c = await store.get('s1', 'mic', 0)
    expect(c?.size).toBe(64)
  })

  it('DB를 닫았다 열어도 남아 있다 — 탭을 새로 고쳐도 살아남는다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    store.close()

    const reopened = new ChunkStore(dbName)
    await reopened.open()
    expect(await reopened.get('s1', 'mic', 0)).not.toBeNull()
    reopened.close()
  })

  it('저장 시점에 SHA-256을 계산해 함께 남긴다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    const meta = (await store.list('s1'))[0]
    expect(meta.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('같은 바이트는 같은 hash가 된다', async () => {
    const a = await sha256Hex(await blob(7).arrayBuffer())
    const b = await sha256Hex(await blob(7).arrayBuffer())
    expect(a).toBe(b)
  })

  it('다른 바이트는 다른 hash가 된다', async () => {
    const a = await sha256Hex(await blob(7).arrayBuffer())
    const b = await sha256Hex(await blob(8).arrayBuffer())
    expect(a).not.toBe(b)
  })
})

describe('멱등 저장', () => {
  it('같은 순번을 같은 내용으로 두 번 넣어도 하나다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    expect((await store.list('s1')).length).toBe(1)
  })

  it('⛔ 같은 순번에 다른 내용을 넣으면 거부한다 — 원본을 덮지 않는다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    await expect(
      store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(2) })
    ).rejects.toThrow(/덮|이미|다르/)
  })

  it('track이 다르면 같은 순번이 공존한다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    await store.put({ sourceId: 's1', track: 'remote', seq: 0, blob: blob(2) })
    expect((await store.list('s1')).length).toBe(2)
  })

  it('source가 다르면 섞이지 않는다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    await store.put({ sourceId: 's2', track: 'mic', seq: 0, blob: blob(1) })
    expect((await store.list('s1')).length).toBe(1)
    expect((await store.list('s2')).length).toBe(1)
  })
})

describe('업로드 진행 추적', () => {
  beforeEach(async () => {
    for (const seq of [0, 1, 2]) {
      await store.put({ sourceId: 's1', track: 'mic', seq, blob: blob(seq + 1) })
    }
  })

  it('처음에는 전부 업로드 대기다', async () => {
    expect((await store.pending('s1')).map((c) => c.seq)).toEqual([0, 1, 2])
  })

  it('업로드 표시한 조각은 대기에서 빠진다', async () => {
    await store.markUploaded('s1', 'mic', 1)
    expect((await store.pending('s1')).map((c) => c.seq)).toEqual([0, 2])
  })

  it('세어서 보존 상태에 쓸 수 있다', async () => {
    await store.markUploaded('s1', 'mic', 0)
    expect(await store.counts('s1')).toEqual({ persisted: 3, uploaded: 1 })
  })

  it('업로드된 조각도 로컬에 남는다 — 서버 응답을 아직 믿지 않는다', async () => {
    await store.markUploaded('s1', 'mic', 0)
    expect(await store.get('s1', 'mic', 0)).not.toBeNull()
  })

  it('대기 목록은 순번 순서다 — 순서대로 올려야 재개 질의가 단순해진다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 5, blob: blob(9) })
    await store.put({ sourceId: 's1', track: 'mic', seq: 3, blob: blob(8) })
    expect((await store.pending('s1')).map((c) => c.seq)).toEqual([0, 1, 2, 3, 5])
  })
})

describe('정리', () => {
  it('source 하나만 지운다', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    await store.put({ sourceId: 's2', track: 'mic', seq: 0, blob: blob(1) })
    await store.discard('s1')
    expect((await store.list('s1')).length).toBe(0)
    expect((await store.list('s2')).length).toBe(1)
  })

  it('끝나지 않은 녹음을 찾아낸다 — 탭을 닫았다 돌아온 경우', async () => {
    await store.put({ sourceId: 's1', track: 'mic', seq: 0, blob: blob(1) })
    await store.put({ sourceId: 's2', track: 'mic', seq: 0, blob: blob(1) })
    await store.markUploaded('s2', 'mic', 0)
    expect(await store.unfinishedSources()).toEqual(['s1'])
  })
})
