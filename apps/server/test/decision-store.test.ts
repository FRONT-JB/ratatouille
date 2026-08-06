/**
 * 결정 사항 저장 — GOAL 6.10, technical-foundation 9절.
 *
 * ⛔ **vault가 원본이다.** 결정이 앱 안에만 있으면 앱을 지울 때 같이 사라진다.
 *    Obsidian으로 열어 읽을 수 있어야 한다.
 *
 * ⛔ **대체해도 이전 기록을 지우지 않는다.** 파일이 남고 상태만 바뀐다.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { RuleViolationError } from '@ratatouille/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DecisionStore, decisionPath } from '../src/decisions/store.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let vault: VaultStore
let store: DecisionStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-dec-'))
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  store = new DecisionStore(vault)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ENTRIES = [
  { id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' },
  { id: 'seg_9', timestamp: '00:04:20', quote: '한 주 더 미룹시다.' },
]

/** 확정된 회의에서 나온 결정 하나 */
async function put(id: string, over: Record<string, unknown> = {}) {
  return store.put(
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

describe('vault에 파일 하나로 산다', () => {
  it('decisions 디렉토리에 쓴다', async () => {
    await put('dec_01')
    expect(await vault.listMarkdown('decisions')).toEqual(['decisions/dec_01.md'])
  })

  /*
   * ⛔ 경로는 id에서 **파생**할 뿐 identity가 아니다(9절). 사람이 Obsidian에서
   *    파일을 옮겨도 frontmatter의 `decision_id`가 그 결정을 가리킨다.
   */
  it('id가 frontmatter에 있다 — 경로가 아니라 이것이 identity다', async () => {
    await put('dec_01')
    const doc = await vault.read(decisionPath('dec_01'))
    expect(doc?.frontmatter.decision_id).toBe('dec_01')
  })

  it('읽으면 같은 결정이 돌아온다', async () => {
    await put('dec_01', { who: '이한결', why: '고객사 일정 때문' })
    const back = await store.get('dec_01')
    expect(back).toMatchObject({
      id: 'dec_01',
      sourceId: 'src_01',
      runId: 'doc_src_01_1',
      what: '오픈을 3월 16일로 연기[seg_1].',
      who: '이한결',
      why: '고객사 일정 때문',
      evidence: ['seg_1'],
      state: 'active',
      supersedes: null,
    })
  })

  it('없는 결정은 null이다', async () => {
    expect(await store.get('dec_없음')).toBeNull()
  })

  it('⛔ 근거 마커가 Markdown 각주가 된다 — Obsidian에서 깨진 링크로 보이면 안 된다', async () => {
    await put('dec_01', { evidence: ['seg_1'] })
    const doc = await vault.read(decisionPath('dec_01'))
    expect(doc?.body).toContain('[^1]')
    expect(doc?.body).not.toContain('[seg_1]')
    // 각주 정의가 없으면 Obsidian에서 빈 링크가 된다. 결정 파일은 홀로 읽힌다
    expect(doc?.body).toContain('[^1]: `00:00:04` 3월 16일로 하죠.')
  })

  it('⛔ 정의를 만들 수 없는 근거는 마커를 지운다 — 없는 각주를 가리키지 않는다', async () => {
    await store.put(
      {
        id: 'dec_02',
        sourceId: 'src_01',
        runId: 'doc_src_01_1',
        what: '모르는 근거를 가리킨다[seg_99].',
        why: null,
        who: null,
        evidence: ['seg_99'],
        state: 'active',
        decidedAt: '2026-08-06T10:00:00.000Z',
        supersedes: null,
      },
      ENTRIES
    )
    const doc = await vault.read(decisionPath('dec_02'))
    expect(doc?.body).not.toContain('[^')
    expect(doc?.body).toContain('모르는 근거를 가리킨다.')
  })

  it('⛔ frontmatter의 what이 원형이다 — 본문은 각주로 렌더된 사본이다', async () => {
    await put('dec_01')
    const doc = await vault.read(decisionPath('dec_01'))
    // 근거 연결(`[seg_1]`)이 살아 있어야 다시 렌더할 수 있다
    expect(doc?.frontmatter.what).toBe('오픈을 3월 16일로 연기[seg_1].')
  })

  it('⛔ 사람이 쓴 frontmatter를 지우지 않는다', async () => {
    await put('dec_01')
    const doc = await vault.read(decisionPath('dec_01'))
    await vault.write(decisionPath('dec_01'), {
      frontmatter: { ...doc!.frontmatter, tags: ['중요'] },
      body: doc!.body,
    })

    await put('dec_01', { who: '이한결' })
    const after = await vault.read(decisionPath('dec_01'))
    expect(after?.frontmatter.tags).toEqual(['중요'])
    expect(after?.frontmatter.who).toBe('이한결')
  })
})

describe('⛔ 대체해도 이전 기록은 남는다', () => {
  it('이전 결정이 superseded가 되고 파일은 그대로 있다', async () => {
    await put('dec_01')
    await put('dec_02', { what: '3월 23일로 다시 연기[seg_9].', evidence: ['seg_9'] })

    await store.supersede('dec_01', 'dec_02')

    expect((await store.get('dec_01'))?.state).toBe('superseded')
    expect((await store.get('dec_01'))?.what).toContain('3월 16일')
    expect((await store.get('dec_02'))?.supersedes).toBe('dec_01')
  })

  it('⛔ 이전 결정에 역방향 링크를 적지 않는다 — 한 관계는 한 방향이다', async () => {
    await put('dec_01')
    await put('dec_02')
    await store.supersede('dec_01', 'dec_02')

    const doc = await vault.read(decisionPath('dec_01'))
    expect(Object.keys(doc!.frontmatter)).not.toContain('superseded_by')
  })

  it('지난 회의의 결정도 대체할 수 있다', async () => {
    await put('dec_old', { sourceId: 'src_old', runId: 'doc_src_old_1' })
    await put('dec_new', { sourceId: 'src_new' })
    await store.supersede('dec_old', 'dec_new')
    expect((await store.get('dec_old'))?.state).toBe('superseded')
  })

  it('이미 대체된 결정을 다시 대체하면 거절한다', async () => {
    await put('dec_01')
    await put('dec_02')
    await put('dec_03')
    await store.supersede('dec_01', 'dec_02')

    await expect(store.supersede('dec_01', 'dec_03')).rejects.toThrow(RuleViolationError)
  })

  it('없는 결정을 대체하려 하면 무엇이 없는지 말한다', async () => {
    await put('dec_01')
    await expect(store.supersede('dec_없음', 'dec_01')).rejects.toThrow(/dec_없음/)
  })
})

describe('뒤집는다', () => {
  it('결정을 뒤집으면 reversed가 되고 내용은 남는다', async () => {
    await put('dec_01')
    await store.reverse('dec_01')

    const back = await store.get('dec_01')
    expect(back?.state).toBe('reversed')
    expect(back?.what).toContain('3월 16일')
  })

  it('이미 뒤집힌 결정은 다시 뒤집지 않는다', async () => {
    await put('dec_01')
    await store.reverse('dec_01')
    await expect(store.reverse('dec_01')).rejects.toThrow(RuleViolationError)
  })
})

describe('사람이 결정자와 이유를 채운다', () => {
  /*
   * ⛔ 화자 분리를 접었으므로 모델은 「그렇게 하죠」의 주인을 모른다.
   *    작업의 담당자와 같은 규칙이다.
   */
  it('결정자를 지정한다', async () => {
    await put('dec_01')
    expect((await store.annotate('dec_01', { who: '이한결' })).who).toBe('이한결')
  })

  it('⛔ 빈 값은 null이다 — 「미입력」이라는 이름의 사람은 없다', async () => {
    await put('dec_01', { who: '이한결' })
    expect((await store.annotate('dec_01', { who: '  ' })).who).toBeNull()
  })

  it('이유를 채운다', async () => {
    await put('dec_01')
    const d = await store.annotate('dec_01', { why: '고객사 일정 때문' })
    expect(d.why).toBe('고객사 일정 때문')
  })

  it('한쪽만 줘도 다른 쪽이 지워지지 않는다', async () => {
    await put('dec_01', { who: '이한결' })
    expect((await store.annotate('dec_01', { why: '일정' })).who).toBe('이한결')
  })

  /*
   * ⛔ 대체·뒤집힌 결정의 내용을 고치지 않는다. 지나간 기록이 소리 없이
   *    흔들리면 "그때 무엇이 유효했나"를 다시 읽을 수 없다.
   */
  it('⛔ 대체된 결정에는 손대지 않는다', async () => {
    await put('dec_01')
    await put('dec_02')
    await store.supersede('dec_01', 'dec_02')
    await expect(store.annotate('dec_01', { who: '이한결' })).rejects.toThrow(
      RuleViolationError
    )
  })
})

describe('목록', () => {
  it('한 회의의 결정을 모은다', async () => {
    await put('dec_01')
    await put('dec_02')
    await put('dec_other', { sourceId: 'src_02' })

    expect((await store.listFor('src_01')).map((d) => d.id)).toEqual(['dec_01', 'dec_02'])
  })

  it('대체된 것도 목록에 남는다 — 지우지 않는다', async () => {
    await put('dec_01')
    await put('dec_02')
    await store.supersede('dec_01', 'dec_02')

    expect((await store.listFor('src_01')).map((d) => d.state)).toEqual([
      'superseded',
      'active',
    ])
  })

  it('결정이 없으면 빈 목록이다', async () => {
    expect(await store.listFor('src_01')).toEqual([])
  })
})
