/**
 * SQLite 파생 인덱스 스키마 — technical-foundation.md 9절.
 *
 * ⛔ **이것은 파생 데이터다. 정식 원본이 아니다.**
 *    Markdown 본문과 YAML frontmatter가 원본이고, 이 DB는 검색·필터를 위해
 *    거기서 다시 만들 수 있어야 한다. 삭제하고 재시작해도 vault만으로
 *    완전히 복원되어야 한다.
 *
 *    따라서 이 스키마에는 **여기에만 있는 정보를 두지 않는다.**
 *    사용자 편집·검수 판정·본문은 전부 vault 파일에 있다.
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- vault의 Markdown 파일 하나가 행 하나다.
-- immutable ID가 identity이고 path는 바뀔 수 있다 (9절 파일 계약).
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,          -- sources · notes · tasks · decisions · projects · inbox · archive
  title         TEXT,
  status        TEXT,
  project_id    TEXT,
  created_at    TEXT,
  updated_at    TEXT,
  -- 파일 전체 content hash. 재색인 시 변경 감지에 쓴다.
  content_hash  TEXT NOT NULL,
  -- 앱이 모르는 필드까지 통째로 보관한다. 인덱스를 지워도
  -- 원본은 vault에 있으므로 이건 편의용 캐시일 뿐이다.
  frontmatter   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_kind    ON documents(kind);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

-- 한 관계를 양방향 필드로 복제하지 않는다 (9절).
-- frontmatter에 적힌 한 방향만 원본으로 삼고, 역관계는 여기서 파생한다.
CREATE TABLE IF NOT EXISTS links (
  from_id  TEXT NOT NULL,
  to_id    TEXT NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id, relation);

-- 전문 검색. 한국어는 trigram이 unicode61보다 잘 맞는다.
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);
`

export type DocumentRow = {
  id: string
  path: string
  kind: string
  title: string | null
  status: string | null
  project_id: string | null
  created_at: string | null
  updated_at: string | null
  content_hash: string
  frontmatter: string
}
