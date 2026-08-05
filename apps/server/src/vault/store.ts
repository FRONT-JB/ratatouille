/**
 * vault 파일 저장 — 원자적 쓰기와 충돌 보존.
 *
 * technical-foundation.md 9절 `파일 계약`:
 *   - 쓰기는 **원자적**으로 수행한다
 *   - 충돌 시 **사람 편집을 덮지 않는다**
 *   - **마지막 정상본과 충돌본으로 복구**할 수 있어야 한다
 *   - content hash와 optimistic concurrency를 사용한다
 *
 * 원자성 구현: 같은 디렉토리에 임시 파일을 쓰고 `rename`한다.
 * POSIX에서 같은 파일시스템 내 rename은 원자적이라, 쓰다 만 파일이
 * 보이는 일이 없다. 다른 디렉토리(예: /tmp)에 쓰면 파일시스템이 달라
 * rename이 copy로 떨어지고 원자성이 깨진다.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  type Frontmatter,
  WriteConflictError,
  contentHash,
  detectConflict,
  parseDocument,
  serializeDocument,
} from './document.ts'

/** technical-foundation.md 9절의 vault 디렉토리 구조 */
export const VAULT_DIRS = [
  'inbox',
  'sources',
  'notes',
  'tasks',
  'decisions',
  'projects',
  'assets',
  'archive',
] as const
export type VaultDir = (typeof VAULT_DIRS)[number]

export type ReadResult = {
  frontmatter: Frontmatter
  body: string
  /** 쓰기 때 되돌려줘야 하는 optimistic concurrency 토큰 */
  hash: string
}

export class VaultStore {
  constructor(readonly root: string) {}

  /** vault 디렉토리 구조를 만든다. 이미 있으면 그대로 둔다. */
  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    for (const d of VAULT_DIRS) {
      await fs.mkdir(path.join(this.root, d), { recursive: true })
    }
  }

  private resolve(relPath: string): string {
    const full = path.resolve(this.root, relPath)
    // vault 밖으로 쓰는 것을 막는다 — `../` 경로 탈출 방지
    const rootWithSep = path.resolve(this.root) + path.sep
    if (!full.startsWith(rootWithSep)) {
      throw new Error(`vault 밖의 경로에 접근할 수 없다: ${relPath}`)
    }
    return full
  }

  async read(relPath: string): Promise<ReadResult | null> {
    const full = this.resolve(relPath)
    let raw: string
    try {
      raw = await fs.readFile(full, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    const { frontmatter, body } = parseDocument(raw)
    return { frontmatter, body, hash: contentHash(raw) }
  }

  /** 디스크의 현재 hash. 파일이 없으면 null. */
  async currentHash(relPath: string): Promise<string | null> {
    const full = this.resolve(relPath)
    try {
      return contentHash(await fs.readFile(full, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /**
   * 원자적으로 쓴다.
   *
   * `baseHash`를 주면 optimistic concurrency를 건다. 읽은 뒤 파일이 바뀌었으면
   * **덮지 않고** 충돌본을 남긴 뒤 던진다. 사람 편집이 사라지지 않는다.
   *
   * `baseHash`가 없으면 무조건 덮어쓴다 — 앱이 처음 만드는 파일에만 쓴다.
   */
  async write(
    relPath: string,
    doc: { frontmatter: Frontmatter; body: string },
    opts: { baseHash?: string } = {}
  ): Promise<{ hash: string }> {
    const full = this.resolve(relPath)
    const next = serializeDocument(doc)

    if (opts.baseHash !== undefined) {
      const current = await this.currentHash(relPath)
      if (detectConflict({ baseHash: opts.baseHash, currentHash: current })) {
        // 충돌본을 남긴다 — 사용자가 나중에 병합할 수 있어야 한다
        await this.writeConflictCopy(relPath, next)
        throw new WriteConflictError(relPath, opts.baseHash, current!)
      }
    }

    await fs.mkdir(path.dirname(full), { recursive: true })
    // 같은 디렉토리에 임시 파일 → rename. 다른 FS로 나가면 원자성이 깨진다.
    const tmp = `${full}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tmp, next, 'utf8')
      await fs.rename(tmp, full)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw e
    }
    return { hash: contentHash(next) }
  }

  /**
   * 앱이 쓰려던 내용을 `.conflict` 파일로 남긴다.
   *
   * 디스크의 사람 편집은 **그대로 둔다.** 사용자가 두 버전을 보고 직접 병합한다.
   */
  private async writeConflictCopy(
    relPath: string,
    attempted: string
  ): Promise<string> {
    const full = this.resolve(relPath)
    const dir = path.dirname(full)
    const base = path.basename(full)
    let n = 1
    let target = path.join(dir, `${base}.conflict`)
    while (existsSync(target)) {
      target = path.join(dir, `${base}.conflict.${n++}`)
    }
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(target, attempted, 'utf8')
    return target
  }

  /** vault 안의 Markdown 파일 목록. 파생 인덱스 재구축에 쓴다. */
  async listMarkdown(dir?: VaultDir): Promise<string[]> {
    const base = dir ? path.join(this.root, dir) : this.root
    const out: string[] = []
    const walk = async (d: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(d, { withFileTypes: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
        throw e
      }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.name.endsWith('.md')) {
          out.push(path.relative(this.root, p))
        }
      }
    }
    await walk(base)
    return out.sort()
  }
}
