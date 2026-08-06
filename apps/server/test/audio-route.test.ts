/**
 * 오디오 재생 경로.
 *
 * ⛔ **Range를 지원하지 않으면 탐색이 안 된다.** 브라우저는 `<audio>`에서
 *    특정 지점으로 가려 할 때 `Range: bytes=...`를 보낸다. 서버가 매번 전체를
 *    200으로 돌려주면 Chrome은 30분짜리 파일을 처음부터 다시 받는다 —
 *    timestamp를 눌러 그 지점으로 가는 것이 Phase 5 완료 조건이므로 실패다.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { AudioPublisher } from '../src/audio/publisher.ts'
import { SourceRepository } from '../src/sources/repository.ts'

let root: string
let sources: SourceRepository
let app: Hono

/** 길이를 아는 가짜 오디오 — Range 계산을 검증할 수 있어야 한다 */
const BODY = 'ABCDEFGHIJ' // 10바이트

function fakeFfmpeg() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((_bin: string, args: string[]) => {
    const emitter = new EventEmitter() as any
    emitter.stdout = new EventEmitter()
    emitter.stderr = new EventEmitter()
    emitter.kill = () => undefined
    void (async () => {
      await Promise.resolve()
      await writeFile(args[args.length - 1]!, BODY)
      emitter.emit('close', 0)
    })()
    return emitter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-aroute-'))
  sources = new SourceRepository(path.join(root, 'blobs'))
  app = createApp({
    sources,
    audio: new AudioPublisher({
      cacheRoot: path.join(root, 'cache'),
      workRoot: path.join(root, 'work'),
      spawnFn: fakeFfmpeg(),
    }),
  })
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
  expectedChunks: {},
  pauses: [],
  chunkDurationMs: 5000,
  ...over,
})

async function readySource(id = 'src_01') {
  await app.request('/api/sources', {
    method: 'POST',
    body: JSON.stringify(manifest({ sourceId: id })),
    headers: { 'content-type': 'application/json' },
  })
  await app.request(`/api/sources/${id}/chunks/mic/0`, {
    method: 'PUT',
    body: new Uint8Array(32).fill(7),
  })
  await app.request(`/api/sources/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ expectedChunks: { mic: 1 } }),
    headers: { 'content-type': 'application/json' },
  })
}

const get = (headers: Record<string, string> = {}, id = 'src_01') =>
  app.request(`/api/sources/${id}/audio`, { headers })

describe('오디오를 내보낸다', () => {
  it('전체 요청은 200이고 바이트가 전부 온다', async () => {
    await readySource()
    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(BODY)
    expect(res.headers.get('content-type')).toContain('audio/')
    expect(res.headers.get('content-length')).toBe(String(BODY.length))
  })

  it('⛔ Range를 받는다고 광고한다 — 없으면 브라우저가 탐색을 시도하지 않는다', async () => {
    await readySource()
    expect((await get()).headers.get('accept-ranges')).toBe('bytes')
  })

  it('없는 회의는 404다', async () => {
    expect((await get({}, 'src_없음')).status).toBe(404)
  })

  it('아직 ready가 아니면 404가 아니라 409다 — 회의는 있는데 오디오가 아직 없다', async () => {
    await app.request('/api/sources', {
      method: 'POST',
      body: JSON.stringify(manifest()),
      headers: { 'content-type': 'application/json' },
    })
    expect((await get()).status).toBe(409)
  })
})

describe('⛔ Range — 탐색의 전제', () => {
  it('중간 구간을 206으로 돌려준다', async () => {
    await readySource()
    const res = await get({ range: 'bytes=2-5' })

    expect(res.status).toBe(206)
    expect(await res.text()).toBe('CDEF')
    expect(res.headers.get('content-range')).toBe(`bytes 2-5/${BODY.length}`)
    expect(res.headers.get('content-length')).toBe('4')
  })

  it('끝이 열린 Range도 처리한다 — 브라우저가 실제로 이렇게 보낸다', async () => {
    await readySource()
    const res = await get({ range: 'bytes=6-' })

    expect(res.status).toBe(206)
    expect(await res.text()).toBe('GHIJ')
    expect(res.headers.get('content-range')).toBe(`bytes 6-9/${BODY.length}`)
  })

  it('끝을 넘는 Range는 파일 끝까지로 잘린다', async () => {
    await readySource()
    const res = await get({ range: 'bytes=8-99' })

    expect(res.status).toBe(206)
    expect(await res.text()).toBe('IJ')
  })

  it('⛔ 시작이 파일 밖이면 416이다 — 200으로 전체를 주면 탐색이 조용히 실패한다', async () => {
    await readySource()
    const res = await get({ range: 'bytes=99-' })

    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${BODY.length}`)
  })

  it('해석할 수 없는 Range는 전체를 준다 — 재생을 막지 않는다', async () => {
    await readySource()
    // HTTP header는 ByteString이라 한글을 넣을 수 없다 — 형식만 망가뜨린다
    const res = await get({ range: 'bytes=abc' })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(BODY)
  })
})
