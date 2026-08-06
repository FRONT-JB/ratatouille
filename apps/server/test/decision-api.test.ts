/**
 * 결정 사항 API — GOAL 6.10.
 *
 * ⛔ **모델이 채우지 못하는 것을 사람이 채우는 자리다.** 결정자는 화자 분리를
 *    접어서 모델이 모르고, 대체 관계는 지난 회의를 아는 사람만 안다.
 *    이 경로가 없으면 저장소가 부를 사람 없는 코드로 남는다.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { DecisionStore } from '../src/decisions/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let app: Hono
let decisions: DecisionStore

const ENTRIES = [{ id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' }]

async function put(id: string, over: Record<string, unknown> = {}) {
  await decisions.put(
    {
      id,
      sourceId: 'src_01',
      runId: 'doc_src_01_1',
      what: '오픈을 3월 16일로 연기[seg_1].',
      why: null,
      who: null,
      evidence: ['seg_1'],
      state: 'active',
      decidedAt: '2026-08-06T10:00:00.000Z',
      supersedes: null,
      ...over,
    },
    ENTRIES
  )
}

const json = (method: string, url: string, body?: unknown) =>
  app.request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-dec-api-'))
  const vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  decisions = new DecisionStore(vault)
  app = createApp({
    sources: new SourceRepository(path.join(root, 'blobs')),
    decisions,
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('목록', () => {
  it('한 회의의 결정을 낸다', async () => {
    await put('dec_01')
    const res = await json('GET', '/api/sources/src_01/decisions')
    const body = (await res.json()) as { decisions: { decisionId: string }[] }

    expect(res.status).toBe(200)
    expect(body.decisions.map((d) => d.decisionId)).toEqual(['dec_01'])
  })

  /*
   * ⛔ 상태 이름에 `decision`을 박는다. `status`만 두면 문서 상태(`current`)와
   *    같은 자리에 놓여, 화면이 다른 머신의 값을 비교하기 시작한다.
   */
  it('상태를 어느 머신의 것인지 밝혀서 낸다', async () => {
    await put('dec_01')
    const body = (await (
      await json('GET', '/api/sources/src_01/decisions')
    ).json()) as { decisions: { decisionState: string }[] }
    expect(body.decisions[0]?.decisionState).toBe('active')
  })

  it('결정이 없으면 빈 목록이다 — 오류가 아니다', async () => {
    const res = await json('GET', '/api/sources/src_없음/decisions')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ decisions: [] })
  })

  it('⛔ 대체된 결정도 함께 낸다 — 감추면 왜 바뀌었는지 볼 길이 없다', async () => {
    await put('dec_01')
    await put('dec_02')
    await decisions.supersede('dec_01', 'dec_02')

    const body = (await (
      await json('GET', '/api/sources/src_01/decisions')
    ).json()) as { decisions: { decisionState: string }[] }
    expect(body.decisions.map((d) => d.decisionState)).toEqual(['superseded', 'active'])
  })
})

describe('사람이 결정자와 이유를 채운다', () => {
  it('결정자를 지정한다', async () => {
    await put('dec_01')
    const res = await json('PATCH', '/api/sources/decisions/dec_01', { who: '이한결' })

    expect(res.status).toBe(200)
    expect((await res.json()) as { who: string }).toMatchObject({ who: '이한결' })
  })

  it('이유를 채운다', async () => {
    await put('dec_01')
    const res = await json('PATCH', '/api/sources/decisions/dec_01', {
      why: '고객사 일정 때문',
    })
    expect((await res.json()) as { why: string }).toMatchObject({ why: '고객사 일정 때문' })
  })

  it('빈 몸통은 400이다 — 아무 일도 안 일어난 것을 성공으로 두지 않는다', async () => {
    await put('dec_01')
    expect((await json('PATCH', '/api/sources/decisions/dec_01', {})).status).toBe(400)
  })

  it('없는 결정은 404다', async () => {
    const res = await json('PATCH', '/api/sources/decisions/dec_없음', { who: '이한결' })
    expect(res.status).toBe(404)
  })

  it('⛔ 대체된 결정을 고치려 하면 409와 이유가 나온다', async () => {
    await put('dec_01')
    await put('dec_02')
    await decisions.supersede('dec_01', 'dec_02')

    const res = await json('PATCH', '/api/sources/decisions/dec_01', { who: '이한결' })
    expect(res.status).toBe(409)
    expect((await res.json()) as { rule: string }).toMatchObject({
      rule: 'decision-not-active',
    })
  })
})

describe('대체한다', () => {
  it('새 결정이 이전 결정을 대체한다', async () => {
    await put('dec_01')
    await put('dec_02')

    const res = await json('POST', '/api/sources/decisions/dec_02/supersede', {
      previousId: 'dec_01',
    })
    expect(res.status).toBe(200)
    expect((await res.json()) as { supersedes: string }).toMatchObject({
      supersedes: 'dec_01',
    })
    expect((await decisions.get('dec_01'))?.state).toBe('superseded')
  })

  it('previousId가 없으면 400이다', async () => {
    await put('dec_01')
    expect((await json('POST', '/api/sources/decisions/dec_01/supersede', {})).status).toBe(
      400
    )
  })

  it('자기 자신을 대체하면 409다', async () => {
    await put('dec_01')
    const res = await json('POST', '/api/sources/decisions/dec_01/supersede', {
      previousId: 'dec_01',
    })
    expect(res.status).toBe(409)
    expect((await res.json()) as { rule: string }).toMatchObject({
      rule: 'decision-supersedes-itself',
    })
  })

  it('없는 결정을 대체하려 하면 404다', async () => {
    await put('dec_01')
    const res = await json('POST', '/api/sources/decisions/dec_01/supersede', {
      previousId: 'dec_없음',
    })
    expect(res.status).toBe(404)
  })
})

describe('뒤집는다', () => {
  it('결정을 뒤집으면 reversed가 된다', async () => {
    await put('dec_01')
    const res = await json('POST', '/api/sources/decisions/dec_01/reverse')

    expect(res.status).toBe(200)
    expect((await res.json()) as { decisionState: string }).toMatchObject({
      decisionState: 'reversed',
    })
  })

  it('이미 뒤집힌 결정을 다시 뒤집으면 409다', async () => {
    await put('dec_01')
    await json('POST', '/api/sources/decisions/dec_01/reverse')
    expect((await json('POST', '/api/sources/decisions/dec_01/reverse')).status).toBe(409)
  })
})

describe('⛔ 결정 저장소가 없으면 경로 자체가 없다', () => {
  it('vault 없는 구성에서는 404다', async () => {
    const bare = createApp({ sources: new SourceRepository(path.join(root, 'blobs2')) })
    expect((await bare.request('/api/sources/src_01/decisions')).status).toBe(404)
  })
})
