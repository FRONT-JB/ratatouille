import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { RunArtifactStore } from '../src/runs/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { TranscriptionRunner } from '../src/transcription/runner.ts'
import { TranscriptionQueue } from '../src/transcription/queue.ts'

let root: string
let sources: SourceRepository
let queue: TranscriptionQueue
let app: Hono

const WHISPER_OUT = {
  result: { language: 'ko' },
  transcription: [{ offsets: { from: 0, to: 4000 }, text: ' 안녕하세요.' }],
}

/**
 * whisper와 ffmpeg 대신 쓸 가짜 spawn.
 *
 * `TranscriptionRunner`는 `spawnFn`을 주입받으므로 실제 실행 없이 큐의
 * 수명주기만 검증할 수 있다. 실제 실행 검증은 transcription-runner.test.ts가 한다.
 */
function fakeSpawn(fail = false) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((cmd: string, args: string[]) => {
    const emitter = new EventEmitter() as any
    emitter.stdout = new EventEmitter()
    emitter.stderr = new EventEmitter()
    emitter.kill = () => undefined

    // ⛔ 반드시 비동기로 낸다. 동기로 emit하면 runner가 리스너를 붙이기 전에
    //    close가 지나가 프로세스가 영영 안 끝난 것처럼 보인다.
    void (async () => {
      await Promise.resolve()
      if (cmd.includes('ffprobe')) {
        emitter.stdout.emit('data', '20.0')
        emitter.emit('close', 0)
        return
      }
      if (cmd.includes('ffmpeg')) {
        await writeFile(args[args.length - 1]!, 'wav')
        emitter.emit('close', 0)
        return
      }
      if (fail) {
        emitter.stderr.emit('data', 'boom')
        emitter.emit('close', 1)
        return
      }
      await writeFile(
        `${args[args.indexOf('-of') + 1]}.json`,
        JSON.stringify(WHISPER_OUT)
      )
      emitter.emit('close', 0)
    })()

    return emitter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

function build(fail = false) {
  sources = new SourceRepository(path.join(root, 'blobs'))
  queue = new TranscriptionQueue({
    runner: new TranscriptionRunner({
      modelPath: '/m/model.bin',
      spawnFn: fakeSpawn(fail),
    }),
    sources,
    runs: new RunArtifactStore(path.join(root, 'runs')),
    workRoot: path.join(root, 'work'),
    stateRoot: path.join(root, 'jobs'),
    chunkFilesOf: async (id) => sources.chunkFiles(id),
  })
  app = createApp({ sources, transcription: queue })
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-sess-'))
  build()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json()

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

const start = (m = manifest()) =>
  app.request('/api/sources', {
    method: 'POST',
    body: JSON.stringify(m),
    headers: { 'content-type': 'application/json' },
  })

const putChunk = (seq: number, id = 'src_01') =>
  app.request(`/api/sources/${id}/chunks/mic/${seq}`, {
    method: 'PUT',
    body: new Uint8Array(64).fill(seq + 1),
  })

const finalize = (counts: Record<string, number>, id = 'src_01') =>
  app.request(`/api/sources/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ expectedChunks: counts }),
    headers: { 'content-type': 'application/json' },
  })

async function readySource(id = 'src_01') {
  await start(manifest({ sourceId: id }))
  for (const i of [0, 1]) await putChunk(i, id)
  await finalize({ mic: 2 }, id)
}

describe('⛔ 어느 객체의 상태인지 구분된다 — PLAN.md 순서 3 완료 조건 1', () => {
  it('source 상태와 job 상태가 다른 필드로 나온다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    const s = (await json(await app.request('/api/session'))).sources[0]

    expect(s.sourceState).toBe('ready')
    expect(s.job.jobState).toBe('completed')
    // `state` 하나로 뭉치지 않는다
    expect(s).not.toHaveProperty('state')
    expect(s.job).not.toHaveProperty('state')
  })

  it('사용자 문구가 내부 상태와 함께 온다', async () => {
    await readySource()
    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.sourcePhrase.label).toMatch(/[가-힣]/)
    expect(s.sourceState).toBe('ready')
  })

  it('⛔ 미확정 문구는 표시가 붙어 온다', async () => {
    // 화면이 "이건 아직 정해진 문구가 아니다"를 시각적으로 구분할 수 있어야 한다
    await readySource()
    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.sourcePhrase).toHaveProperty('provisional')
  })
})

describe('⛔ 업로드 중과 서버 검증까지 끝난 ready가 구분된다 — 완료 조건 2', () => {
  it('업로드 중에는 ready가 아니다', async () => {
    await start()
    await putChunk(0)

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.sourceState).toBe('capturing')
    expect(s.chunkCount).toBe(1)
  })

  it('조각을 다 올려도 finalize 전에는 ready가 아니다', async () => {
    await start()
    for (const i of [0, 1]) await putChunk(i)

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.sourceState).toBe('capturing')
  })

  it('서버 검증에 실패하면 ready가 아니다', async () => {
    await start()
    await putChunk(0)
    await finalize({ mic: 2 }) // 선언은 2인데 1개만 올렸다

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.sourceState).toBe('finalizing')
  })

  it('검증을 통과해야 ready다', async () => {
    await readySource()
    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.sourceState).toBe('ready')
  })
})

describe('⛔ 재접속하면 현재 상태와 다음 조작이 나온다 — 완료 조건 3', () => {
  it('ready면 전사 시작을 권한다', async () => {
    await readySource()
    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.nextAction.kind).toBe('start_transcription')
    expect(s.nextAction.label).toMatch(/[가-힣]/)
  })

  it('전사가 끝났으면 교정으로 넘어가라고 한다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.nextAction.kind).toBe('open_transcript_review')
  })

  it('⛔ 전사가 이미 돌았으면 "전사 시작"을 다시 권하지 않는다', async () => {
    // 권하면 사용자가 눌러서 중복 실행이 생긴다
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.nextAction.kind).not.toBe('start_transcription')
  })

  it('전사가 실패했으면 재시도를 권한다', async () => {
    build(true)
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.job.jobState).toBe('failed_retryable')
    expect(s.nextAction.kind).toBe('retry_transcription')
  })

  it('⛔ 재시도해도 소용없는 실패에는 재시도를 권하지 않는다', async () => {
    // 온라인 모드인데 remote 조각이 없는 경우 — 다시 눌러도 같은 결과다
    await start(manifest({ captureMode: 'online', tracks: ['mic'] }))
    for (const i of [0, 1]) await putChunk(i)
    await finalize({ mic: 2 })
    // online인데 remote track이 없어 finalize가 ready로 안 간다
    const before = (await json(await app.request('/api/session'))).sources[0]
    expect(before.sourceState).toBe('finalizing')
    expect(before.nextAction).toBeNull()
  })

  it('진행 중인 것만 따로 알려준다', async () => {
    await readySource('src_01')
    await readySource('src_02')
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    const body = await json(await app.request('/api/session'))
    expect(body.inProgress).toEqual(['src_02'])
  })
})

describe('⛔ 재접속 후 같은 source를 중복 업로드하지 않는다 — 완료 조건 4', () => {
  it('아직 안 받은 조각만 알려준다', async () => {
    await start()
    await putChunk(0)
    await finalize({ mic: 3 })

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.missing.mic).toEqual([1, 2])
  })

  it('ready면 더 올릴 게 없다', async () => {
    await readySource()
    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.missing).toEqual({})
  })
})

describe('전사 시작 API', () => {
  it('ready면 202로 job을 만든다', async () => {
    await readySource()
    const res = await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    expect(res.status).toBe(202)
    expect((await json(res)).jobState).toBe('completed')
  })

  it('⛔ ready가 아니면 409 — 화면 밖 경로로도 못 들어온다', async () => {
    await start()
    await putChunk(0)
    const res = await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await json(res)).sourceState).toBe('capturing')
  })

  it('없는 source면 404', async () => {
    const res = await app.request('/api/sources/ghost/transcribe', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('job을 id로 조회한다', async () => {
    await readySource()
    const job = await json(
      await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    )
    const res = await app.request(`/api/transcriptions/${job.id}`)
    expect((await json(res)).segmentCount).toBe(1)
  })
})

describe('빈 세션', () => {
  it('아무것도 없어도 뜬다', async () => {
    const body = await json(await app.request('/api/session'))
    expect(body).toEqual({ sources: [], inProgress: [] })
  })
})
