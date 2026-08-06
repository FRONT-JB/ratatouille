/**
 * degraded_draft — 규칙 5, Test 6.4.
 *
 * ⛔ **자동 fallback이 아니다.** 근거 검증에 실패한 결과는 그 자리에 그대로
 *    남고(위반 목록과 함께), 그것을 「초안으로 보겠다」고 **사람이 말할 때만**
 *    초안이 된다. 서버가 알아서 초안으로 승격시키는 경로는 하나도 없다.
 *
 * ⛔ **초안은 확정되지 않는다.** 근거 검증을 통과하지 못한 결과가 vault의 정식
 *    원본이 되면, 없는 발언을 인용한 회의록이 「확정본」 이름을 달고 남는다.
 *    이 앱이 막으려는 것 하나가 통째로 뚫린다.
 */

import { EventEmitter } from 'node:events'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { RuleViolationError } from '@ratatouille/contracts'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { DEFAULT_PROVENANCE, DocumentQueue } from '../src/documents/queue.ts'
import { DocumentRunner } from '../src/documents/runner.ts'
import { RevisionStore } from '../src/revisions/store.ts'
import { RunArtifactStore } from '../src/runs/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let app: Hono
let documents: DocumentQueue
let sources: SourceRepository
let revisions: RevisionStore
let runs: RunArtifactStore
let vault: VaultStore

/** 모델이 돌려줄 JSON. 테스트마다 갈아끼운다 */
let modelOutput: string

/** 근거 검증을 통과하는 결과 */
const VERIFIED = JSON.stringify({
  summary: { text: '오픈을 미뤘다[seg_0].' },
  decisions: [{ what: '3월 16일로 연기[seg_1].' }],
  tasks: [],
})

/**
 * 없는 세그먼트를 인용한 결과 — 진짜 환각이다.
 *
 * 실측에서 나온 결함 A와 같은 모양이고, 이 결과가 `failed_retryable`로 남되
 * 내용은 버려지지 않는다. 초안이 있어야 하는 이유가 바로 이 상태다.
 */
const HALLUCINATED = JSON.stringify({
  summary: { text: '오픈을 미뤘다[seg_0].' },
  decisions: [{ what: '없는 말을 인용한 결정[seg_999].' }],
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
      e.stdout.emit('data', modelOutput)
      e.emit('close', 0)
    })()
    return e
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

