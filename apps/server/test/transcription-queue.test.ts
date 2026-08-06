import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunArtifactStore } from '../src/runs/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { TranscriptionRunner } from '../src/transcription/runner.ts'
import { SourceNotReadyError, TranscriptionQueue } from '../src/transcription/queue.ts'

let root: string
let sources: SourceRepository
let queue: TranscriptionQueue
let whisperCalls = 0

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
      whisperCalls++
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

const manifest = (over: Record<string, unknown> = {}) =>
  ({
    sourceId: 'src_01',
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: '마이크' },
    tracks: ['mic'],
    expectedChunks: { mic: 2 },
    pauses: [],
    chunkDurationMs: 5000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

async function chunkFiles(): Promise<{ mic: string[] }> {
  const dir = path.join(root, 'chunks')
  await mkdir(dir, { recursive: true })
  const files: string[] = []
  for (const i of [0, 1]) {
    const p = path.join(dir, `${i}.webm`)
    await writeFile(p, new Uint8Array(32).fill(i + 1))
    files.push(p)
  }
  return { mic: files }
}

function makeQueue(fail = false) {
  return new TranscriptionQueue({
    runner: new TranscriptionRunner({
      modelPath: '/m/model.bin',
      spawnFn: fakeSpawn(fail),
    }),
    sources,
    runs: new RunArtifactStore(path.join(root, 'runs')),
    workRoot: path.join(root, 'work'),
    stateRoot: path.join(root, 'jobs'),
    chunkFilesOf: chunkFiles,
  })
}

/** ready 상태의 source를 만든다 */
async function readySource() {
  await sources.create(manifest())
  for (const i of [0, 1]) {
    await sources.putChunk('src_01', {
      track: 'mic',
      seq: i,
      bytes: new Uint8Array(32).fill(i + 1),
    })
  }
  await sources.finalize('src_01')
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-q-'))
  sources = new SourceRepository(path.join(root, 'blobs'))
  queue = makeQueue()
  whisperCalls = 0
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('⛔ ready 이전 source로는 job을 만들지 못한다', () => {
  // technical-foundation 5절. 화면에서만 막으면 다른 경로로 새어 들어온다.

  it('capturing 중이면 거부한다', async () => {
    await sources.create(manifest())
    await expect(queue.enqueue('src_01')).rejects.toThrow(SourceNotReadyError)
  })

  it('finalizing(조각 부족)이어도 거부한다', async () => {
    await sources.create(manifest())
    await sources.putChunk('src_01', {
      track: 'mic',
      seq: 0,
      bytes: new Uint8Array(32).fill(1),
    })
    await sources.finalize('src_01')
    await expect(queue.enqueue('src_01')).rejects.toThrow(SourceNotReadyError)
  })

  it('거부 이유가 현재 상태를 밝힌다', async () => {
    await sources.create(manifest())
    await expect(queue.enqueue('src_01')).rejects.toThrow(/capturing/)
  })

  it('ready면 통과한다', async () => {
    await readySource()
    expect((await queue.enqueue('src_01')).state).toBe('completed')
  })
})

describe('job 조회', () => {
  it('id로 찾는다', async () => {
    await readySource()
    const job = await queue.enqueue('src_01')
    expect(queue.get(job.id)?.state).toBe('completed')
  })

  it('source의 최신 job을 찾는다', async () => {
    await readySource()
    await queue.enqueue('src_01')
    expect(queue.latestFor('src_01')?.sourceId).toBe('src_01')
  })

  it('job이 없으면 null이다', () => {
    expect(queue.latestFor('src_99')).toBeNull()
  })
})

describe('⛔ 같은 source를 동시에 두 번 돌리지 않는다', () => {
  it('동시 요청이 같은 실행을 공유한다', async () => {
    await readySource()
    const [a, b] = await Promise.all([queue.enqueue('src_01'), queue.enqueue('src_01')])
    expect(a.id).toBe(b.id)
    expect(whisperCalls).toBe(1)
  })
})

describe('⛔ 재시도는 새 job으로 남는다 — 이력을 덮지 않는다', () => {
  it('두 번째 시도가 다른 id를 받는다', async () => {
    await readySource()
    const first = await queue.enqueue('src_01')
    const second = await queue.retry('src_01')
    expect(second.id).not.toBe(first.id)
  })

  it('두 job이 모두 남는다', async () => {
    await readySource()
    await queue.enqueue('src_01')
    await queue.retry('src_01')
    expect(queue.list().filter((j) => j.sourceId === 'src_01').length).toBe(2)
  })
})

describe('실패', () => {
  it('failed_retryable로 남고 이유가 붙는다', async () => {
    await readySource()
    const q = makeQueue(true)
    const job = await q.enqueue('src_01')
    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/전사 실패/)
  })
})

describe('⛔ 서버가 재시작해도 job이 살아 있다', () => {
  // 브라우저 탭 수명과 무관한 job이 로컬 데몬의 존재 이유 중 하나다.

  it('완료된 job이 복구된다', async () => {
    await readySource()
    const job = await queue.enqueue('src_01')

    const fresh = makeQueue()
    expect(await fresh.load()).toBe(1)
    expect(fresh.get(job.id)?.state).toBe('completed')
  })

  it('⛔ 재시작 시점에 transcribing이던 job을 실패로 되돌린다', async () => {
    // 그대로 두면 화면이 영원히 "전사 중"을 보여준다. 프로세스는 이미 죽었다.
    await mkdir(path.join(root, 'jobs', 'tr_stuck'), { recursive: true })
    await writeFile(
      path.join(root, 'jobs', 'tr_stuck', 'job.state.json'),
      JSON.stringify({
        id: 'tr_stuck',
        sourceId: 'src_01',
        state: 'transcribing',
        attempt: 1,
        error: null,
        retryable: true,
        warning: null,
        audioMs: null,
        elapsedMs: null,
        segmentCount: null,
      })
    )

    const fresh = makeQueue()
    await fresh.load()

    const job = fresh.get('tr_stuck')!
    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/재시작|중단/)
    expect(job.retryable).toBe(true)
  })

  it('빈 상태에서도 뜬다', async () => {
    expect(await makeQueue().load()).toBe(0)
  })
})
