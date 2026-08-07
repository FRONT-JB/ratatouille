/**
 * 회의 삭제.
 *
 * ⛔ **왜 필요한가 (실제로 겪은 일):** 녹음 중 브라우저가 죽으면 그 source는
 *    `capturing`인 채로 사이드바에 영원히 남았다. 화면에서 지울 방법이 없어서
 *    사용자가 나에게 터미널로 지워달라고 해야 했다. 쌓이는 쓰레기를 사용자가
 *    직접 치울 수 없으면 그건 제품이 아니다.
 *
 * ⛔ **완전히 소거하지 않는다. `.data/trash`로 옮긴다.** raw audio는 되돌릴 수
 *    없다(5절). 51분짜리 녹음을 오조작 한 번으로 잃게 두지 않는다. 대신
 *    응답에 어디로 옮겼는지를 반드시 알려서, "지웠다"는 말이 거짓이 되지 않게 한다.
 */

import { EventEmitter } from 'node:events'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { DEFAULT_PROVENANCE, DocumentQueue } from '../src/documents/queue.ts'
import { DocumentRunner } from '../src/documents/runner.ts'
import { RevisionStore } from '../src/revisions/store.ts'
import { RunArtifactStore } from '../src/runs/store.ts'
import { publishSource } from '../src/sources/publish.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { TranscriptionQueue } from '../src/transcription/queue.ts'
import { TranscriptionRunner } from '../src/transcription/runner.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let sources: SourceRepository
let queue: TranscriptionQueue
let runs: RunArtifactStore
let revisions: RevisionStore
let vault: VaultStore
let documents: DocumentQueue
let app: Hono

/** AI 정리가 돌려줄 결과. 근거는 전사에 실재하는 seg_0 하나면 된다 */
const MODEL_OUT = JSON.stringify({
  summary: { text: '인사했다[seg_0].' },
  decisions: [],
  tasks: [],
})

