import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChunkConflictError, SourceRepository } from '../src/sources/repository.ts'

let root: string
let repo: SourceRepository

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-restart-'))
  repo = new SourceRepository(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const manifest = (over: Record<string, unknown> = {}) =>
  ({
    sourceId: 'src_01',
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: '마이크' },
    tracks: ['mic'],
    expectedChunks: { mic: 3 },
    pauses: [],
    chunkDurationMs: 5000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const bytes = (fill: number, n = 100) => new Uint8Array(n).fill(fill)

/** 프로세스가 죽었다가 새로 뜬 상황 */
async function restart(): Promise<SourceRepository> {
  const fresh = new SourceRepository(root)
  await fresh.load()
  return fresh
}

describe('⛔ 서버를 재시작해도 진행 중이던 source가 살아 있다', () => {
  // Phase 2 품질 게이트. 30분짜리 녹음 도중 서버가 재기동되면
  // 메모리에만 있던 manifest와 조각 기록이 사라져 업로드를 처음부터 다시 해야 한다.

  it('capturing 중이던 manifest가 남는다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })

    const after = await restart()

    expect(after.has('src_01')).toBe(true)
    expect(after.get('src_01').state).toBe('capturing')
    expect(after.get('src_01').manifest?.expectedChunks.mic).toBe(3)
  })

  it('받은 조각 목록이 남는다 — 재개 질의가 같은 답을 준다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })
    await repo.putChunk('src_01', { track: 'mic', seq: 2, bytes: bytes(3) })
    const before = repo.missing('src_01')

    const after = await restart()

    expect(after.missing('src_01')).toEqual(before)
    expect(after.missing('src_01').mic).toEqual([1])
  })

  it('재시작 후 남은 조각만 올려도 ready에 도달한다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })

    const after = await restart()
    for (const seq of after.missing('src_01').mic ?? []) {
      await after.putChunk('src_01', { track: 'mic', seq, bytes: bytes(seq + 1) })
    }

    expect((await after.finalize('src_01')).state).toBe('ready')
  })

  it('ready와 sourceHash가 유지된다', async () => {
    await repo.create(manifest())
    for (const i of [0, 1, 2]) {
      await repo.putChunk('src_01', { track: 'mic', seq: i, bytes: bytes(i + 1) })
    }
    const hash = (await repo.finalize('src_01')).sourceHash

    const after = await restart()

    expect(after.get('src_01').state).toBe('ready')
    expect(after.get('src_01').sourceHash).toBe(hash)
    expect(after.canStartTranscription('src_01')).toBe(true)
  })

  it('재시작 후 finalize를 다시 불러도 source hash가 바뀌지 않는다', async () => {
    await repo.create(manifest())
    for (const i of [0, 1, 2]) {
      await repo.putChunk('src_01', { track: 'mic', seq: i, bytes: bytes(i + 1) })
    }
    const hash = (await repo.finalize('src_01')).sourceHash

    const after = await restart()

    expect((await after.finalize('src_01')).sourceHash).toBe(hash)
  })

  it('Inbox에 남아 있던 불완전한 source가 그대로 있다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })
    await repo.finalize('src_01')

    const after = await restart()

    expect(after.inbox().map((s) => s.id)).toEqual(['src_01'])
    expect(after.get('src_01').violations.length).toBeGreaterThan(0)
  })
})

describe('⛔ raw audio 덮어쓰기 방지가 재시작을 견딘다', () => {
  // 이 가드는 원래 메모리의 chunks 배열에만 있었다. 재시작하면 배열이 비어
  // 있으니 같은 순번에 다른 바이트가 와도 그대로 파일을 덮었다.
  // technical-foundation 5절: raw audio는 불변이다.

  it('재시작 후 같은 순번에 다른 내용을 보내면 거부한다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })

    const after = await restart()

    await expect(
      after.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(99) })
    ).rejects.toThrow(ChunkConflictError)
  })

  it('재시작 후 같은 내용 재전송은 여전히 멱등하다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })

    const after = await restart()
    const r = await after.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(1) })

    expect(r).toEqual({ accepted: true, duplicate: true })
  })
})

describe('여러 source', () => {
  it('전부 복구된다', async () => {
    await repo.create(manifest())
    await repo.create(manifest({ sourceId: 'src_02' }))
    await repo.putChunk('src_02', { track: 'mic', seq: 0, bytes: bytes(7) })

    const after = await restart()

    expect(after.list().map((s) => s.id).sort()).toEqual(['src_01', 'src_02'])
  })
})

describe('손상 내성', () => {
  it('깨진 상태 파일 하나가 나머지를 막지 않는다', async () => {
    await repo.create(manifest())
    await repo.create(manifest({ sourceId: 'src_02' }))
    await writeFile(path.join(root, 'src_01', 'source.state.json'), '{ 깨짐', 'utf8')

    const after = await restart()

    // 하나는 잃었지만 서버는 뜬다. 조용히 전부 날리는 것보다 낫다.
    expect(after.list().map((s) => s.id)).toEqual(['src_02'])
  })

  it('상태 파일이 없는 디렉토리는 건너뛴다', async () => {
    await repo.create(manifest())
    await rm(path.join(root, 'src_01', 'source.state.json'))

    const after = await restart()

    expect(after.list()).toEqual([])
  })

  it('빈 루트에서도 뜬다', async () => {
    await rm(root, { recursive: true, force: true })
    const after = await restart()
    expect(after.list()).toEqual([])
  })
})

describe('상태 파일은 §11의 불변 이력과 다른 파일이다', () => {
  it('이름이 source.json이 아니다', async () => {
    await repo.create(manifest())
    const files = await readdir(path.join(root, 'src_01'))
    // technical-foundation 11절의 sources/<id>/source.json 은 ready 이후의
    // 불변 이력이다. 수집 중 계속 바뀌는 이 파일과 같은 이름을 쓰면
    // 나중에 둘 중 하나가 다른 하나를 덮는다.
    expect(files).toContain('source.state.json')
    expect(files).not.toContain('source.json')
  })
})
