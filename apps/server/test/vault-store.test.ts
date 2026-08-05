import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WriteConflictError } from '../src/vault/document.ts'
import { VAULT_DIRS, VaultStore } from '../src/vault/store.ts'

let root: string
let vault: VaultStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-vault-'))
  vault = new VaultStore(root)
  await vault.init()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('init', () => {
  it('vault 디렉토리 구조를 만든다', async () => {
    for (const d of VAULT_DIRS) {
      expect(await vault.listMarkdown(d)).toEqual([])
    }
  })

  it('두 번 호출해도 안전하다', async () => {
    await expect(vault.init()).resolves.not.toThrow()
  })
})

describe('read / write round-trip', () => {
  it('쓴 것을 그대로 읽는다', async () => {
    await vault.write('notes/a.md', {
      frontmatter: { id: 'n1', title: '회의' },
      body: '# 본문\n',
    })
    const r = await vault.read('notes/a.md')
    expect(r?.frontmatter).toEqual({ id: 'n1', title: '회의' })
    expect(r?.body).toBe('# 본문\n')
  })

  it('없는 파일은 null을 돌려준다', async () => {
    expect(await vault.read('notes/ghost.md')).toBeNull()
  })

  it('중간 디렉토리를 자동으로 만든다', async () => {
    await vault.write('sources/src_01/source.md', {
      frontmatter: { id: 'src_01' },
      body: '',
    })
    expect(await vault.read('sources/src_01/source.md')).not.toBeNull()
  })

  it('hash를 함께 돌려준다', async () => {
    const w = await vault.write('notes/a.md', { frontmatter: {}, body: 'x' })
    const r = await vault.read('notes/a.md')
    expect(r?.hash).toBe(w.hash)
  })
})

describe('⛔ 충돌 시 사람 편집을 덮지 않는다', () => {
  it('baseHash가 일치하면 정상적으로 쓴다', async () => {
    await vault.write('notes/a.md', { frontmatter: { v: 1 }, body: '원본\n' })
    const r = await vault.read('notes/a.md')
    await expect(
      vault.write(
        'notes/a.md',
        { frontmatter: { v: 2 }, body: '수정\n' },
        { baseHash: r!.hash }
      )
    ).resolves.toBeDefined()
    expect((await vault.read('notes/a.md'))?.frontmatter).toEqual({ v: 2 })
  })

  it('읽은 뒤 외부에서 고쳐졌으면 던진다', async () => {
    await vault.write('notes/a.md', { frontmatter: { v: 1 }, body: '원본\n' })
    const r = await vault.read('notes/a.md')

    // 사용자가 Obsidian으로 직접 고쳤다
    await writeFile(
      path.join(root, 'notes/a.md'),
      '---\nv: 1\n---\n사람이 손으로 쓴 내용\n',
      'utf8'
    )

    await expect(
      vault.write(
        'notes/a.md',
        { frontmatter: { v: 2 }, body: '앱이 쓰려던 내용\n' },
        { baseHash: r!.hash }
      )
    ).rejects.toThrow(WriteConflictError)
  })

  it('충돌해도 디스크의 사람 편집은 그대로 남는다', async () => {
    await vault.write('notes/a.md', { frontmatter: { v: 1 }, body: '원본\n' })
    const r = await vault.read('notes/a.md')
    const human = '---\nv: 1\n---\n사람이 손으로 쓴 내용\n'
    await writeFile(path.join(root, 'notes/a.md'), human, 'utf8')

    await vault
      .write(
        'notes/a.md',
        { frontmatter: { v: 2 }, body: '앱이 쓰려던 내용\n' },
        { baseHash: r!.hash }
      )
      .catch(() => {})

    // 사람 편집이 살아 있어야 한다
    expect(await readFile(path.join(root, 'notes/a.md'), 'utf8')).toBe(human)
  })

  it('앱이 쓰려던 내용을 .conflict 파일로 남긴다 — 나중에 병합할 수 있어야 한다', async () => {
    await vault.write('notes/a.md', { frontmatter: { v: 1 }, body: '원본\n' })
    const r = await vault.read('notes/a.md')
    await writeFile(path.join(root, 'notes/a.md'), '사람 편집\n', 'utf8')

    await vault
      .write(
        'notes/a.md',
        { frontmatter: { v: 2 }, body: '앱이 쓰려던 내용\n' },
        { baseHash: r!.hash }
      )
      .catch(() => {})

    const conflict = await readFile(
      path.join(root, 'notes/a.md.conflict'),
      'utf8'
    )
    expect(conflict).toContain('앱이 쓰려던 내용')
  })

  it('충돌이 반복되면 번호를 붙여 여러 개를 남긴다', async () => {
    await vault.write('notes/a.md', { frontmatter: {}, body: '원본\n' })
    const r = await vault.read('notes/a.md')
    await writeFile(path.join(root, 'notes/a.md'), '사람1\n', 'utf8')

    for (const attempt of ['시도1', '시도2']) {
      await vault
        .write('notes/a.md', { frontmatter: {}, body: attempt }, { baseHash: r!.hash })
        .catch(() => {})
    }
    expect(await readFile(path.join(root, 'notes/a.md.conflict'), 'utf8')).toContain(
      '시도1'
    )
    expect(
      await readFile(path.join(root, 'notes/a.md.conflict.1'), 'utf8')
    ).toContain('시도2')
  })

  it('baseHash 없이 쓰면 무조건 덮는다 — 앱이 처음 만드는 파일 전용', async () => {
    await writeFile(path.join(root, 'notes/a.md'), '기존\n', 'utf8')
    await vault.write('notes/a.md', { frontmatter: {}, body: '덮어씀\n' })
    expect((await vault.read('notes/a.md'))?.body).toBe('덮어씀\n')
  })

  it('파일이 삭제됐으면 충돌이 아니다 — 새로 만든다', async () => {
    await vault.write('notes/a.md', { frontmatter: {}, body: '원본\n' })
    const r = await vault.read('notes/a.md')
    await rm(path.join(root, 'notes/a.md'))
    await expect(
      vault.write('notes/a.md', { frontmatter: {}, body: '재생성\n' }, { baseHash: r!.hash })
    ).resolves.toBeDefined()
  })
})

