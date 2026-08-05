import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunArtifactStore } from '../src/runs/store.ts'
import { publishSource } from '../src/sources/publish.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let vault: VaultStore
let runs: RunArtifactStore
let repo: SourceRepository

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-pub-'))
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  runs = new RunArtifactStore(path.join(root, 'runs'))
  repo = new SourceRepository(path.join(root, 'blobs'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const manifest = (over: Record<string, unknown> = {}) =>
  ({
    sourceId: 'src_01',
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: 'MacBook Pro 마이크' },
    tracks: ['mic'],
    expectedChunks: { mic: 3 },
    pauses: [],
    chunkDurationMs: 5000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

async function readySource(over: Record<string, unknown> = {}) {
  await repo.create(manifest(over))
  const tracks = (over.tracks as string[]) ?? ['mic']
  for (const t of tracks) {
    for (const i of [0, 1, 2]) {
      await repo.putChunk('src_01', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        track: t as any,
        seq: i,
        bytes: new Uint8Array(100).fill(i + 1),
      })
    }
  }
  return repo.finalize('src_01')
}

describe('ready가 되면 vault에 Markdown+YAML이 쓰인다', () => {
  it('sources/ 아래에 문서가 생긴다', async () => {
    await publishSource(await readySource(), { vault, runs })
    const doc = await vault.read('sources/src_01.md')
    expect(doc).not.toBeNull()
  })

  it('frontmatter가 9절 예시의 필드를 담는다', async () => {
    await publishSource(await readySource(), { vault, runs })
    const fm = (await vault.read('sources/src_01.md'))!.frontmatter
    expect(fm).toMatchObject({
      id: 'src_01',
      type: 'audio',
      status: 'ready',
      captured_at: '2026-08-06T10:00:00+09:00',
      capture_mode: 'in_person',
      project_id: null,
    })
    expect(fm.source_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('schema_version을 남긴다 — 지금 frontmatter는 최종 스키마가 아니다', async () => {
    await publishSource(await readySource(), { vault, runs })
    const fm = (await vault.read('sources/src_01.md'))!.frontmatter
    expect(fm.schema_version).toBe(1)
  })

  it('track을 kind와 함께 적는다', async () => {
    await publishSource(await readySource({ captureMode: 'online', tracks: ['mic', 'remote'], expectedChunks: { mic: 3, remote: 3 } }), {
      vault,
      runs,
    })
    const fm = (await vault.read('sources/src_01.md'))!.frontmatter
    expect(fm.tracks).toEqual([
      { kind: 'mic', chunks: 3 },
      { kind: 'remote', chunks: 3 },
    ])
  })

  it('녹음 길이는 조각 수에서 계산한다 — 일시정지 구간은 조각이 없다', async () => {
    const fm = (
      await publishSource(await readySource(), { vault, runs }).then(() =>
        vault.read('sources/src_01.md')
      )
    )!.frontmatter
    // 3조각 × 5초
    expect(fm.duration_seconds).toBe(15)
  })

  it('긴 맥락은 frontmatter가 아니라 본문 자리에 둔다', async () => {
    await publishSource(await readySource(), { vault, runs })
    const doc = (await vault.read('sources/src_01.md'))!
    expect(doc.body).toContain('#')
    // agenda·목적 같은 긴 텍스트를 frontmatter에 넣지 않는다 (9절)
    expect(Object.keys(doc.frontmatter)).not.toContain('agenda')
    expect(Object.keys(doc.frontmatter)).not.toContain('context')
  })
})

describe('⛔ 사람 편집을 덮지 않는다', () => {
  it('사용자가 본문에 쓴 메모가 재발행 후에도 남는다', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })

    const before = (await vault.read('sources/src_01.md'))!
    await vault.write(
      'sources/src_01.md',
      { frontmatter: before.frontmatter, body: `${before.body}\n사람이 쓴 메모\n` },
      { baseHash: before.hash }
    )

    await publishSource(src, { vault, runs })

    expect((await vault.read('sources/src_01.md'))!.body).toContain('사람이 쓴 메모')
  })

  it('앱이 모르는 frontmatter 필드를 보존한다', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })

    const before = (await vault.read('sources/src_01.md'))!
    await vault.write(
      'sources/src_01.md',
      {
        frontmatter: { ...before.frontmatter, obsidian_cssclass: 'wide', 내메모: '중요' },
        body: before.body,
      },
      { baseHash: before.hash }
    )

    await publishSource(src, { vault, runs })

    const after = (await vault.read('sources/src_01.md'))!.frontmatter
    expect(after.obsidian_cssclass).toBe('wide')
    expect(after['내메모']).toBe('중요')
  })

  it('사용자가 바꾼 제목을 되돌리지 않는다', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })

    const before = (await vault.read('sources/src_01.md'))!
    await vault.write(
      'sources/src_01.md',
      { frontmatter: { ...before.frontmatter, title: '결제 모듈 킥오프' }, body: before.body },
      { baseHash: before.hash }
    )

    await publishSource(src, { vault, runs })

    expect((await vault.read('sources/src_01.md'))!.frontmatter.title).toBe(
      '결제 모듈 킥오프'
    )
  })

  it('두 번 발행해도 결과가 같다 — 멱등', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })
    const a = (await vault.read('sources/src_01.md'))!.hash
    await publishSource(src, { vault, runs })
    expect((await vault.read('sources/src_01.md'))!.hash).toBe(a)
  })
})

describe('ready 이전에는 발행하지 않는다', () => {
  it('불완전한 source는 vault에 쓰이지 않는다 — Inbox에 남는다', async () => {
    await repo.create(manifest())
    await repo.putChunk('src_01', {
      track: 'mic',
      seq: 0,
      bytes: new Uint8Array(10).fill(1),
    })
    const src = await repo.finalize('src_01')
    expect(src.state).toBe('finalizing')

    await expect(publishSource(src, { vault, runs })).rejects.toThrow(/ready/)
    expect(await vault.read('sources/src_01.md')).toBeNull()
  })
})

describe('불변 이력도 함께 남는다 — 11절', () => {
  it('runs/sources/<id>/source.json이 생긴다', async () => {
    await publishSource(await readySource(), { vault, runs })
    const back = await runs.readAudio('src_01', 'source.json')
    expect(back).not.toBeNull()
  })

  it('이력에는 source_hash와 manifest가 들어간다', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })
    const raw = JSON.parse((await runs.readAudio('src_01', 'source.json'))!.toString())
    expect(raw.source_hash).toBe(src.sourceHash)
    expect(raw.manifest.chunkDurationMs).toBe(5000)
  })

  it('⛔ 이력은 다시 쓰이지 않는다 — 재발행해도 첫 기록이 남는다', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })
    // 재발행이 이력 충돌로 실패하면 안 된다 (같은 내용이므로 멱등 통과)
    await expect(publishSource(src, { vault, runs })).resolves.toBeUndefined()
  })
})

describe('외부에서 파일을 지웠으면 다시 만든다', () => {
  it('vault 문서를 지우고 재발행하면 복구된다', async () => {
    const src = await readySource()
    await publishSource(src, { vault, runs })
    await writeFile(path.join(root, 'vault/sources/src_01.md'), '', 'utf8')
    await rm(path.join(root, 'vault/sources/src_01.md'))

    await publishSource(src, { vault, runs })

    expect(await vault.read('sources/src_01.md')).not.toBeNull()
  })
})
