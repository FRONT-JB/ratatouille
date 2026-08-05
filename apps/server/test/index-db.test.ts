import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VaultIndex } from '../src/index-db/indexer.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let vault: VaultStore
let index: VaultIndex

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-idx-'))
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  index = new VaultIndex(path.join(root, 'index.db'))
})

afterEach(async () => {
  index.close()
  await rm(root, { recursive: true, force: true })
})

async function seed() {
  await vault.write('sources/src_01.md', {
    frontmatter: {
      id: 'src_01',
      type: 'audio',
      status: 'ready',
      captured_at: '2026-08-06T10:00:00+09:00',
      project_id: 'proj_a',
      title: '결제 모듈 회의',
    },
    body: '# 회의\n\n결제 모듈 오픈을 3월 16일로 연기했다.\n',
  })
  await vault.write('decisions/dec_01.md', {
    frontmatter: {
      id: 'dec_01',
      status: 'active',
      source_id: 'src_01',
      project_id: 'proj_a',
      title: '오픈 연기',
    },
    body: '오픈일을 3월 2일에서 3월 16일로 연기한다.\n',
  })
  await vault.write('tasks/task_01.md', {
    frontmatter: {
      id: 'task_01',
      status: 'open',
      source_id: 'src_01',
      title: 'PG 계약서 검토',
    },
    body: '금요일까지 계약서를 검토한다.\n',
  })
}

describe('⛔ 인덱스를 지워도 vault에서 완전히 복원된다', () => {
  it('rebuild만으로 빈 DB가 완전한 인덱스가 된다', async () => {
    await seed()
    const r = await index.rebuild(vault)
    expect(r.indexed).toBe(3)
    expect(index.count()).toBe(3)
  })

  it('DB 파일을 지우고 새로 만들어도 같은 결과가 나온다', async () => {
    await seed()
    await index.rebuild(vault)
    const before = {
      count: index.count(),
      src: index.byId('src_01'),
      backlinks: index.backlinks('src_01'),
      search: index.search('결제').map((h) => h.id),
    }

    index.close()
    await rm(path.join(root, 'index.db'), { force: true })
    index = new VaultIndex(path.join(root, 'index.db'))
    expect(index.count()).toBe(0)

    await index.rebuild(vault)
    expect(index.count()).toBe(before.count)
    expect(index.byId('src_01')).toEqual(before.src)
    expect(index.backlinks('src_01')).toEqual(before.backlinks)
    expect(index.search('결제').map((h) => h.id)).toEqual(before.search)
  })

  it('rebuild를 두 번 해도 중복되지 않는다 — 멱등', async () => {
    await seed()
    await index.rebuild(vault)
    await index.rebuild(vault)
    expect(index.count()).toBe(3)
  })

  it('vault에서 파일이 사라지면 rebuild 후 인덱스에서도 사라진다', async () => {
    await seed()
    await index.rebuild(vault)
    await rm(path.join(root, 'vault/tasks/task_01.md'))
    await index.rebuild(vault)
    expect(index.count()).toBe(2)
    expect(index.byId('task_01')).toBeNull()
  })
})

describe('id 없는 파일은 색인하지 않는다', () => {
  it('사용자가 손으로 만든 메모는 건너뛴다', async () => {
    await seed()
    await writeFile(
      path.join(root, 'vault/notes/내 메모.md'),
      '# 그냥 메모\n\nid가 없다.\n',
      'utf8'
    )
    const r = await index.rebuild(vault)
    expect(r.indexed).toBe(3)
    expect(r.skipped).toBe(1)
  })
})

describe('앱이 모르는 필드까지 보관한다', () => {
  it('frontmatter 전체가 복원된다', async () => {
    await vault.write('notes/n1.md', {
      frontmatter: { id: 'n1', obsidian_cssclass: 'wide', 사용자_메모: '중요' },
      body: '본문',
    })
    await index.rebuild(vault)
    const doc = index.byId('n1')
    expect(doc?.obsidian_cssclass).toBe('wide')
    expect(doc?.['사용자_메모']).toBe('중요')
  })
})

describe('역관계는 파생한다 — 양방향으로 적지 않는다', () => {
  it('source_id를 가진 문서들이 backlink로 잡힌다', async () => {
    await seed()
    await index.rebuild(vault)
    const back = index.backlinks('src_01', 'source_id').map((b) => b.from_id)
    expect(back.sort()).toEqual(['dec_01', 'task_01'])
  })

  it('project_id도 역관계로 조회된다', async () => {
    await seed()
    await index.rebuild(vault)
    const back = index.backlinks('proj_a', 'project_id').map((b) => b.from_id)
    expect(back.sort()).toEqual(['dec_01', 'src_01'])
  })

  it('relation 없이 조회하면 전부 나온다', async () => {
    await seed()
    await index.rebuild(vault)
    expect(index.backlinks('src_01').length).toBe(2)
  })

  it('배열 필드도 링크로 푼다', async () => {
    await vault.write('decisions/d2.md', {
      frontmatter: { id: 'd2', supersedes: ['d0', 'd1'] },
      body: '',
    })
    await index.rebuild(vault)
    expect(index.backlinks('d0', 'supersedes')[0]?.from_id).toBe('d2')
    expect(index.backlinks('d1', 'supersedes')[0]?.from_id).toBe('d2')
  })
})

