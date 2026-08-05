import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VaultIndex } from '../src/index-db/indexer.ts'
import { VaultStore } from '../src/vault/store.ts'
import { VaultWatcher, isIndexable } from '../src/vault/watcher.ts'

let root: string
let vault: VaultStore
let index: VaultIndex
let watcher: VaultWatcher

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-watch-'))
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  index = new VaultIndex(path.join(root, 'index.db'))
  // scanIntervalMs를 짧게 준다. fs.watch 이벤트가 언제 올지는 보장되지 않으므로
  // (5초를 넘기는 것을 실측했다) 이 테스트들이 검증하는 것은 **수렴**이지
  // watch 이벤트의 도착이 아니다. 운영 기본값은 30초다.
  watcher = new VaultWatcher(vault, index, { debounceMs: 10, scanIntervalMs: 50 })
})

afterEach(async () => {
  await watcher.stop()
  index.close()
  await rm(root, { recursive: true, force: true })
})

async function seed() {
  await vault.write('tasks/task_01.md', {
    frontmatter: { id: 'task_01', status: 'open', title: 'PG 계약서 검토' },
    body: '금요일까지 계약서를 검토한다.\n',
  })
  await index.rebuild(vault)
}

/** 인덱스가 vault를 따라잡을 때까지 기다린다 (watch 또는 scan, 둘 중 먼저). */
async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`조건이 ${timeoutMs}ms 안에 참이 되지 않았다`)
}

describe('색인 대상 판별 — 원자적 쓰기의 중간 산물을 걸러낸다', () => {
  it('Markdown만 색인한다', () => {
    expect(isIndexable('tasks/t.md')).toBe(true)
    expect(isIndexable('assets/audio.webm')).toBe(false)
  })

  it('⛔ 임시 파일을 무시한다 — VaultStore가 같은 디렉토리에 만든다', () => {
    // store.write()는 `<파일>.<uuid>.tmp`를 만들고 rename한다.
    // 이걸 색인하면 쓰다 만 문서가 인덱스에 들어간다.
    expect(isIndexable('tasks/t.md.f7c1-9a2e.tmp')).toBe(false)
  })

  it('⛔ 충돌본을 색인하지 않는다 — 같은 id가 두 경로에 생긴다', () => {
    expect(isIndexable('tasks/t.md.conflict')).toBe(false)
    expect(isIndexable('tasks/t.md.conflict.1')).toBe(false)
  })

  it('숨김 파일과 에디터 스왑 파일을 무시한다', () => {
    expect(isIndexable('tasks/.DS_Store')).toBe(false)
    expect(isIndexable('.obsidian/workspace.md')).toBe(false)
    expect(isIndexable('tasks/.t.md.swp')).toBe(false)
  })
})

describe('외부 편집 감지 — 인덱스가 vault를 따라잡는다 (9절)', () => {
  it('사람이 고친 파일을 인덱스에 반영한다', async () => {
    await seed()
    watcher.start()

    // 사용자가 Obsidian으로 직접 고쳤다
    await writeFile(
      path.join(root, 'vault/tasks/task_01.md'),
      '---\nid: task_01\nstatus: done\ntitle: PG 계약서 검토\n---\n사람이 고침\n',
      'utf8'
    )

    await waitFor(() => index.byId('task_01')?.status === 'done')
  })

  it('새로 만든 파일을 색인한다', async () => {
    await seed()
    watcher.start()

    await writeFile(
      path.join(root, 'vault/notes/외부메모.md'),
      '---\nid: note_ext\n---\n밖에서 만들었다\n',
      'utf8'
    )

    await waitFor(() => index.byId('note_ext') !== null)
  })

  it('지운 파일을 인덱스에서 뺀다', async () => {
    await seed()
    watcher.start()

    await rm(path.join(root, 'vault/tasks/task_01.md'))

    await waitFor(() => index.byId('task_01') === null)
  })

  it('한글 파일명을 처리한다', async () => {
    // 이 환경(APFS)에서는 fs.watch도 readdir도 NFC를 준다 — 실측으로 확인했다.
    // 그래서 이 테스트는 정규화 로직을 검증하지 못하고, 한글 경로가 감시·색인을
    // 통과하는지만 본다. HFS+ 볼륨 검증은 남아 있다 (watcher.ts normalizeRel 주석).
    await seed()
    watcher.start()

    await writeFile(
      path.join(root, 'vault/notes/회의록.md'),
      '---\nid: note_ko\n---\n한글 이름\n',
      'utf8'
    )

    await waitFor(() => index.byId('note_ko') !== null)
    const doc = index.byId('note_ko')
    expect(doc?._path).toBe('notes/회의록.md'.normalize('NFC'))
  })
})