const draft = (body: unknown) =>
  app.request('/api/sources/src_01/document/draft', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-draft-'))
  modelOutput = HALLUCINATED
  runs = new RunArtifactStore(path.join(root, 'runs'))
  sources = new SourceRepository(path.join(root, 'blobs'))
  revisions = new RevisionStore({ stateRoot: path.join(root, 'revisions'), runs })
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  documents = new DocumentQueue({
    runner: new DocumentRunner({ spawnFn: fakeHermes() }),
    sources,
    revisions,
    runs,
    vault,
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
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('⛔ 초안은 자동으로 생기지 않는다 — 규칙 5', () => {
  it('검증에 실패한 결과도 초안이 아니다', async () => {
    const run = await documents.enqueue('src_01')

    // 실패는 실패로 남는다. 초안으로 둔갑시키지 않는다
    expect(run.state).toBe('failed_retryable')
    expect(run.violations.some((v) => v.kind === 'unknown_segment')).toBe(true)
    expect(run.degradedDraft).toBe(false)
  })

  it('⛔ 다시 시도해도 초안으로 내려앉지 않는다', async () => {
    // 「몇 번 실패하면 초안으로」 같은 완충 장치가 생기면 그것이 자동 fallback이다
    await documents.enqueue('src_01')
    await documents.enqueue('src_01')
    const third = await documents.enqueue('src_01')

    expect(third.degradedDraft).toBe(false)
    expect(documents.listFor('src_01').some((r) => r.degradedDraft)).toBe(false)
  })

  it('사람이 명시적으로 요청하면 초안이 된다', async () => {
    const run = await documents.enqueue('src_01')
    const drafted = await documents.requestDegradedDraft(run.id, true)

    expect(drafted.degradedDraft).toBe(true)
    // ⛔ 실행 상태는 그대로다. 왜 실패했는지가 초안 표시에 덮이면 안 된다
    expect(drafted.state).toBe('failed_retryable')
    // 위반 목록도 그대로다 — 무엇이 잘못된 초안인지 보여줄 근거가 이것뿐이다
    expect(drafted.violations.length).toBeGreaterThan(0)
  })

  it('⛔ 요청하지 않은 초안은 거절한다 — 규칙 5가 여기서 돈다', async () => {
    const run = await documents.enqueue('src_01')
    await expect(documents.requestDegradedDraft(run.id, false)).rejects.toThrow(
      /자동 fallback이 아니다/
    )
    expect(documents.get(run.id)!.degradedDraft).toBe(false)
  })

  it('⛔ 검증을 통과한 결과는 초안이 될 수 없다 — 초안이라 부르면 거짓말이다', async () => {
    modelOutput = VERIFIED
    const run = await documents.enqueue('src_01')
    expect(run.state).toBe('proposed')

    await expect(documents.requestDegradedDraft(run.id, true)).rejects.toThrow(
      RuleViolationError
    )
  })

  it('결과가 아예 없으면 초안도 없다', async () => {
    modelOutput = '정리할 수 없습니다'
    const run = await documents.enqueue('src_01')
    expect(run.proposal).toBeNull()

    await expect(documents.requestDegradedDraft(run.id, true)).rejects.toThrow(
      /결과가 없/
    )
  })

  it('초안 표시가 디스크에 남는다 — 재시작하면 다시 물어야 하면 안 된다', async () => {
    const run = await documents.enqueue('src_01')
    await documents.requestDegradedDraft(run.id, true)

    const reloaded = new DocumentQueue({
      runner: new DocumentRunner({ spawnFn: fakeHermes() }),
      sources,
      revisions,
      runs,
      stateRoot: path.join(root, 'docruns'),
      provenance: DEFAULT_PROVENANCE,
    })
    await reloaded.load()
    expect(reloaded.get(run.id)!.degradedDraft).toBe(true)
  })
})

describe('⛔ 초안은 확정되지 않는다', () => {
  it('확정하려 하면 초안이라고 거절한다', async () => {
    const run = await documents.enqueue('src_01')
    await documents.requestDegradedDraft(run.id, true)

    /*
     * ⛔ 「'failed_retryable' 상태입니다」로 거절하면 무엇이 문제인지 모른다.
     *    초안이라서 막혔다는 말이 먼저 나와야 한다.
     */
    await expect(documents.promote(run.id)).rejects.toThrow(/초안/)
    await documents.promote(run.id).catch((e) => {
      expect((e as RuleViolationError).rule).toBe('degraded-draft-cannot-be-current')
    })
  })

  it('⛔ 초안은 vault에 쓰이지 않는다 — 정식 원본은 검증을 통과한 것만이다', async () => {
    const run = await documents.enqueue('src_01')
    await documents.requestDegradedDraft(run.id, true)
    await documents.promote(run.id).catch(() => undefined)

    await expect(
      access(path.join(root, 'vault', 'notes', 'src_01.md'))
    ).rejects.toThrow()
  })

  it('⛔ 초안은 검수 대상이 아니다 — 확정할 수 없는 것을 확인하게 두지 않는다', async () => {
    const run = await documents.enqueue('src_01')
    await documents.requestDegradedDraft(run.id, true)

    await expect(
      documents.review(run.id, 'summary', { state: 'accepted' })
    ).rejects.toThrow(/초안/)
  })

  it('⛔ 초안은 고쳐서 확정할 수 없다 — 검증 통과 기록을 사후 편집으로 만들지 않는다', async () => {
    const run = await documents.enqueue('src_01')
    await documents.requestDegradedDraft(run.id, true)

    await expect(
      documents.edit(run.id, { section: 'summary', kind: 'text', text: '고친 요약[seg_0].' })
    ).rejects.toThrow(/초안/)
  })

  it('다시 정리하면 새 run이고, 그 결과는 초안이 아니다', async () => {
    const first = await documents.enqueue('src_01')
    await documents.requestDegradedDraft(first.id, true)

    modelOutput = VERIFIED
    const second = await documents.enqueue('src_01')

    expect(second.id).not.toBe(first.id)
    expect(second.degradedDraft).toBe(false)
    expect(second.state).toBe('proposed')
    // 초안이었던 실행은 그대로 남는다 — 무엇을 봤는지가 사라지면 안 된다
    expect(documents.get(first.id)!.degradedDraft).toBe(true)
  })
})

describe('초안 API', () => {
  it('명시적으로 승인하면 200과 함께 초안 표시가 온다', async () => {
    const run = await documents.enqueue('src_01')
    const res = await draft({ runId: run.id, acknowledged: true })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      degradedDraft: boolean
      documentRunState: string
    }
    expect(body.degradedDraft).toBe(true)
    expect(body.documentRunState).toBe('failed_retryable')
  })

  it('⛔ 승인 없이 부르면 409 — 우연히 켜지는 경로를 두지 않는다', async () => {
    const run = await documents.enqueue('src_01')
    const res = await draft({ runId: run.id })

    expect(res.status).toBe(409)
    expect(((await res.json()) as { rule: string }).rule).toBe(
      'degraded-draft-requires-explicit-request'
    )
  })

  it('runId가 없으면 400', async () => {
    expect((await draft({ acknowledged: true })).status).toBe(400)
  })

  it('없는 run이면 404', async () => {
    expect((await draft({ runId: 'doc_없음_1', acknowledged: true })).status).toBe(404)
  })

  it('GET에도 초안 표시가 실려 온다 — 화면이 서버가 준 사실만 본다', async () => {
    const run = await documents.enqueue('src_01')
    await draft({ runId: run.id, acknowledged: true })

    const res = await app.request('/api/sources/src_01/document')
    expect(((await res.json()) as { degradedDraft: boolean }).degradedDraft).toBe(true)
  })

  it('요청하지 않았으면 GET이 false를 준다', async () => {
    await documents.enqueue('src_01')
    const res = await app.request('/api/sources/src_01/document')
    expect(((await res.json()) as { degradedDraft: boolean }).degradedDraft).toBe(false)
  })

  it('⛔ 초안을 확정하려 하면 409와 이유가 온다', async () => {
    const run = await documents.enqueue('src_01')
    await draft({ runId: run.id, acknowledged: true })

    const res = await app.request('/api/sources/src_01/document/current', {
      method: 'POST',
      body: JSON.stringify({ runId: run.id }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; rule: string }
    expect(body.rule).toBe('degraded-draft-cannot-be-current')
    expect(body.error).toContain('초안')
  })
})
