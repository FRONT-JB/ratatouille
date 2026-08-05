import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { RecordingManifest } from '@ratatouille/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ChunkConflictError,
  SourceNotFoundError,
  SourceRepository,
} from '../src/sources/repository.ts'

let root: string
let repo: SourceRepository

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-src-'))
  repo = new SourceRepository(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill)

function manifest(over: Partial<RecordingManifest> = {}): RecordingManifest {
  return {
    sourceId: 'src_01',
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: '마이크' },
    tracks: ['mic'],
    expectedChunks: { mic: 3 },
    pauses: [],
    chunkDurationMs: 5000,
    ...over,
  }
}

async function putAll(id: string, track: 'mic' | 'remote', count: number) {
  for (let i = 0; i < count; i++) {
    await repo.putChunk(id, { track, seq: i, bytes: bytes(100, i + 1) })
  }
}

describe('생성과 조회', () => {
  it('녹음 시작 시 capturing 상태로 만든다', () => {
    expect(repo.create(manifest()).state).toBe('capturing')
  })

  it('없는 source를 조회하면 던진다', () => {
    expect(() => repo.get('ghost')).toThrow(SourceNotFoundError)
  })
})

describe('조각 수신은 멱등하다', () => {
  it('새 조각을 받아 저장한다', async () => {
    repo.create(manifest())
    const r = await repo.putChunk('src_01', {
      track: 'mic',
      seq: 0,
      bytes: bytes(100),
    })
    expect(r).toEqual({ accepted: true, duplicate: false })
  })

  it('같은 내용을 다시 받으면 duplicate로 표시하고 넘어간다', async () => {
    repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100) })
    const again = await repo.putChunk('src_01', {
      track: 'mic',
      seq: 0,
      bytes: bytes(100),
    })
    expect(again).toEqual({ accepted: true, duplicate: true })
    expect(repo.get('src_01').chunks).toHaveLength(1)
  })

  it('같은 순번인데 내용이 다르면 던진다 — 데이터 오염', async () => {
    repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100, 1) })
    await expect(
      repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100, 2) })
    ).rejects.toThrow(ChunkConflictError)
  })

  it('재전송을 반복해도 조각이 늘지 않는다', async () => {
    repo.create(manifest())
    for (let i = 0; i < 5; i++) {
      await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100) })
    }
    expect(repo.get('src_01').chunks).toHaveLength(1)
  })
})

describe('재개 — "어디까지 받았나"', () => {
  it('빠진 순번만 알려준다', async () => {
    repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100) })
    await repo.putChunk('src_01', { track: 'mic', seq: 2, bytes: bytes(100) })
    expect(repo.missing('src_01')).toEqual({ mic: [1] })
  })

  it('전부 받았으면 빈 배열 — 중복 업로드를 유발하지 않는다', async () => {
    repo.create(manifest())
    await putAll('src_01', 'mic', 3)
    expect(repo.missing('src_01')).toEqual({ mic: [] })
  })

  it('track별로 따로 계산한다', async () => {
    repo.create(
      manifest({
        captureMode: 'online',
        tracks: ['mic', 'remote'],
        expectedChunks: { mic: 3, remote: 3 },
      })
    )
    await putAll('src_01', 'mic', 3)
    await repo.putChunk('src_01', { track: 'remote', seq: 0, bytes: bytes(100) })
    expect(repo.missing('src_01')).toEqual({ mic: [], remote: [1, 2] })
  })
})

describe('finalize — ready는 모든 조각이 확인될 때만', () => {
  it('조각이 온전하면 ready가 된다', async () => {
    repo.create(manifest())
    await putAll('src_01', 'mic', 3)
    const s = await repo.finalize('src_01')
    expect(s.state).toBe('ready')
    expect(s.violations).toEqual([])
    expect(s.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('조각이 빠지면 finalizing에 머물고 Inbox에 남는다', async () => {
    repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100) })
    const s = await repo.finalize('src_01')
    expect(s.state).toBe('finalizing')
    expect(s.violations.length).toBeGreaterThan(0)
    expect(repo.inbox().map((x) => x.id)).toContain('src_01')
  })

  it('불완전한 source는 전사 job을 만들 수 없다', async () => {
    repo.create(manifest())
    await repo.putChunk('src_01', { track: 'mic', seq: 0, bytes: bytes(100) })
    await repo.finalize('src_01')
    expect(repo.canStartTranscription('src_01')).toBe(false)
  })

  it('ready가 되어야만 전사 job을 만들 수 있다', async () => {
    repo.create(manifest())
    await putAll('src_01', 'mic', 3)
    await repo.finalize('src_01')
    expect(repo.canStartTranscription('src_01')).toBe(true)
  })

  it('온라인 모드에서 remote track이 없으면 ready가 되지 않는다', async () => {
    repo.create(manifest({ captureMode: 'online', tracks: ['mic'] }))
    await putAll('src_01', 'mic', 3)
    const s = await repo.finalize('src_01')
    expect(s.state).toBe('finalizing')
    expect(s.violations.map((v) => v.kind)).toContain('online_requires_remote')
  })
})

describe('source hash는 불변이다', () => {
  it('같은 조각이면 같은 hash가 나온다 — 결정론적', async () => {
    repo.create(manifest())
    await putAll('src_01', 'mic', 3)
    const h1 = (await repo.finalize('src_01')).sourceHash

    const repo2 = new SourceRepository(root)
    repo2.create(manifest())
    for (let i = 0; i < 3; i++) {
      await repo2.putChunk('src_01', { track: 'mic', seq: i, bytes: bytes(100, i + 1) })
    }
    expect((await repo2.finalize('src_01')).sourceHash).toBe(h1)
  })

  it('조각 내용이 다르면 hash도 다르다', async () => {
    repo.create(manifest())
    await putAll('src_01', 'mic', 3)
    const h1 = (await repo.finalize('src_01')).sourceHash

    const repo2 = new SourceRepository(root)
    repo2.create(manifest({ sourceId: 'src_02' }))
    for (let i = 0; i < 3; i++) {
      await repo2.putChunk('src_02', {
        track: 'mic',
        seq: i,
        bytes: bytes(100, i + 99),
      })
    }
    expect((await repo2.finalize('src_02')).sourceHash).not.toBe(h1)
  })

  it('finalize를 두 번 해도 hash가 바뀌지 않는다', async () => {
    repo.create(manifest())
    await putAll('src_01', 'mic', 3)
    const h1 = (await repo.finalize('src_01')).sourceHash
    const h2 = (await repo.finalize('src_01')).sourceHash
    expect(h2).toBe(h1)
  })
})