describe('원자적 쓰기', () => {
  it('쓰기 후 임시 파일이 남지 않는다', async () => {
    await vault.write('notes/a.md', { frontmatter: {}, body: 'x' })
    const all = await vault.listMarkdown()
    expect(all.some((p) => p.includes('.tmp'))).toBe(false)
  })

  it('동시에 여러 번 써도 파일이 깨지지 않는다', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        vault.write('notes/race.md', {
          frontmatter: { n: i },
          body: `본문 ${i}\n`,
        })
      )
    )
    const r = await vault.read('notes/race.md')
    // 어느 쓰기가 이겼든 내용은 온전해야 한다 — 섞이거나 잘리면 안 된다
    expect(r).not.toBeNull()
    expect(typeof r!.frontmatter.n).toBe('number')
    expect(r!.body).toMatch(/^본문 \d+\n$/)
  })
})

describe('경로 탈출 방지', () => {
  it('vault 밖으로 쓰려는 시도를 막는다', async () => {
    await expect(
      vault.write('../escape.md', { frontmatter: {}, body: 'x' })
    ).rejects.toThrow(/vault 밖/)
  })

  it('중첩된 ../ 도 막는다', async () => {
    await expect(vault.read('notes/../../escape.md')).rejects.toThrow(/vault 밖/)
  })

  it('절대 경로를 막는다', async () => {
    await expect(
      vault.write('/etc/passwd', { frontmatter: {}, body: 'x' })
    ).rejects.toThrow(/vault 밖/)
  })
})

describe('listMarkdown — 파생 인덱스 재구축용', () => {
  it('중첩 디렉토리까지 훑는다', async () => {
    await vault.write('sources/a/source.md', { frontmatter: {}, body: '' })
    await vault.write('notes/b.md', { frontmatter: {}, body: '' })
    expect(await vault.listMarkdown()).toEqual(['notes/b.md', 'sources/a/source.md'])
  })

  it('.md 가 아닌 파일은 무시한다', async () => {
    await writeFile(path.join(root, 'assets/audio.webm'), 'x', 'utf8')
    await vault.write('notes/a.md', { frontmatter: {}, body: '' })
    expect(await vault.listMarkdown()).toEqual(['notes/a.md'])
  })

  it('디렉토리를 지정해 좁힐 수 있다', async () => {
    await vault.write('notes/a.md', { frontmatter: {}, body: '' })
    await vault.write('tasks/b.md', { frontmatter: {}, body: '' })
    expect(await vault.listMarkdown('tasks')).toEqual(['tasks/b.md'])
  })
})