describe('한국어 전문 검색', () => {
  beforeEach(async () => {
    await seed()
    await index.rebuild(vault)
  })

  it('본문에서 한국어를 찾는다', () => {
    expect(index.search('계약서').map((h) => h.id)).toContain('task_01')
  })

  it('공백이 낀 구도 찾는다 — 구 질의로 감싸기 때문', () => {
    // 그대로 MATCH에 넘기면 '결제' AND '모듈' 두 2글자 토큰이 되어 실패한다.
    // trigram은 3글자 미만을 매칭하지 못한다.
    expect(index.search('결제 모듈').length).toBeGreaterThan(0)
  })

  it('제목에서도 찾는다', () => {
    expect(index.search('오픈 연기').map((h) => h.id)).toContain('dec_01')
  })

  it('단어 중간부터도 찾는다 — 부분 문자열', () => {
    expect(index.search('약서를').map((h) => h.id)).toContain('task_01')
  })

  it('3글자 미만 질의는 빈 결과 — trigram의 한계를 숨기지 않는다', () => {
    expect(index.search('결제')).toEqual([])
    expect(index.search('가')).toEqual([])
  })

  it('없는 말은 결과가 없다', () => {
    expect(index.search('존재하지않는단어xyz')).toEqual([])
  })

  it('빈 질의는 빈 결과다', () => {
    expect(index.search('   ')).toEqual([])
  })

  it('큰따옴표가 든 질의가 문법을 깨뜨리지 않는다', () => {
    expect(() => index.search('그는 "확정"이라고 말했다')).not.toThrow()
  })

  it('snippet에 강조 표시가 들어간다', () => {
    const hit = index.search('계약서')[0]
    expect(hit?.snippet).toContain('[')
  })
})

describe('kind 분류', () => {
  it('디렉토리 이름을 kind로 쓴다', async () => {
    await seed()
    await index.rebuild(vault)
    expect(index.byKind('decisions').map((d) => d.id)).toEqual(['dec_01'])
    expect(index.byKind('tasks').map((d) => d.id)).toEqual(['task_01'])
    expect(index.byKind('sources').map((d) => d.id)).toEqual(['src_01'])
  })
})

describe('reindexOne — watcher용 증분 갱신', () => {
  it('한 파일만 다시 색인한다', async () => {
    await seed()
    await index.rebuild(vault)
    const r = await vault.read('tasks/task_01.md')
    await vault.write(
      'tasks/task_01.md',
      { frontmatter: { ...r!.frontmatter, status: 'done' }, body: r!.body },
      { baseHash: r!.hash }
    )
    await index.reindexOne(vault, 'tasks/task_01.md')
    expect(index.byId('task_01')?.status).toBe('done')
    expect(index.count()).toBe(3)
  })

  it('삭제된 파일은 인덱스에서 뺀다', async () => {
    await seed()
    await index.rebuild(vault)
    await rm(path.join(root, 'vault/tasks/task_01.md'))
    expect(await index.reindexOne(vault, 'tasks/task_01.md')).toBe(false)
    expect(index.byId('task_01')).toBeNull()
    expect(index.count()).toBe(2)
  })

  it('증분 갱신 결과가 전체 rebuild와 같다 — 갈라지지 않는다', async () => {
    await seed()
    await index.rebuild(vault)
    const r = await vault.read('decisions/dec_01.md')
    await vault.write(
      'decisions/dec_01.md',
      { frontmatter: { ...r!.frontmatter, status: 'superseded' }, body: r!.body },
      { baseHash: r!.hash }
    )
    await index.reindexOne(vault, 'decisions/dec_01.md')
    const incremental = index.byId('dec_01')

    await index.rebuild(vault)
    expect(index.byId('dec_01')).toEqual(incremental)
  })
})

describe('drift — 외부 편집 감지', () => {
  it('깨끗하면 아무것도 보고하지 않는다', async () => {
    await seed()
    await index.rebuild(vault)
    expect(await index.drift(vault)).toEqual({
      missing: [],
      stale: [],
      orphaned: [],
    })
  })

  it('외부에서 편집한 파일을 stale로 잡는다', async () => {
    await seed()
    await index.rebuild(vault)
    // 사용자가 Obsidian으로 직접 고쳤다
    await writeFile(
      path.join(root, 'vault/tasks/task_01.md'),
      '---\nid: task_01\nstatus: done\n---\n사람이 고침\n',
      'utf8'
    )
    const d = await index.drift(vault)
    expect(d.stale).toEqual(['tasks/task_01.md'])
  })

  it('새로 생긴 파일을 missing으로 잡는다', async () => {
    await seed()
    await index.rebuild(vault)
    await vault.write('notes/new.md', { frontmatter: { id: 'n_new' }, body: 'x' })
    const d = await index.drift(vault)
    expect(d.missing).toEqual(['notes/new.md'])
  })

  it('id 없는 새 파일은 missing으로 보지 않는다', async () => {
    await seed()
    await index.rebuild(vault)
    await writeFile(path.join(root, 'vault/notes/memo.md'), '# 메모\n', 'utf8')
    expect((await index.drift(vault)).missing).toEqual([])
  })

  it('사라진 파일을 orphaned로 잡는다', async () => {
    await seed()
    await index.rebuild(vault)
    await rm(path.join(root, 'vault/tasks/task_01.md'))
    expect((await index.drift(vault)).orphaned).toEqual(['tasks/task_01.md'])
  })
})

describe('스키마', () => {
  it('버전을 기록한다', () => {
    expect(index.schemaVersion).toBe(1)
  })
})
