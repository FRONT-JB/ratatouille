/**
 * 검수 API — PLAN.md 순서 5 완료 조건.
 *
 * ⛔ 큐가 규칙을 강제하고, 여기는 그 거절을 HTTP로 옮길 뿐이다.
 *    판단을 두 곳에서 하지 않는다. 다만 **입력 검증은 여기 몫**이다 —
 *    모르는 section 이름이 조용히 통과하면 아무 일도 안 일어난 것처럼 보인다.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { DEFAULT_PROVENANCE, DocumentQueue } from '../src/documents/queue.ts'
import { DocumentRunner } from '../src/documents/runner.ts'
import { RevisionStore } from '../src/revisions/store.ts'
import { RunArtifactStore } from '../src/runs/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'

let root: string
let app: Hono
let documents: DocumentQueue
let runId: string

const MODEL_OUTPUT = JSON.stringify({
  narrative: [{ heading: '오픈 일정', body: '연기하기로 했다[seg_0].' }],
  summary: { text: '오픈을 미뤘다[seg_0].' },
  decisions: [{ what: '3월 16일로 연기[seg_1].' }],
  tasks: [],
})

function fakeHermes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (() => {
    const e = new EventEmitter() as any
    e.stdout = new EventEmitter()
    e.stderr = new EventEmitter()
    e.kill = () => undefined
    void (async () => {
      await Promise.resolve()
      e.stdout.emit('data', MODEL_OUTPUT)
      e.emit('close', 0)
    })()
    return e
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

const patch = (body: unknown) =>
  app.request('/api/sources/src_01/document/review', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const promote = (body: unknown) =>
  app.request('/api/sources/src_01/document/current', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-rev-api-'))
  const runs = new RunArtifactStore(path.join(root, 'runs'))
  const sources = new SourceRepository(path.join(root, 'blobs'))
  const revisions = new RevisionStore({
    stateRoot: path.join(root, 'revisions'),
    runs,
  })
  documents = new DocumentQueue({
    runner: new DocumentRunner({ spawnFn: fakeHermes() }),
    sources,
    revisions,
    runs,
    stateRoot: path.join(root, 'docruns'),
    provenance: DEFAULT_PROVENANCE,
  })
  app = createApp({ sources, runs, revisions, documents })

  await sources.create({
    sourceId: 'src_01',
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: '마이크' },
    tracks: ['mic'],
    expectedChunks: {},
    pauses: [],
    chunkDurationMs: 5000,
  })
  await sources.putChunk('src_01', {
    track: 'mic',
    seq: 0,
    bytes: new Uint8Array(16).fill(1),
  })
  await sources.finalize('src_01', { expectedChunks: { mic: 1 } })
  await revisions.open({
    sourceId: 'src_01',
    jobId: 'tr_src_01_1',
    segments: [
      { id: 'seg_0', startMs: 0, endMs: 4000, text: '오픈을 연기합니다.' },
      { id: 'seg_1', startMs: 4000, endMs: 8000, text: '3월 16일로 하죠.' },
    ],
  })
  await revisions.approve('src_01')
  runId = (await documents.enqueue('src_01')).id
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('검수 상태 갱신', () => {
  it('section 하나를 확인 처리한다', async () => {
    const res = await patch({ runId, section: 'summary', state: 'accepted' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      review: Record<'summary' | 'tasks', { state: string }>
    }
    expect(body.review.summary.state).toBe('accepted')
    expect(body.review.tasks.state).toBe('unreviewed')
  })

  it('루브릭 판정만 따로 바꿀 수 있다', async () => {
    await patch({ runId, section: 'decisions', state: 'accepted' })
    const res = await patch({
      runId,
      section: 'decisions',
      rubric: { 'decision-vs-proposal': 'fix_required' },
    })
    const body = (await res.json()) as {
      review: Record<'decisions', { state: string; rubric: Record<string, string> }>
    }
    // ⛔ 상태를 안 보냈다고 초기화되면 안 된다
    expect(body.review.decisions.state).toBe('accepted')
    expect(body.review.decisions.rubric['decision-vs-proposal']).toBe('fix_required')
  })

  it('⛔ 모르는 section은 400이다 — 조용히 통과하면 아무 일도 없는 것처럼 보인다', async () => {
    expect((await patch({ runId, section: '열린질문' })).status).toBe(400)
  })

  it('⛔ 모르는 검수 상태도 400이다', async () => {
    expect(
      (await patch({ runId, section: 'summary', state: 'perfect' })).status
    ).toBe(400)
  })

  it('runId가 없으면 400이다', async () => {
    expect((await patch({ section: 'summary' })).status).toBe(400)
  })

  it('없는 run은 404다', async () => {
    expect((await patch({ runId: 'doc_없음', section: 'summary' })).status).toBe(404)
  })
})

const editContent = (body: unknown) =>
  app.request('/api/sources/src_01/document/content', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('결과 편집', () => {
  it('요약을 고치면 반영되고 edited가 된다', async () => {
    const res = await editContent({
      runId,
      section: 'summary',
      kind: 'text',
      text: '사람이 고쳤다[seg_0].',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      proposal: { summary: { text: string } }
      review: Record<'summary', { state: string }>
    }
    expect(body.proposal.summary.text).toBe('사람이 고쳤다[seg_0].')
    expect(body.review.summary.state).toBe('edited')
  })

  it('⛔ 없는 발언을 인용하면 409다', async () => {
    const res = await editContent({
      runId,
      section: 'summary',
      kind: 'text',
      text: '지어냈다[seg_999].',
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toContain('seg_999')
  })

  it('⛔ 근거를 전부 떼면 409다 — 회의록이 아니라 메모가 된다', async () => {
    const res = await editContent({
      runId,
      section: 'summary',
      kind: 'text',
      text: '근거 없는 문장.',
    })
    expect(res.status).toBe(409)
  })

  it('결정을 지울 수 있다 — 결함 B의 시정 수단이다', async () => {
    const res = await editContent({
      runId,
      section: 'decisions',
      kind: 'remove',
      index: 0,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { proposal: { decisions: [] } }).proposal.decisions)
      .toHaveLength(0)
  })

  it('section·kind가 없으면 400이다', async () => {
    expect((await editContent({ runId, section: 'summary' })).status).toBe(400)
  })
})

describe('⛔ 검수를 마쳐야 확정된다', () => {
  const acceptAll = async () => {
    for (const section of ['summary', 'decisions', 'evidence'] as const) {
      await patch({ runId, section, state: 'accepted' })
    }
    // 이 회의에는 할 일이 없다 — 「없음」이 정직하다
    await patch({ runId, section: 'tasks', state: 'empty' })
  }

  it('덜 봤으면 409, 이유가 함께 온다', async () => {
    const res = await promote({ runId })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; rule: string }
    expect(body.rule).toBe('document-requires-completed-review')
    expect(body.error).toContain('회의 요약')
  })

  it('무엇이 막는지 GET에서도 보인다', async () => {
    const res = await app.request('/api/sources/src_01/document')
    const body = (await res.json()) as { blockers: { section: string }[] }
    expect(body.blockers).toHaveLength(4)
  })

  it('다 확인하면 current가 된다', async () => {
    await acceptAll()
    const res = await promote({ runId })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { documentState: string }).documentState).toBe(
      'current'
    )
  })

  it('⛔ 확정한 뒤에는 검수 상태를 흔들 수 없다', async () => {
    await acceptAll()
    await promote({ runId })
    const res = await patch({ runId, section: 'summary', state: 'unreviewed' })
    expect(res.status).toBe(409)
  })

  it('⛔ 되돌릴 수 있다 — 없으면 오타 하나에 모델을 다시 돌려야 한다', async () => {
    await acceptAll()
    await promote({ runId })

    const res = await app.request('/api/sources/src_01/document/reopen', {
      method: 'POST',
      body: JSON.stringify({ runId }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { documentState: string }).documentState).toBe(
      'reviewing'
    )
    // 되돌린 뒤에는 다시 고칠 수 있다
    expect((await patch({ runId, section: 'summary', state: 'in_progress' })).status)
      .toBe(200)
  })

  it('⛔ 항목이 있는데 「없음」으로 넘기면 막힌다', async () => {
    for (const section of ['summary', 'tasks', 'evidence'] as const) {
      await patch({ runId, section, state: 'accepted' })
    }
    // 결정이 1건 있는데 없다고 표시했다
    await patch({ runId, section: 'decisions', state: 'empty' })

    const res = await promote({ runId })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toContain('결정 사항')
  })
})
