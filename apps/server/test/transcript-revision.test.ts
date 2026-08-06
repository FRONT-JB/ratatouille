/**
 * 전사 교정 revision — Phase 5의 중심.
 *
 * ⛔ **raw transcript는 불변이다**(5절·11절). 교정은 raw를 고치는 것이 아니라
 *    **별도 revision에 남긴다.** 무엇이 원문이고 무엇이 사람 손을 탄 것인지
 *    구분되지 않으면, 나중에 AI 결과가 틀렸을 때 원인을 되짚을 수 없다.
 *
 * ⛔ **세그먼트 id와 timestamp는 편집 대상이 아니다.** evidence 인용이 그 둘로
 *    원문을 가리킨다(review-contract). 텍스트만 고친다.
 *
 * ⛔ **확정한 전사를 다시 고치면 새 revision이 열리고 기존 문서는 `stale`이
 *    된다**(규칙 3). 기존 revision을 되돌리지 않는다.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { RunArtifactStore } from '../src/runs/store.ts'
import { RevisionStore } from '../src/revisions/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { TranscriptionQueue } from '../src/transcription/queue.ts'
import { TranscriptionRunner } from '../src/transcription/runner.ts'

let root: string
let sources: SourceRepository
let queue: TranscriptionQueue
let runs: RunArtifactStore
let revisions: RevisionStore
let app: Hono

const WHISPER_OUT = {
  result: { language: 'ko' },
  transcription: [
    { offsets: { from: 0, to: 2120 }, text: ' 미경험 엔지니어라고 해서' },
    { offsets: { from: 2120, to: 7740 }, text: ' 아예 아무것도 모르는 사람도 채용을 해요.' },
    { offsets: { from: 9740, to: 15460 }, text: ' 옛날에 한국의 SI 대기업들이' },
  ],
}

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
        emitter.stdout.emit('data', '15.5')
        emitter.emit('close', 0)
        return
      }
      if (cmd.includes('ffmpeg')) {
        await writeFile(args[args.length - 1]!, 'wav')
        emitter.emit('close', 0)
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

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-rev-'))
  runs = new RunArtifactStore(path.join(root, 'runs'))
  sources = new SourceRepository(path.join(root, 'blobs'))
  revisions = new RevisionStore({ stateRoot: path.join(root, 'revisions'), runs })
  queue = new TranscriptionQueue({
    runner: new TranscriptionRunner({ modelPath: '/m.bin', spawnFn: fakeSpawn() }),
    sources,
    runs,
    workRoot: path.join(root, 'work'),
    stateRoot: path.join(root, 'jobs'),
    chunkFilesOf: async (id) => sources.chunkFiles(id),
    // 전사가 끝나면 교정본이 열린다 — 조회가 만드는 것이 아니다
    onCompleted: async ({ job, segments }) => {
      await revisions.open({ sourceId: job.sourceId, jobId: job.id, segments })
    },
  })
  app = createApp({ sources, transcription: queue, runs, revisions })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json()

async function transcribed(id = 'src_01') {
  await app.request('/api/sources', {
    method: 'POST',
    body: JSON.stringify({
      sourceId: id,
      captureMode: 'in_person',
      startedAt: '2026-08-06T10:00:00+09:00',
      devices: { mic: '마이크' },
      tracks: ['mic'],
      expectedChunks: {},
      pauses: [],
      chunkDurationMs: 5000,
    }),
    headers: { 'content-type': 'application/json' },
  })
  await app.request(`/api/sources/${id}/chunks/mic/0`, {
    method: 'PUT',
    body: new Uint8Array(32).fill(3),
  })
  await app.request(`/api/sources/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ expectedChunks: { mic: 1 } }),
    headers: { 'content-type': 'application/json' },
  })
  await app.request(`/api/sources/${id}/transcribe`, { method: 'POST' })
}

const getRevision = (id = 'src_01') => app.request(`/api/sources/${id}/revision`)

const edit = (
  segments: { id: string; text: string }[],
  id = 'src_01'
) =>
  app.request(`/api/sources/${id}/revision`, {
    method: 'PATCH',
    body: JSON.stringify({ segments }),
    headers: { 'content-type': 'application/json' },
  })

const approve = (id = 'src_01') =>
  app.request(`/api/sources/${id}/revision/approve`, { method: 'POST' })

const reopen = (id = 'src_01') =>
  app.request(`/api/sources/${id}/revision/reopen`, { method: 'POST' })

describe('전사에서 교정 초안이 열린다', () => {
  it('전사가 끝나면 교정할 revision이 있다', async () => {
    await transcribed()
    const r = await json(await getRevision())

    expect(r.revisionState).toBe('transcript_reviewing')
    expect(r.segments).toHaveLength(3)
  })

  it('초안 텍스트는 전사 원문과 같다 — 시작점을 지어내지 않는다', async () => {
    await transcribed()
    const r = await json(await getRevision())

    expect(r.segments[0].text).toBe('미경험 엔지니어라고 해서')
  })

  it('⛔ 원문을 함께 준다 — 무엇이 고쳐졌는지 화면이 보여줄 수 있어야 한다', async () => {
    await transcribed()
    const r = await json(await getRevision())

    expect(r.segments[0].original).toBe('미경험 엔지니어라고 해서')
  })

  it('timestamp가 온다 — 눌러서 그 지점을 듣는 것이 목적이다', async () => {
    await transcribed()
    const r = await json(await getRevision())

    expect(r.segments[0].startMs).toBe(0)
    expect(r.segments[1].startMs).toBe(2120)
    expect(r.segments[0].timestamp).toBe('00:00:00')
  })

  it('전사가 없으면 404다 — 빈 교정 화면을 열지 않는다', async () => {
    expect((await getRevision('src_없음')).status).toBe(404)
  })
})

describe('교정 저장', () => {
  it('고친 텍스트가 남는다', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '미경험 엔지니어라고 해서요' }])

    const r = await json(await getRevision())
    expect(r.segments[0].text).toBe('미경험 엔지니어라고 해서요')
  })

  it('⛔ 원문은 그대로다 — 고친 뒤에도 무엇이 바뀌었는지 알 수 있다', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '완전히 다른 말' }])

    const r = await json(await getRevision())
    expect(r.segments[0].original).toBe('미경험 엔지니어라고 해서')
    expect(r.segments[0].edited).toBe(true)
  })

  it('건드리지 않은 세그먼트는 edited가 아니다', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '고침' }])

    const r = await json(await getRevision())
    expect(r.segments[1].edited).toBe(false)
  })

  it('일부만 보내도 된다 — 30분 전사를 통째로 올리지 않는다', async () => {
    await transcribed()
    await edit([{ id: 'seg_2', text: '뒤쪽만 고침' }])

    const r = await json(await getRevision())
    expect(r.segments[0].text).toBe('미경험 엔지니어라고 해서')
    expect(r.segments[2].text).toBe('뒤쪽만 고침')
  })

  it('⛔ 없는 세그먼트를 고치려 하면 거절한다 — 조용히 버리지 않는다', async () => {
    await transcribed()
    const res = await edit([{ id: 'seg_없음', text: 'x' }])

    expect(res.status).toBe(400)
    expect((await json(res)).error).toContain('seg_없음')
  })

  it('빈 텍스트도 받는다 — 잘못 인식된 구간을 지울 수 있어야 한다', async () => {
    await transcribed()
    expect((await edit([{ id: 'seg_0', text: '' }])).status).toBe(200)
  })

  it('⛔ timestamp는 못 고친다 — evidence가 그것으로 원문을 가리킨다', async () => {
    await transcribed()
    await app.request('/api/sources/src_01/revision', {
      method: 'PATCH',
      body: JSON.stringify({
        segments: [{ id: 'seg_0', text: 'x', startMs: 99999, endMs: 99999 }],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const r = await json(await getRevision())
    expect(r.segments[0].startMs).toBe(0)
  })

  it('서버를 재시작해도 교정 내용이 남는다', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '살아남아야 한다' }])

    const reloaded = new RevisionStore({
      stateRoot: path.join(root, 'revisions'),
      runs,
    })
    await reloaded.load()
    expect(reloaded.current('src_01')?.segments[0]?.text).toBe('살아남아야 한다')
  })
})

describe('⛔ 확정', () => {
  it('확정하면 transcript_approved가 된다', async () => {
    await transcribed()
    const res = await approve()

    expect(res.status).toBe(200)
    expect((await json(res)).revisionState).toBe('transcript_approved')
  })

  it('⛔ 확정한 뒤에는 고칠 수 없다 — 고치려면 새 revision을 열어야 한다', async () => {
    await transcribed()
    await approve()

    const res = await edit([{ id: 'seg_0', text: '몰래 고치기' }])
    expect(res.status).toBe(409)
  })

  it('⛔ 확정본이 불변 이력에 남는다 (11절)', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '고친 문장' }])
    const { revisionId } = await json(await approve())

    const stored = (await runs.readReviewedTranscript(revisionId)) as {
      segments: { id: string; text: string }[]
    }
    expect(stored.segments[0]!.text).toBe('고친 문장')
  })

  it('두 번 확정해도 터지지 않는다 — 이미 확정된 것은 그대로다', async () => {
    await transcribed()
    await approve()
    expect((await approve()).status).toBe(200)
  })

  it('전사가 없으면 확정할 것도 없다', async () => {
    expect((await approve('src_없음')).status).toBe(404)
  })
})

describe('⛔ 재교정 — 규칙 3', () => {
  it('확정한 전사를 다시 열면 새 revision이 생긴다', async () => {
    await transcribed()
    const first = await json(await approve())

    const res = await reopen()
    expect(res.status).toBe(200)
    const second = await json(res)

    expect(second.revisionState).toBe('transcript_reviewing')
    expect(second.revisionId).not.toBe(first.revisionId)
  })

  it('⛔ 이전 확정본을 덮지 않는다 — 되짚을 수 있어야 한다', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '첫 번째 확정' }])
    const first = await json(await approve())

    await reopen()
    await edit([{ id: 'seg_0', text: '두 번째 교정' }])
    await approve()

    const stored = (await runs.readReviewedTranscript(first.revisionId)) as {
      segments: { text: string }[]
    }
    expect(stored.segments[0]!.text).toBe('첫 번째 확정')
  })

  it('새 revision은 직전 확정본에서 이어간다 — 처음부터 다시 고치지 않는다', async () => {
    await transcribed()
    await edit([{ id: 'seg_0', text: '첫 교정' }])
    await approve()
    await reopen()

    const r = await json(await getRevision())
    expect(r.segments[0].text).toBe('첫 교정')
    // 원문은 여전히 전사 원문이다 — 교정본이 새 원문이 되지 않는다
    expect(r.segments[0].original).toBe('미경험 엔지니어라고 해서')
  })

  it('아직 확정하지 않았으면 새로 열 필요가 없다', async () => {
    await transcribed()
    const res = await reopen()

    expect(res.status).toBe(409)
    expect((await json(res)).error).toMatch(/이미|편집/)
  })
})

describe('세션에 교정 상태가 보인다', () => {
  it('⛔ 전사만 끝난 것과 교정 확정한 것이 구분된다', async () => {
    await transcribed()
    const before = (await json(await app.request('/api/session'))).sources[0]
    expect(before.revisionState).toBe('transcript_reviewing')

    await approve()
    const after = (await json(await app.request('/api/session'))).sources[0]
    expect(after.revisionState).toBe('transcript_approved')
  })

  it('전사 전에는 revision 상태가 없다 — 없는 것을 있는 척하지 않는다', async () => {
    await app.request('/api/sources', {
      method: 'POST',
      body: JSON.stringify({
        sourceId: 'src_02',
        captureMode: 'in_person',
        startedAt: '2026-08-06T10:00:00+09:00',
        devices: { mic: 'm' },
        tracks: ['mic'],
        expectedChunks: {},
        pauses: [],
        chunkDurationMs: 5000,
      }),
      headers: { 'content-type': 'application/json' },
    })

    const s = (await json(await app.request('/api/session'))).sources.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (x: any) => x.sourceId === 'src_02'
    )
    expect(s.revisionState).toBeNull()
  })
})
