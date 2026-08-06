/**
 * 실행·평가 이력 저장소 — technical-foundation.md 11절.
 *
 *   "최종 Markdown은 현재 지식의 정식 원본이고
 *    run artifact는 품질 평가를 위한 역사 기록이다."
 *
 * 두 가지를 코드로 강제한다. 둘 다 주석으로만 두면 반드시 깨진다.
 *
 * 1. **복사 금지.** document run은 audio·transcript를 복사하지 않고 ID와 hash로
 *    참조한다. `input.json`은 **허용 키 목록**으로 막아서, transcript 본문이나
 *    audio를 넣으려는 시도가 저장 시점에 실패하게 한다.
 *
 * 2. **덮어쓰기 금지.** 역사 기록은 append-only다. 같은 내용 재기록은 통과시키고
 *    (재시도가 실패로 보이면 안 된다), 내용이 다르면 던진다.
 *
 * ⚠️ vault와 다른 루트다. `vault/sources/`는 사람이 읽는 Markdown이고
 *    `runs/sources/`는 재현용 이력이다. 섞으면 파생 인덱스가 이력까지 긁어간다.
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export class ArtifactImmutableError extends Error {
  constructor(readonly artifactPath: string) {
    super(
      `${artifactPath}: 이미 기록된 이력이다. run artifact는 불변이라 다른 내용으로 덮을 수 없다. 다시 실행했다면 새 run id로 남긴다.`
    )
    this.name = 'ArtifactImmutableError'
  }
}

export class InvalidRunInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRunInputError'
  }
}

/**
 * `input.json`에 허용하는 키.
 *
 * ⛔ 여기에 `segments`·`text`·`audio` 같은 **본문 키를 추가하지 않는다.**
 *    추가하는 순간 11절의 "복사하지 않는다"가 깨지고, transcript 사본이
 *    run 디렉토리마다 쌓여 원본이 어느 쪽인지 알 수 없게 된다.
 */
const INPUT_KEYS = new Set([
  'source_id',
  'source_hash',
  'transcription_id',
  'transcript_revision_id',
  'transcript_hash',
  'segment_count',
  'duration_seconds',
  'language',
  'speaker_labels',
])

/** 없으면 재현할 수 없는 참조 */
const REQUIRED_INPUT_KEYS = [
  'source_id',
  'source_hash',
  'transcription_id',
  'transcript_revision_id',
]

/** 11절이 "최소 다음을 남긴다"로 열거한 항목 */
const REQUIRED_RUN_KEYS = [
  'model_provider',
  'auth_type',
  'model',
  'runtime',
  'prompt_version',
  'skill_version',
  'schema_version',
  'rubric_version',
]

export type DocumentationRunRecord = {
  input: Record<string, unknown>
  run: Record<string, unknown>
  proposed: unknown | null
  reviewed: unknown | null
}

export function assertValidRunInput(input: Record<string, unknown>): void {
  const extra = Object.keys(input).filter((k) => !INPUT_KEYS.has(k))
  if (extra.length > 0) {
    throw new InvalidRunInputError(
      `input.json에 넣을 수 없는 필드: ${extra.join(', ')}. ` +
        `document run은 audio·transcript를 복사하지 않고 ID와 hash로만 참조한다 (11절).`
    )
  }
  const missing = REQUIRED_INPUT_KEYS.filter((k) => !isFilled(input[k]))
  if (missing.length > 0) {
    throw new InvalidRunInputError(
      `input.json에 필수 참조가 없다: ${missing.join(', ')}. 이 값이 없으면 실행을 재현할 수 없다.`
    )
  }
}

export function assertValidRunMetadata(meta: Record<string, unknown>): void {
  const missing = REQUIRED_RUN_KEYS.filter((k) => !isFilled(meta[k]))
  if (missing.length > 0) {
    throw new InvalidRunInputError(
      `run.json에 필수 항목이 없다: ${missing.join(', ')} (technical-foundation 11절)`
    )
  }
}

function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  return true
}

/**
 * 확정 회차 파일명.
 *
 * ⛔ 0으로 채운다. `10.json`이 `2.json`보다 앞에 오면 목록이 회차순이 아니게
 *    되고, "마지막 확정본"이 조용히 틀린 것을 가리킨다.
 */