/** Hermes 대신. 실제 호출 검증은 document runner 테스트가 한다 */
function fakeHermes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (() => {
    const emitter = new EventEmitter() as any
    emitter.stdout = new EventEmitter()
    emitter.stderr = new EventEmitter()
    emitter.kill = () => undefined
    void (async () => {
      await Promise.resolve()
      emitter.stdout.emit('data', MODEL_OUT)
      emitter.emit('close', 0)
    })()
    return emitter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

const WHISPER_OUT = {
  result: { language: 'ko' },
  transcription: [{ offsets: { from: 0, to: 4000 }, text: ' 안녕하세요.' }],
}

/**
 * whisper를 붙잡아 둘 수 있는 문. 실제 실행 검증은 runner 테스트가 한다.
 *
 * ⛔ 「전사 중에는 못 지운다」를 검증하려면 **전사가 실제로 돌고 있는 순간**이
 *    필요하다. 가짜 spawn이 즉시 끝나버리면 지우려 할 때는 이미 끝나 있어서,
 *    테스트가 통과해도 아무것도 증명하지 못한다.
 */
let hold: Promise<void> | null = null
let release: (() => void) | null = null

function holdWhisper(): void {
  hold = new Promise<void>((r) => {
    release = r
  })
}

/** whisper·ffmpeg 대신 쓸 가짜 spawn. 실제 실행 검증은 runner 테스트가 한다. */
function fakeSpawn() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((cmd: string, args: string[]) => {
    const emitter = new EventEmitter() as any
    emitter.stdout = new EventEmitter()
    emitter.stderr = new EventEmitter()
    emitter.kill = () => undefined
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
      if (hold) await hold
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

beforeEach(async () => {
  hold = null
  release = null
  root = await mkdtemp(path.join(tmpdir(), 'rat-del-'))
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  runs = new RunArtifactStore(path.join(root, 'runs'))
  sources = new SourceRepository(path.join(root, 'blobs'))
  revisions = new RevisionStore({ stateRoot: path.join(root, 'revisions'), runs })
  queue = new TranscriptionQueue({
    runner: new TranscriptionRunner({ modelPath: '/m/model.bin', spawnFn: fakeSpawn() }),
    sources,
    runs,
    workRoot: path.join(root, 'work'),
    stateRoot: path.join(root, 'jobs'),
    chunkFilesOf: async (id) => sources.chunkFiles(id),
    onCompleted: async ({ job, segments }) => {
      await revisions.open({ sourceId: job.sourceId, jobId: job.id, segments })
    },
  })
  documents = new DocumentQueue({
    runner: new DocumentRunner({ spawnFn: fakeHermes() }),
    sources,
    revisions,
    runs,
    vault,
    stateRoot: path.join(root, 'docruns'),
    provenance: DEFAULT_PROVENANCE,
  })
  app = createApp({
    sources,
    transcription: queue,
    runs,
    revisions,
    documents,
    vault,
    publish: (src) => publishSource(src, { vault, runs }),
    trashRoot: path.join(root, 'trash'),
  })
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

const start = (id = 'src_01') =>
  app.request('/api/sources', {
    method: 'POST',
    body: JSON.stringify(manifest({ sourceId: id })),
    headers: { 'content-type': 'application/json' },
  })

async function readySource(id = 'src_01') {
  await start(id)
  for (const seq of [0, 1]) {
    await app.request(`/api/sources/${id}/chunks/mic/${seq}`, {
      method: 'PUT',
      body: new Uint8Array(64).fill(seq + 1),
    })
  }
  await app.request(`/api/sources/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ expectedChunks: { mic: 2 } }),
    headers: { 'content-type': 'application/json' },
  })
}

const exists = async (p: string) =>
  access(p).then(
    () => true,
    () => false
  )

const del = (id = 'src_01') => app.request(`/api/sources/${id}`, { method: 'DELETE' })

describe('⛔ 사용자가 회의를 지울 수 있다', () => {
  it('수집이 멈춰버린 회의를 지운다 — 이게 애초의 이유다', async () => {
    await start()
    expect((await json(await app.request('/api/session'))).sources).toHaveLength(1)

    const res = await del()
    expect(res.status).toBe(200)

    // 목록에서 사라진다. 이게 사용자가 확인하는 유일한 사실이다.
    expect((await json(await app.request('/api/session'))).sources).toHaveLength(0)
  })

  it('전사까지 끝난 회의도 지운다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    expect((await del()).status).toBe(200)
    expect((await json(await app.request('/api/session'))).sources).toHaveLength(0)
  })

  it('없는 회의를 지우면 404다 — 지웠다고 거짓말하지 않는다', async () => {
    expect((await del('src_없음')).status).toBe(404)
  })

  it('두 번 지워도 두 번째는 404다', async () => {
    await start()
    expect((await del()).status).toBe(200)
    expect((await del()).status).toBe(404)
  })

  it('다른 회의는 건드리지 않는다', async () => {
    await start('src_01')
    await start('src_02')

    await del('src_01')

    const ids = (await json(await app.request('/api/session'))).sources.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.sourceId
    )
    expect(ids).toEqual(['src_02'])
    expect(await exists(path.join(root, 'blobs/src_02'))).toBe(true)
  })
})

describe('⛔ 지운 것을 되찾을 수 있다 — 휴지통', () => {
  // raw audio는 불변이고 되돌릴 수 없다(5절). 오조작 한 번으로 51분짜리
  // 녹음을 영영 잃게 두지 않는다.

  it('조각이 소거되지 않고 휴지통으로 옮겨진다', async () => {
    await readySource()
    expect(await exists(path.join(root, 'blobs/src_01/mic/000000.webm'))).toBe(true)

    const body = await json(await del())

    // 원래 자리에는 없다
    expect(await exists(path.join(root, 'blobs/src_01'))).toBe(false)
    // 휴지통에는 **바이트가 그대로** 있다
    expect(await exists(path.join(body.trashPath, 'blobs/mic/000000.webm'))).toBe(true)
  })

  it('어디로 옮겼는지 응답이 알려준다 — 모르면 되찾을 수 없다', async () => {
    await start()
    const body = await json(await del())
    expect(body.trashPath).toContain('trash')
    expect(body.trashPath).toContain('src_01')
  })

  it('vault 문서도 휴지통으로 간다 — 사람이 고친 내용이 들어 있다', async () => {
    await readySource()
    expect(await exists(path.join(root, 'vault/sources/src_01.md'))).toBe(true)

    const body = await json(await del())

    expect(await exists(path.join(root, 'vault/sources/src_01.md'))).toBe(false)
    expect(await exists(path.join(body.trashPath, 'vault/sources/src_01.md'))).toBe(true)
  })

  /*
   * ⛔ **한 회의에 딸린 vault 문서를 전부 옮긴다.** 회의록만 남으면 지운 회의가
   *    검색에 계속 잡히고, 결정 파일만 남으면 근거를 따라갈 회의록이 없다.
   *    삭제가 반쪽이면 사용자는 두 번 지워야 한다 — 어디를 지울지도 모른 채로.
   */
  it('회의록과 결정 사항도 함께 간다', async () => {
    await readySource()
    await vault.write('notes/src_01.md', {
      frontmatter: { source_id: 'src_01' },
      body: '## 요약\n\n오픈을 연기했다.\n',
    })
    await vault.write('decisions/dec_src_01_1.md', {
      frontmatter: { decision_id: 'dec_src_01_1', source_id: 'src_01', status: 'active' },
      body: '오픈을 연기한다.\n',
    })
    // 다른 회의의 결정은 건드리지 않는다
    await vault.write('decisions/dec_src_02_1.md', {
      frontmatter: { decision_id: 'dec_src_02_1', source_id: 'src_02', status: 'active' },
      body: '다른 회의의 결정.\n',
    })

    const body = await json(await del())

    expect(await exists(path.join(root, 'vault/notes/src_01.md'))).toBe(false)
    expect(await exists(path.join(body.trashPath, 'vault/notes/src_01.md'))).toBe(true)
    expect(await exists(path.join(root, 'vault/decisions/dec_src_01_1.md'))).toBe(false)
    expect(
      await exists(path.join(body.trashPath, 'vault/decisions/dec_src_01_1.md'))
    ).toBe(true)
    expect(await exists(path.join(root, 'vault/decisions/dec_src_02_1.md'))).toBe(true)
  })

  /*
   * ⛔ **AI 정리 결과도 함께 간다.** 실제로 겪었다 — 회의를 지웠는데
   *    `document-runs/`가 남아 서버 메모리에도 그대로 있었다. 같은 id로 새
   *    회의를 만들면 «최신 정리»가 **지운 회의의 결정과 할 일**을 돌려준다.
   *    목록에서는 사라졌는데 검수 화면에서는 살아 있는 유령이다.
   */
  it('⛔ AI 정리 결과와 실행 이력도 함께 간다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    await revisions.approve('src_01')
    const run = await documents.enqueue('src_01')
    expect(run.state).toBe('proposed')

    const body = await json(await del())

    expect(await exists(path.join(root, 'docruns', run.id))).toBe(false)
    expect(await exists(path.join(body.trashPath, 'documents', run.id))).toBe(true)
    expect(
      await exists(path.join(body.trashPath, 'runs/documentation-runs', run.id))
    ).toBe(true)
  })

  it('⛔ 지운 회의의 정리 결과가 새 회의에 붙지 않는다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    await revisions.approve('src_01')
    await documents.enqueue('src_01')

    await del()

    // 같은 id로 다시 시작해도 옛 결정·할 일이 따라오면 안 된다
    expect(documents.latestFor('src_01')).toBeNull()
  })

  it('전사 원문과 job 상태도 함께 간다 — 조각만 옮기면 반쪽이다', async () => {
    await readySource()
    const job = await json(
      await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    )

    const body = await json(await del())

    expect(await exists(path.join(root, 'jobs', job.id))).toBe(false)
    expect(await exists(path.join(root, 'runs/transcriptions', job.id))).toBe(false)
    expect(
      await exists(path.join(body.trashPath, 'runs/transcriptions', job.id))
    ).toBe(true)
    expect(await exists(path.join(body.trashPath, 'jobs', job.id))).toBe(true)
  })

  it('⛔ 전사 교정본도 함께 간다 — 사람이 고친 문장이다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    await app.request('/api/sources/src_01/revision', {
      method: 'PATCH',
      body: JSON.stringify({ segments: [{ id: 'seg_0', text: '사람이 고친 문장' }] }),
      headers: { 'content-type': 'application/json' },
    })
    expect(await exists(path.join(root, 'revisions/src_01'))).toBe(true)

    const body = await json(await del())

    expect(await exists(path.join(root, 'revisions/src_01'))).toBe(false)
    expect(await exists(path.join(body.trashPath, 'revisions/src_01'))).toBe(true)
  })

  it('⛔ 지운 뒤 같은 id로 새로 녹음해도 옛 교정 내용이 붙지 않는다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    await app.request('/api/sources/src_01/revision', {
      method: 'PATCH',
      body: JSON.stringify({ segments: [{ id: 'seg_0', text: '옛 회의 내용' }] }),
      headers: { 'content-type': 'application/json' },
    })
    await del()
    await start('src_01')

    const res = await app.request('/api/sources/src_01/revision')
    // 전사가 없으니 교정할 것도 없다. 200으로 옛 내용을 주면 안 된다.
    expect(res.status).toBe(404)
  })

  it('무엇을 옮겼는지 응답에 적힌다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })

    const body = await json(await del())
    expect(body.moved).toEqual(
      expect.arrayContaining(['blobs', 'vault', 'runs/sources', 'jobs'])
    )
  })
})

describe('⛔ 돌고 있는 전사는 지우지 못한다', () => {
  it('전사 중인 회의는 409로 거절한다', async () => {
    await readySource()
    // whisper를 붙잡아 둔다 — 실제로 도는 중에 지우기를 시도해야 의미가 있다
    holdWhisper()
    const running = app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    await new Promise((r) => setTimeout(r, 10))

    const res = await del()
    expect(res.status).toBe(409)
    expect((await json(res)).error).toMatch(/전사/)
    // ⛔ 거절했으면 아무것도 옮기지 않아야 한다. 반쯤 옮기면 전사가 깨진다.
    expect(await exists(path.join(root, 'blobs/src_01/mic/000000.webm'))).toBe(true)

    release!()
    await running
    // 끝난 뒤에는 지울 수 있다
    expect((await del()).status).toBe(200)
  })
})

describe('메모리도 함께 잊는다', () => {
  it('지운 뒤 같은 id로 새 녹음을 시작할 수 있다', async () => {
    await readySource()
    await del()

    const res = await start('src_01')
    // 201이어야 한다. 200이면 옛 기록이 메모리에 남아 "재접속"으로 처리된 것이다.
    expect(res.status).toBe(201)
    expect((await json(res)).sourceState).toBe('capturing')
  })

  it('지운 회의의 조각 기록이 새 녹음에 섞이지 않는다', async () => {
    await readySource()
    await del()
    await start('src_01')

    const s = await json(await app.request('/api/sources/src_01'))
    expect(s.chunkCount).toBe(0)
  })

  it('지운 회의의 job이 세션에 남지 않는다', async () => {
    await readySource()
    await app.request('/api/sources/src_01/transcribe', { method: 'POST' })
    await del()
    await start('src_01')

    const s = (await json(await app.request('/api/session'))).sources[0]
    expect(s.job).toBeNull()
  })
})

describe('휴지통이 서로를 덮지 않는다', () => {
  it('같은 id를 두 번 만들고 두 번 지워도 첫 번째가 남는다', async () => {
    await readySource()
    const first = await json(await del())

    await readySource()
    const second = await json(await del())

    expect(second.trashPath).not.toBe(first.trashPath)
    expect(await exists(path.join(first.trashPath, 'blobs/mic/000000.webm'))).toBe(true)
    expect(await exists(path.join(second.trashPath, 'blobs/mic/000000.webm'))).toBe(true)
    expect((await readdir(path.join(root, 'trash'))).length).toBe(2)
  })
})