describe('변경 이벤트', () => {
  it('무엇이 어떻게 바뀌었는지 알려준다', async () => {
    await seed()
    const seen: Array<{ path: string; kind: string }> = []
    watcher.onChange((cs) => seen.push(...cs))
    watcher.start()

    await writeFile(
      path.join(root, 'vault/notes/n.md'),
      '---\nid: n1\n---\nx\n',
      'utf8'
    )
    await waitFor(() => seen.length > 0)

    expect(seen[0]).toMatchObject({ path: 'notes/n.md', kind: 'created' })
  })

  it('내용이 그대로면 이벤트를 내지 않는다 — 앱이 방금 쓴 파일에 되울리지 않는다', async () => {
    await seed()
    const seen: unknown[] = []
    watcher.onChange((cs) => seen.push(...cs))

    // 인덱스에 이미 같은 hash로 들어 있다
    await watcher.reindex('tasks/task_01.md')

    expect(seen).toEqual([])
  })

  it('임시 파일이 생겼다 사라져도 이벤트가 없다', async () => {
    await seed()
    const seen: unknown[] = []
    watcher.onChange((cs) => seen.push(...cs))
    watcher.start()

    const tmp = path.join(root, 'vault/tasks/task_01.md.abc.tmp')
    await writeFile(tmp, 'garbage', 'utf8')
    await rm(tmp)
    await new Promise((r) => setTimeout(r, 120))

    expect(seen).toEqual([])
    expect(index.count()).toBe(1)
  })
})

describe('주기 scan — fs.watch가 놓친 것을 잡는다', () => {
  // fs.watch는 신뢰할 수 없다. 네트워크 볼륨, 에디터의 파일 교체,
  // 이벤트 폭주 시 누락이 실제로 일어난다. 그래서 9절이 scan을 함께 요구한다.

  it('watcher가 꺼져 있는 동안 생긴 변경을 scan이 따라잡는다', async () => {
    await seed()
    // watcher.start()를 부르지 않는다 — 이벤트가 아예 오지 않는 상황
    await writeFile(
      path.join(root, 'vault/decisions/d.md'),
      '---\nid: dec_x\n---\n놓친 파일\n',
      'utf8'
    )
    expect(index.byId('dec_x')).toBeNull()

    const changes = await watcher.scanNow()

    expect(index.byId('dec_x')).not.toBeNull()
    expect(changes.map((c) => c.kind)).toEqual(['created'])
    expect(changes[0]?.origin).toBe('scan')
  })

  it('세 가지 어긋남을 한 번에 화해시킨다', async () => {
    await seed()
    await vault.write('notes/keep.md', { frontmatter: { id: 'k' }, body: 'a' })
    await index.rebuild(vault)

    await writeFile(
      path.join(root, 'vault/notes/new.md'),
      '---\nid: fresh\n---\n새로 생김\n',
      'utf8'
    )
    await writeFile(
      path.join(root, 'vault/notes/keep.md'),
      '---\nid: k\n---\n밖에서 고침\n',
      'utf8'
    )
    await rm(path.join(root, 'vault/tasks/task_01.md'))

    const kinds = (await watcher.scanNow()).map((c) => c.kind).sort()

    expect(kinds).toEqual(['created', 'deleted', 'updated'])
    expect(index.byId('fresh')).not.toBeNull()
    expect(index.byId('task_01')).toBeNull()
  })

  it('깨끗하면 아무 일도 하지 않는다', async () => {
    await seed()
    expect(await watcher.scanNow()).toEqual([])
  })

  it('⛔ 서버가 꺼져 있는 동안의 편집을 start 직후 반영한다', async () => {
    // 이벤트가 애초에 오지 않는 구간이다. start()가 즉시 scan하지 않으면
    // 사용자가 어젯밤 Obsidian으로 고친 내용이 영영 인덱스에 안 들어간다.
    await seed()
    await writeFile(
      path.join(root, 'vault/notes/밤사이편집.md'),
      '---\nid: night\n---\n서버가 꺼져 있을 때 만들었다\n',
      'utf8'
    )
    expect(index.byId('night')).toBeNull()

    watcher.start()

    await waitFor(() => index.byId('night') !== null)
  })

  it('scan을 두 번 돌려도 두 번째는 조용하다 — 수렴한다', async () => {
    await seed()
    await writeFile(
      path.join(root, 'vault/notes/n.md'),
      '---\nid: n2\n---\nx\n',
      'utf8'
    )
    expect((await watcher.scanNow()).length).toBe(1)
    expect(await watcher.scanNow()).toEqual([])
  })
})

describe('수명주기', () => {
  it('stop 후에는 반응하지 않는다', async () => {
    await seed()
    const seen: unknown[] = []
    watcher.onChange((cs) => seen.push(...cs))
    watcher.start()
    await watcher.stop()

    await writeFile(
      path.join(root, 'vault/notes/after-stop.md'),
      '---\nid: late\n---\nx\n',
      'utf8'
    )
    await new Promise((r) => setTimeout(r, 150))

    expect(seen).toEqual([])
  })

  it('start를 두 번 불러도 watcher가 하나만 뜬다', async () => {
    await seed()
    const seen: unknown[] = []
    watcher.onChange((cs) => seen.push(...cs))
    watcher.start()
    watcher.start()

    await writeFile(
      path.join(root, 'vault/notes/once.md'),
      '---\nid: once\n---\nx\n',
      'utf8'
    )
    await waitFor(() => seen.length > 0)
    await new Promise((r) => setTimeout(r, 120))

    // 두 번 걸렸다면 같은 변경이 두 번 보고된다
    expect(seen.length).toBe(1)
  })

  it('stop은 여러 번 불러도 안전하다', async () => {
    watcher.start()
    await watcher.stop()
    await expect(watcher.stop()).resolves.toBeUndefined()
  })
})
