/**
 * vault → SQLite 파생 인덱스.
 *
 * technical-foundation.md 9절: SQLite는 **재생성 가능한 파생 데이터**다.
 * 이 파일의 유일한 계약은 "인덱스를 지워도 vault만으로 완전히 복원된다"이다.
 *
 * 그래서 여기에는 vault에 없는 정보를 만들지 않는다. 전부 파일에서 읽어온다.
 */

import Database from 'better-sqlite3'
import { parseDocument } from '../vault/document.ts'
import { contentHash } from '../vault/document.ts'
import type { VaultStore } from '../vault/store.ts'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts'

type IndexInput = {
  path: string
  frontmatter: Record<string, unknown>
  body: string
  hash: string
}

export type SearchHit = {
  id: string
  path: string
  kind: string
  title: string | null
  snippet: string
}

/** frontmatter에서 링크로 해석할 필드. 한 방향만 원본으로 둔다. */
const LINK_FIELDS = [
  'project_id',
  'source_id',
  'transcription_id',
  'transcript_revision_id',
  'decision_id',
  'supersedes',
] as const

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export class VaultIndex {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.exec(SCHEMA_SQL)
    this.db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION))
  }

  close(): void {
    this.db.close()
  }

  get schemaVersion(): number {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined
    return row ? Number(row.value) : 0
  }

  /**
   * vault 전체를 다시 읽어 인덱스를 재구축한다.
   *
   * **이 함수만으로 빈 DB가 완전한 인덱스가 되어야 한다.** 증분 갱신에
   * 의존하는 정보가 하나라도 있으면 계약 위반이다.
   */
  async rebuild(vault: VaultStore): Promise<{ indexed: number; skipped: number }> {
    const paths = await vault.listMarkdown()
    let indexed = 0
    let skipped = 0

    // 파일 읽기는 트랜잭션 밖에서 한다 — better-sqlite3 트랜잭션은 동기다
    const rows: IndexInput[] = []
    for (const p of paths) {
      const r = await vault.read(p)
      if (!r) continue
      // content hash는 read()가 준 것을 그대로 쓴다.
      // 파싱 후 재직렬화하면 원본과 달라질 수 있다.
      rows.push({ path: p, frontmatter: r.frontmatter, body: r.body, hash: r.hash })
    }

    this.db.transaction(() => {
      this.db.exec(
        'DELETE FROM documents; DELETE FROM links; DELETE FROM documents_fts;'
      )
      for (const row of rows) {
        if (this.insertOne(row)) indexed++
        else skipped++
      }
    })()

    return { indexed, skipped }
  }

  private insertOne(input: IndexInput): boolean {
    const { path, body, hash, frontmatter: fm } = input
    const fmJson = JSON.stringify(fm)

    // id가 없는 파일은 색인하지 않는다. immutable ID가 identity이므로
    // ID 없는 파일은 아직 앱이 관리하는 문서가 아니다 (사용자가 손으로 만든 메모 등).
    const id = str(fm.id)
    if (!id) return false

    const kind = path.split('/')[0] ?? 'unknown'

    this.db
      .prepare(
        `INSERT OR REPLACE INTO documents
         (id, path, kind, title, status, project_id, created_at, updated_at, content_hash, frontmatter)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        path,
        kind,
        str(fm.title),
        str(fm.status),
        str(fm.project_id),
        str(fm.created_at) ?? str(fm.captured_at),
        str(fm.updated_at),
        hash,
        fmJson
      )

    // 역관계는 파생한다 — frontmatter에 양방향으로 적지 않는다
    const linkStmt = this.db.prepare(
      'INSERT OR IGNORE INTO links (from_id, to_id, relation) VALUES (?, ?, ?)'
    )
    for (const field of LINK_FIELDS) {
      const v = fm[field]
      if (typeof v === 'string' && v) linkStmt.run(id, v, field)
      else if (Array.isArray(v)) {
        for (const item of v) if (typeof item === 'string' && item) linkStmt.run(id, item, field)
      }
    }

    this.db
      .prepare('INSERT INTO documents_fts (id, title, body) VALUES (?, ?, ?)')
      .run(id, str(fm.title) ?? '', body)

    return true
  }

  /** 한 파일만 다시 색인한다. watcher가 쓴다. */
  async reindexOne(vault: VaultStore, path: string): Promise<boolean> {
    const r = await vault.read(path)
    if (!r) {
      this.remove(path)
      return false
    }
    const input: IndexInput = {
      path,
      frontmatter: r.frontmatter,
      body: r.body,
      hash: r.hash,
    }
    return this.db.transaction(() => {
      this.removeByPath(path)
      return this.insertOne(input)
    })()
  }

  private removeByPath(path: string): void {
    const row = this.db
      .prepare('SELECT id FROM documents WHERE path = ?')
      .get(path) as { id: string } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(row.id)
    this.db.prepare('DELETE FROM links WHERE from_id = ?').run(row.id)
    this.db.prepare('DELETE FROM documents_fts WHERE id = ?').run(row.id)
  }

  remove(path: string): void {
    this.db.transaction(() => this.removeByPath(path))()
  }

  count(): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }
    ).n
  }

  byId(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | { frontmatter: string; path: string; kind: string }
      | undefined
    if (!row) return null
    return { ...JSON.parse(row.frontmatter), _path: row.path, _kind: row.kind }
  }

  byKind(kind: string): Array<{ id: string; path: string; title: string | null }> {
    return this.db
      .prepare('SELECT id, path, title FROM documents WHERE kind = ? ORDER BY path')
      .all(kind) as Array<{ id: string; path: string; title: string | null }>
  }

  /** 역관계 조회 — 이 문서를 가리키는 것들 */
  backlinks(toId: string, relation?: string): Array<{ from_id: string; relation: string }> {
    return relation
      ? (this.db
          .prepare('SELECT from_id, relation FROM links WHERE to_id = ? AND relation = ?')
          .all(toId, relation) as Array<{ from_id: string; relation: string }>)
      : (this.db
          .prepare('SELECT from_id, relation FROM links WHERE to_id = ?')
          .all(toId) as Array<{ from_id: string; relation: string }>)
  }

  /**
   * 한국어 전문 검색.
   *
   * ⚠️ trigram tokenizer는 **3글자 미만 토큰을 매칭하지 못한다.**
   *    `결제 모듈`을 그대로 MATCH에 넘기면 FTS5가 `결제` AND `모듈` 두 토큰으로
   *    쪼개는데, 둘 다 2글자라 아무것도 안 걸린다. 한국어는 2글자 단어가 흔해서
   *    이대로 두면 검색이 사실상 동작하지 않는다.
   *
   *    그래서 질의 전체를 **구(phrase)로 감싸** 부분 문자열로 찾는다.
   *    AND/OR 연산자는 포기하지만, 개인 회의록 검색에는 부분 문자열이 더 맞다.
   */
  search(query: string, limit = 20): SearchHit[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    // trigram은 3글자 이상이어야 한다
    if ([...trimmed].length < 3) return []
    // FTS5 구 문법: 큰따옴표로 감싸고 내부 따옴표는 두 번 써서 이스케이프
    query = `"${trimmed.replace(/"/g, '""')}"`
    return this.db
      .prepare(
        `SELECT d.id, d.path, d.kind, d.title,
                snippet(documents_fts, 2, '[', ']', '…', 12) AS snippet
         FROM documents_fts f
         JOIN documents d ON d.id = f.id
         WHERE documents_fts MATCH ?
         LIMIT ?`
      )
      .all(query, limit) as SearchHit[]
  }

  /** 인덱스가 vault와 어긋난 파일 목록. 주기 scan이 쓴다. */
  async drift(vault: VaultStore): Promise<{
    missing: string[]
    stale: string[]
    orphaned: string[]
  }> {
    const onDisk = await vault.listMarkdown()
    const indexed = this.db.prepare('SELECT path, content_hash FROM documents').all() as Array<{
      path: string
      content_hash: string
    }>
    const indexedByPath = new Map(indexed.map((r) => [r.path, r.content_hash]))

    const missing: string[] = []
    const stale: string[] = []
    for (const p of onDisk) {
      const known = indexedByPath.get(p)
      const current = await vault.currentHash(p)
      if (known === undefined) {
        // id 없는 파일은 애초에 색인 대상이 아니다
        const r = await vault.read(p)
        if (r && typeof r.frontmatter.id === 'string') missing.push(p)
        continue
      }
      if (current !== null && current !== known) stale.push(p)
    }

    const onDiskSet = new Set(onDisk)
    const orphaned = indexed.map((r) => r.path).filter((p) => !onDiskSet.has(p))

    return { missing, stale, orphaned }
  }
}

export { contentHash, parseDocument }
