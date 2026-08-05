/**
 * Markdown + YAML frontmatter 문서 — technical-foundation.md 9절.
 *
 * **Markdown 본문과 YAML frontmatter가 정식 원본이다.** SQLite는 파생 인덱스다.
 *
 * ⛔ 가장 중요한 계약: **앱이 모르는 YAML 필드와 Markdown 본문을 보존한다.**
 *    사용자가 Obsidian 등 외부 편집기로 필드를 추가했을 때 앱이 그것을 지우면
 *    사람이 손으로 쓴 내용이 조용히 사라진다. 나중에 고치기 매우 어렵다.
 *
 *    보존을 구현하는 방식: frontmatter를 "알려진 필드 + 나머지"로 쪼개지 않고,
 *    **파싱한 객체 전체를 들고 다니면서 필요한 키만 수정**한다.
 *    모르는 키는 손대지 않으므로 자동으로 살아남는다.
 */

import { createHash } from 'node:crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export type Frontmatter = Record<string, unknown>

export type VaultDocument = {
  /** immutable ID가 identity다. 파일명·경로는 바뀔 수 있다 */
  id: string
  frontmatter: Frontmatter
  body: string
}

export class MalformedDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedDocumentError'
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * 파일 내용을 frontmatter와 본문으로 나눈다.
 *
 * frontmatter가 없으면 빈 객체로 취급한다 — 사용자가 손으로 만든
 * 순수 Markdown 파일도 vault에 들어올 수 있다.
 */
export function parseDocument(raw: string): {
  frontmatter: Frontmatter
  body: string
} {
  const m = FRONTMATTER_RE.exec(raw)
  if (!m) return { frontmatter: {}, body: raw }

  let parsed: unknown
  try {
    parsed = parseYaml(m[1]!)
  } catch (e) {
    throw new MalformedDocumentError(
      `frontmatter YAML을 읽을 수 없다: ${(e as Error).message}`
    )
  }

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body: raw.slice(m[0].length) }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MalformedDocumentError(
      'frontmatter는 YAML 매핑이어야 한다 (배열·스칼라 불가)'
    )
  }

  return { frontmatter: parsed as Frontmatter, body: raw.slice(m[0].length) }
}

/**
 * frontmatter와 본문을 파일 내용으로 되돌린다.
 *
 * frontmatter가 비어 있으면 `---` 블록 자체를 쓰지 않는다 —
 * 빈 블록을 남기면 round-trip이 원본과 달라진다.
 */
export function serializeDocument(doc: {
  frontmatter: Frontmatter
  body: string
}): string {
  const keys = Object.keys(doc.frontmatter)
  if (keys.length === 0) return doc.body

  const yaml = stringifyYaml(doc.frontmatter, {
    // 한국어가 많으므로 줄바꿈으로 접지 않는다 — diff가 지저분해진다
    lineWidth: 0,
  })
  return `---\n${yaml}---\n${doc.body}`
}

/**
 * 알려진 필드만 수정하고 나머지는 그대로 둔다.
 *
 * `undefined`를 주면 그 키를 **삭제**한다. 명시적 삭제와
 * "손대지 않음"을 구분하기 위해 키 자체를 넘기지 않는 쪽이 후자다.
 */
export function patchFrontmatter(
  existing: Frontmatter,
  patch: Record<string, unknown>
): Frontmatter {
  const out: Frontmatter = { ...existing }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k]
    else out[k] = v
  }
  return out
}

/**
 * 문서의 content hash. optimistic concurrency에 쓴다.
 *
 * 파일 전체 내용으로 계산한다 — frontmatter만이나 본문만으로 계산하면
 * 한쪽 변경을 놓친다.
 */
export function contentHash(raw: string): string {
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`
}

/**
 * 외부 편집을 덮어쓰려는 시도인지 판정한다.
 *
 * `technical-foundation.md` 9절: "쓰기는 원자적으로 수행하고 **충돌 시 사람 편집을
 * 덮지 않는다.**"
 *
 * 읽을 때의 hash와 쓰기 직전 디스크의 hash가 다르면, 그 사이에 누군가
 * (사용자 또는 다른 프로세스) 파일을 고친 것이다.
 */
export function detectConflict(input: {
  /** 앱이 이 문서를 읽었을 때의 hash */
  baseHash: string
  /** 쓰기 직전 디스크의 실제 hash. 파일이 없으면 null */
  currentHash: string | null
}): boolean {
  // 파일이 사라졌으면 충돌로 보지 않는다 — 새로 만든다
  if (input.currentHash === null) return false
  return input.baseHash !== input.currentHash
}

export class WriteConflictError extends Error {
  constructor(
    readonly path: string,
    readonly baseHash: string,
    readonly currentHash: string
  ) {
    super(
      `${path}가 읽은 뒤 외부에서 변경됐다. 사람 편집을 덮지 않는다. ` +
        `읽을 때 ${baseHash.slice(0, 16)}…, 지금 ${currentHash.slice(0, 16)}…`
    )
    this.name = 'WriteConflictError'
  }
}