function reviewedFile(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new InvalidRunInputError(
      `확정 회차는 1 이상의 정수다: ${seq}. 회차가 없으면 어느 확정본인지 알 수 없다.`
    )
  }
  return `${String(seq).padStart(3, '0')}.json`
}

function assertSafeId(id: string, label = 'id'): void {
  if (!id || /[/\\]/.test(id) || id === '.' || id === '..') {
    throw new InvalidRunInputError(`${label}에 경로 구분자를 쓸 수 없다: ${id}`)
  }
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export class RunArtifactStore {
  constructor(readonly root: string) {}

  /**
   * 저장소 안의 상대 경로를 절대 경로로.
   *
   * ⚠️ **읽기·쓰기에는 쓰지 않는다.** 그건 write-once 규칙을 지나가는 뒷문이
   *    된다(11절). 삭제가 통째로 옮길 디렉토리를 가리키는 용도다.
   */
  pathOf(relPath: string): string {
    return path.join(this.root, relPath)
  }

  // ── sources ────────────────────────────────────────────────────────────

  async putSource(sourceId: string, source: unknown): Promise<void> {
    assertSafeId(sourceId, 'source id')
    await this.writeOnce(
      path.join('sources', sourceId, 'source.json'),
      canonical(source)
    )
  }

  async putAudio(
    sourceId: string,
    filename: string,
    bytes: Uint8Array
  ): Promise<void> {
    assertSafeId(sourceId, 'source id')
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new InvalidRunInputError(`audio 파일명에 경로를 쓸 수 없다: ${filename}`)
    }
    await this.writeOnce(path.join('sources', sourceId, filename), bytes)
  }

  async readAudio(sourceId: string, filename: string): Promise<Buffer | null> {
    return this.readRaw(path.join('sources', sourceId, filename))
  }

  // ── transcriptions ─────────────────────────────────────────────────────

  async putRawTranscript(transcriptionId: string, raw: unknown): Promise<void> {
    assertSafeId(transcriptionId, 'transcription id')
    await this.writeOnce(
      path.join('transcriptions', transcriptionId, 'transcript.raw.json'),
      canonical(raw)
    )
  }

  async putTranscriptionRun(
    transcriptionId: string,
    meta: Record<string, unknown>
  ): Promise<void> {
    assertSafeId(transcriptionId, 'transcription id')
    await this.writeOnce(
      path.join('transcriptions', transcriptionId, 'run.json'),
      canonical(meta)
    )
  }

  async readRawTranscript(transcriptionId: string): Promise<unknown | null> {
    return this.readJson(
      path.join('transcriptions', transcriptionId, 'transcript.raw.json')
    )
  }

  // ── transcript revisions ───────────────────────────────────────────────

  async putReviewedTranscript(revisionId: string, reviewed: unknown): Promise<void> {
    assertSafeId(revisionId, 'revision id')
    await this.writeOnce(
      path.join('transcript-revisions', revisionId, 'transcript.reviewed.json'),
      canonical(reviewed)
    )
  }

  async readReviewedTranscript(revisionId: string): Promise<unknown | null> {
    return this.readJson(
      path.join('transcript-revisions', revisionId, 'transcript.reviewed.json')
    )
  }

  // ── documentation runs ─────────────────────────────────────────────────

  /**
   * document run을 연다. 입력 snapshot과 실행 메타데이터를 함께 남긴다.
   *
   * 검증을 **쓰기 전에** 한다 — 반쪽짜리 run 디렉토리를 만들지 않는다.
   */
  async putDocumentationRun(
    runId: string,
    args: { input: Record<string, unknown>; meta: Record<string, unknown> }
  ): Promise<{ runId: string }> {
    assertSafeId(runId, 'run id')
    assertValidRunInput(args.input)
    assertValidRunMetadata(args.meta)

    await this.writeOnce(
      path.join('documentation-runs', runId, 'input.json'),
      canonical(args.input)
    )
    await this.writeOnce(
      path.join('documentation-runs', runId, 'run.json'),
      canonical(args.meta)
    )
    return { runId }
  }

  /** 모델이 낸 제안. 사람이 고치기 전 원본이라 불변이다. */
  async putProposed(runId: string, proposed: unknown): Promise<void> {
    assertSafeId(runId, 'run id')
    await this.writeOnce(
      path.join('documentation-runs', runId, 'proposed.json'),
      canonical(proposed)
    )
  }

  /**
   * 사람의 검수 결과. **확정할 때마다 회차로 쌓는다.**
   *
   * ⚠️ 처음에는 `reviewed.json` 하나였다. "다시 실행하면 새 run id가 생기니
   *    한 run의 검수는 한 번"이라는 전제였는데, 확정을 되돌리는 길(`reopen`)이
   *    생기면서 깨졌다 — 같은 run을 고쳐 다시 확정하면 write-once에 걸려
   *    **확정 자체가 실패한다.**
   *
   * 회차는 부르는 쪽이 정한다. 자동 증가로 두면 같은 내용을 두 번 저장했을 때
   * 파일이 둘 생겨서, 재시도가 이력에 없던 확정을 만들어낸다.
   */
  async putReviewed(runId: string, seq: number, reviewed: unknown): Promise<void> {
    assertSafeId(runId, 'run id')
    await this.writeOnce(
      path.join('documentation-runs', runId, 'reviewed', reviewedFile(seq)),
      canonical(reviewed)
    )
  }

  /** 확정 회차 순. 비어 있으면 아직 확정되지 않았다 */
  async listReviewed(runId: string): Promise<unknown[]> {
    const dir = path.join('documentation-runs', runId, 'reviewed')
    let entries: string[]
    try {
      entries = await fs.readdir(path.join(this.root, dir))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    const out: unknown[] = []
    // 파일명이 0으로 채워져 있어 사전순이 곧 회차순이다
    for (const name of entries.filter((e) => e.endsWith('.json')).sort()) {
      out.push(await this.readJson(path.join(dir, name)))
    }
    return out
  }

  async readDocumentationRun(runId: string): Promise<DocumentationRunRecord | null> {
    const dir = path.join('documentation-runs', runId)
    const input = (await this.readJson(path.join(dir, 'input.json'))) as Record<
      string,
      unknown
    > | null
    if (!input) return null
    const run = ((await this.readJson(path.join(dir, 'run.json'))) ?? {}) as Record<
      string,
      unknown
    >
    return {
      input,
      run,
      proposed: await this.readJson(path.join(dir, 'proposed.json')),
      // 「지금의 검수 결과」는 마지막 확정본이다. 앞 회차는 `listReviewed`로 본다
      reviewed: (await this.listReviewed(runId)).at(-1) ?? null,
    }
  }

  /** run id 오름차순. id가 시간 정렬 가능한 형태(ULID 등)라는 전제다. */
  async listDocumentationRuns(filter: { sourceId?: string } = {}): Promise<string[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(path.join(this.root, 'documentation-runs'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    const ids = entries.filter((e) => !e.startsWith('.')).sort()
    if (!filter.sourceId) return ids

    const out: string[] = []
    for (const id of ids) {
      const input = (await this.readJson(
        path.join('documentation-runs', id, 'input.json')
      )) as { source_id?: string } | null
      if (input?.source_id === filter.sourceId) out.push(id)
    }
    return out
  }

  // ── 저수준 ─────────────────────────────────────────────────────────────

  /**
   * 한 번만 쓴다.
   *
   * 이미 있고 내용이 같으면 조용히 통과한다 — 네트워크 재시도나 프로세스
   * 재기동 후 같은 결과를 다시 기록하는 것은 정상이다.
   * 내용이 다르면 던진다 — 그건 이력을 고쳐 쓰려는 것이다.
   */
  private async writeOnce(relPath: string, data: string | Uint8Array): Promise<void> {
    const full = path.join(this.root, relPath)
    const incoming = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)

    const existing = await this.readRaw(relPath)
    if (existing) {
      if (sha256(existing) === sha256(incoming)) return
      throw new ArtifactImmutableError(relPath)
    }

    await fs.mkdir(path.dirname(full), { recursive: true })
    // vault와 같은 원자성 규칙: 같은 디렉토리에 쓰고 rename
    const tmp = `${full}.${process.pid}.${randomSuffix()}.tmp`
    try {
      await fs.writeFile(tmp, incoming)
      await fs.rename(tmp, full)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw e
    }
  }

  private async readRaw(relPath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(this.root, relPath))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  private async readJson(relPath: string): Promise<unknown | null> {
    const buf = await this.readRaw(relPath)
    return buf ? JSON.parse(buf.toString('utf8')) : null
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

let counter = 0
function randomSuffix(): string {
  return `${Date.now().toString(36)}${(counter++).toString(36)}`
}
