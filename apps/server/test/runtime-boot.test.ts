import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Runtime, boot } from '../src/runtime.ts'

let dataRoot: string
let rt: Runtime | null = null

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), 'rat-boot-'))
})

afterEach(async () => {
  await rt?.shutdown()
  rt = null
  await rm(dataRoot, { recursive: true, force: true })
})

/** 프로세스 재기동 */
async function restart(): Promise<Runtime> {
  await rt?.shutdown()
  // 주기 scan을 짧게 — fs.watch 도착 시점은 보장되지 않는다
  rt = await boot({ dataRoot, scanIntervalMs: 50 })
  return rt
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json()

const manifest = {
  sourceId: 'src_01',
  captureMode: 'in_person',
  startedAt: '2026-08-06T10:00:00+09:00',
  devices: { mic: '마이크' },
  tracks: ['mic'],
  expectedChunks: { mic: 3 },
  pauses: [],
  chunkDurationMs: 5000,
}

async function startRecording(r: Runtime) {
  return r.app.request('/api/sources', {
    method: 'POST',
    body: JSON.stringify(manifest),
    headers: { 'content-type': 'application/json' },
  })
}

const putChunk = (r: Runtime, seq: number, fill = seq + 1) =>
  r.app.request(`/api/sources/src_01/chunks/mic/${seq}`, {
    method: 'PUT',
    body: new Uint8Array(100).fill(fill),
  })

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`조건이 ${timeoutMs}ms 안에 참이 되지 않았다`)
}

describe('기동', () => {
  it('빈 디렉토리에서 뜬다', async () => {
    const r = await restart()
    expect((await json(await r.app.request('/api/health'))).ok).toBe(true)
    expect(r.index.count()).toBe(0)
  })

  it('vault 디렉토리 구조를 만든다', async () => {
    const r = await restart()
    await expect(r.vault.read('sources/nope.md')).resolves.toBeNull()
  })
})

describe('⛔ 서버를 재시작해도 진행 중이던 source 상태가 유지된다', () => {
  // Phase 2 품질 게이트의 수동 항목. 자동화한다.

  it('업로드 중 재시작해도 이어서 올릴 수 있다', async () => {
    let r = await restart()
    await startRecording(r)
    await putChunk(r, 0)

    r = await restart()

    const { missing } = await json(await r.app.request('/api/sources/src_01/missing'))
    expect(missing.mic).toEqual([1, 2])
    for (const seq of missing.mic) await putChunk(r, seq)

    const body = await json(
      await r.app.request('/api/sources/src_01/finalize', { method: 'POST' })
    )
    expect(body.sourceState).toBe('ready')
  })

  it('재시작 후에도 같은 순번에 다른 내용을 거부한다', async () => {
    let r = await restart()
    await startRecording(r)
    await putChunk(r, 0, 1)

    r = await restart()

    expect((await putChunk(r, 0, 99)).status).toBe(409)
  })
})

describe('ready가 되면 vault에 문서가 생긴다', () => {
  it('finalize가 Markdown을 쓴다', async () => {
    const r = await restart()
    await startRecording(r)
    for (const i of [0, 1, 2]) await putChunk(r, i)

    const body = await json(
      await r.app.request('/api/sources/src_01/finalize', { method: 'POST' })
    )
    expect(body.sourceState).toBe('ready')
    expect(body.publishError).toBeUndefined()

    const doc = await r.vault.read('sources/src_01.md')
    expect(doc?.frontmatter.source_hash).toBe(body.sourceHash)
  })

  it('발행된 문서가 인덱스와 검색에 들어온다', async () => {
    const r = await restart()
    await startRecording(r)
    for (const i of [0, 1, 2]) await putChunk(r, i)
    await r.app.request('/api/sources/src_01/finalize', { method: 'POST' })

    await waitFor(() => r.index.byId('src_01') !== null)
    expect(r.index.byKind('sources').map((d) => d.id)).toEqual(['src_01'])
  })

  it('불완전한 source는 vault에 쓰이지 않는다', async () => {
    const r = await restart()
    await startRecording(r)
    await putChunk(r, 0)

    const body = await json(
      await r.app.request('/api/sources/src_01/finalize', { method: 'POST' })
    )
    expect(body.sourceState).toBe('finalizing')
    expect(await r.vault.read('sources/src_01.md')).toBeNull()
  })
})

describe('인덱스는 파생 데이터다', () => {
  it('index.db를 지우고 재기동하면 vault에서 복원된다', async () => {
    let r = await restart()
    await startRecording(r)
    for (const i of [0, 1, 2]) await putChunk(r, i)
    await r.app.request('/api/sources/src_01/finalize', { method: 'POST' })
    await waitFor(() => r.index.byId('src_01') !== null)

    await r.shutdown()
    await rm(path.join(dataRoot, 'index.db'), { force: true })
    await rm(path.join(dataRoot, 'index.db-wal'), { force: true })
    await rm(path.join(dataRoot, 'index.db-shm'), { force: true })

    r = await restart()

    expect(r.index.byId('src_01')).not.toBeNull()
  })
})

describe('꺼져 있는 동안의 외부 편집', () => {
  it('기동 직후 scan이 잡아낸다', async () => {
    let r = await restart()
    // 서버를 내린다
    await r.shutdown()

    await writeFile(
      path.join(dataRoot, 'vault/notes/밤사이.md'),
      '---\nid: night_note\n---\n서버가 꺼져 있을 때 Obsidian으로 적었다\n',
      'utf8'
    )

    r = await restart()

    await waitFor(() => r.index.byId('night_note') !== null)
  })
})
