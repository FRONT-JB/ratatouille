import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { SourceRepository } from '../src/sources/repository.ts'

let root: string
let app: Hono

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-api-'))
  app = createApp({ sources: new SourceRepository(root) })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const manifest = (over: Record<string, unknown> = {}) => ({
  sourceId: 'src_01',
  captureMode: 'in_person',
  startedAt: '2026-08-06T10:00:00+09:00',
  devices: { mic: '마이크' },
  tracks: ['mic'],
  expectedChunks: { mic: 3 },
  pauses: [],
  chunkDurationMs: 5000,
  ...over,
})

/** Hono의 res.json()은 unknown을 돌려준다. 테스트에서만 좁힌다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json()

const start = (m = manifest()) =>
  app.request('/api/sources', {
    method: 'POST',
    body: JSON.stringify(m),
    headers: { 'content-type': 'application/json' },
  })

const putChunk = (seq: number, fill = 1, track = 'mic', bytes = 100) =>
  app.request(`/api/sources/src_01/chunks/${track}/${seq}`, {
    method: 'PUT',
    body: new Uint8Array(bytes).fill(fill),
  })

describe('POST /api/sources — 녹음 시작', () => {
  it('201과 capturing 상태를 돌려준다', async () => {
    const res = await start()
    expect(res.status).toBe(201)
    expect((await json(res)).sourceState).toBe('capturing')
  })

  it('sourceId가 없으면 400', async () => {
    const res = await app.request('/api/sources', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('재접속 시 중복 생성하지 않고 현재 상태를 돌려준다', async () => {
    await start()
    await putChunk(0)
    const res = await start()
    expect(res.status).toBe(200)
    expect((await json(res)).chunkCount).toBe(1)
  })
})

describe('PUT chunks — 멱등 업로드', () => {
  beforeEach(async () => {
    await start()
  })

  it('새 조각은 201', async () => {
    const res = await putChunk(0)
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ duplicate: false, seq: 0 })
  })

  it('같은 내용 재전송은 200 duplicate', async () => {
    await putChunk(0)
    const res = await putChunk(0)
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ duplicate: true })
  })

  it('같은 순번에 다른 내용이면 409 — 재시도해도 소용없다', async () => {
    await putChunk(0, 1)
    const res = await putChunk(0, 2)
    expect(res.status).toBe(409)
  })

  it('빈 조각을 거부한다', async () => {
    const res = await app.request('/api/sources/src_01/chunks/mic/0', {
      method: 'PUT',
      body: new Uint8Array(0),
    })
    expect(res.status).toBe(400)
  })

  it('알 수 없는 track을 거부한다', async () => {
    const res = await putChunk(0, 1, 'speaker')
    expect(res.status).toBe(400)
  })

  it('음수 순번을 거부한다', async () => {
    const res = await app.request('/api/sources/src_01/chunks/mic/-1', {
      method: 'PUT',
      body: new Uint8Array(10),
    })
    expect(res.status).toBe(400)
  })

  it('없는 source면 404', async () => {
    const res = await app.request('/api/sources/ghost/chunks/mic/0', {
      method: 'PUT',
      body: new Uint8Array(10),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /:id/missing — 재개 질의', () => {
  it('빠진 순번만 알려준다', async () => {
    await start()
    await putChunk(0)
    await putChunk(2)
    const res = await app.request('/api/sources/src_01/missing')
    expect(await json(res)).toEqual({ missing: { mic: [1] } })
  })

  it('전부 받았으면 빈 배열 — 중복 업로드를 유발하지 않는다', async () => {
    await start()
    for (const i of [0, 1, 2]) await putChunk(i, i + 1)
    expect(await json(await app.request('/api/sources/src_01/missing'))).toEqual(
      { missing: { mic: [] } }
    )
  })
})

describe('POST /:id/finalize', () => {
  it('조각이 온전하면 ready가 되고 sourceHash가 생긴다', async () => {
    await start()
    for (const i of [0, 1, 2]) await putChunk(i, i + 1)
    const body = await json(await app.request('/api/sources/src_01/finalize', { method: 'POST' }))
    expect(body.sourceState).toBe('ready')
    expect(body.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(body.canStartTranscription).toBe(true)
  })

  it('조각이 빠지면 finalizing에 머물고 위반을 한국어로 설명한다', async () => {
    await start()
    await putChunk(0)
    const res = await app.request('/api/sources/src_01/finalize', { method: 'POST' })
    // 불완전한 source는 오류가 아니라 정상적인 상태다
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.sourceState).toBe('finalizing')
    expect(body.canStartTranscription).toBe(false)
    expect(body.violations.length).toBeGreaterThan(0)
    expect(body.violations[0].message).toMatch(/[가-힣]/)
  })

  it('온라인 모드에서 탭 오디오가 없으면 ready가 되지 않는다', async () => {
    await start(manifest({ captureMode: 'online', tracks: ['mic'] }))
    for (const i of [0, 1, 2]) await putChunk(i, i + 1)
    const body = await json(await app.request('/api/sources/src_01/finalize', { method: 'POST' }))
    expect(body.sourceState).toBe('finalizing')
    expect(body.violations.map((v: { kind: string }) => v.kind)).toContain(
      'online_requires_remote'
    )
  })
})

describe('상태 추적 가능성 — PLAN.md 순서 3', () => {
  it('어느 객체의 상태인지 필드 이름으로 구분된다', async () => {
    await start()
    const body = await json(await app.request('/api/sources/src_01'))
    // `state`가 아니라 `sourceState` — 다른 머신과 섞이지 않는다
    expect(body).toHaveProperty('sourceState')
    expect(body).not.toHaveProperty('state')
  })

  it('서버는 내부 상태명을 그대로 내보낸다 — 문구 매핑은 클라이언트 몫', async () => {
    await start()
    const body = await json(await app.request('/api/sources/src_01'))
    expect(body.sourceState).toBe('capturing')
  })
})

describe('GET /api/sources — 목록과 Inbox', () => {
  it('불완전한 source가 inbox에 들어간다', async () => {
    await start()
    await putChunk(0)
    await app.request('/api/sources/src_01/finalize', { method: 'POST' })
    const body = await json(await app.request('/api/sources'))
    expect(body.inbox).toContain('src_01')
  })

  it('ready가 되면 inbox에서 빠진다', async () => {
    await start()
    for (const i of [0, 1, 2]) await putChunk(i, i + 1)
    await app.request('/api/sources/src_01/finalize', { method: 'POST' })
    const body = await json(await app.request('/api/sources'))
    expect(body.inbox).not.toContain('src_01')
  })
})

describe('전체 흐름 — 재접속 복구 포함', () => {
  it('업로드 중 끊겼다가 재개해도 중복 없이 ready에 도달한다', async () => {
    await start()
    await putChunk(0, 1)
    await putChunk(1, 2)

    // 여기서 네트워크가 끊겼다. 클라이언트가 재접속해 어디까지 갔는지 묻는다.
    const { missing } = await json(await app.request('/api/sources/src_01/missing'))
    expect(missing.mic).toEqual([2])

    // 이미 보낸 0,1을 다시 보내도(재시도) 중복이 생기지 않는다
    await putChunk(0, 1)
    for (const seq of missing.mic) await putChunk(seq, seq + 1)

    const body = await json(await app.request('/api/sources/src_01/finalize', { method: 'POST' }))
    expect(body.sourceState).toBe('ready')
    expect(body.chunkCount).toBe(3)
  })
})
