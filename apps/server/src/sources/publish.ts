/**
 * ready가 된 source를 vault Markdown과 불변 이력에 남긴다.
 *
 * 두 곳에 쓴다. 역할이 다르다.
 *   · `vault/sources/<id>.md` — 사람이 읽고 고치는 **정식 원본** (9절)
 *   · `runs/sources/<id>/source.json` — 재현용 **불변 이력** (11절)
 *
 * ⛔ 이 함수는 사람 편집을 절대 덮지 않는다. 재발행할 때 앱이 소유한 필드만
 *    갱신하고 본문과 나머지 frontmatter는 디스크에 있는 것을 그대로 둔다.
 *    사용자가 제목을 고치거나 본문에 메모를 적어도 다음 발행에서 사라지지 않는다.
 */

import type { TrackKind } from '@ratatouille/contracts'
import type { RunArtifactStore } from '../runs/store.ts'
import { patchFrontmatter } from '../vault/document.ts'
import type { VaultStore } from '../vault/store.ts'
import type { SourceRecord } from './repository.ts'

/** frontmatter 스키마 버전. 지금 구조는 최종이 아니다 (9절). */
export const SOURCE_SCHEMA_VERSION = 1

/**
 * 앱이 소유한 frontmatter 키.
 *
 * 재발행 시 **이 목록만** 덮는다. 여기에 `title`을 넣지 않는 이유: 사용자가
 * 회의 제목을 고쳤을 때 되돌려버린다. 제목은 사람 소유다.
 */
const APP_OWNED_KEYS = [
  'id',
  'type',
  'status',
  'captured_at',
  'capture_mode',
  'duration_seconds',
  'source_hash',
  'tracks',
  'schema_version',
] as const

export function sourceVaultPath(sourceId: string): string {
  return `sources/${sourceId}.md`
}

export type PublishDeps = {
  vault: VaultStore
  runs: RunArtifactStore
}

export async function publishSource(
  src: SourceRecord,
  deps: PublishDeps
): Promise<void> {
  if (src.state !== 'ready' || !src.manifest || !src.sourceHash) {
    throw new Error(
      `${src.id}: ready가 아닌 source는 발행하지 않는다 (현재 ${src.state}). 불완전한 source는 Inbox에 남는다.`
    )
  }

  const m = src.manifest
  const perTrack = countByTrack(src)

  const appFields = {
    id: src.id,
    type: 'audio',
    status: 'ready',
    captured_at: m.startedAt,
    capture_mode: m.captureMode,
    // 일시정지 중에는 조각이 만들어지지 않으므로, 조각 수 × 조각 길이가
    // 실제 녹음된 오디오 길이다. 벽시계 경과 시간과는 다르다.
    duration_seconds: Math.round(
      (maxChunks(perTrack) * m.chunkDurationMs) / 1000
    ),
    source_hash: src.sourceHash,
    tracks: m.tracks.map((kind) => ({ kind, chunks: perTrack[kind] ?? 0 })),
    schema_version: SOURCE_SCHEMA_VERSION,
  }

  const relPath = sourceVaultPath(src.id)
  const existing = await deps.vault.read(relPath)

  if (existing) {
    // 앱 소유 필드만 갱신한다. 본문과 나머지 frontmatter는 손대지 않는다.
    const next = patchFrontmatter(existing.frontmatter, appFields)
    if (!changed(existing.frontmatter, next)) return // 멱등 — 쓰지 않는다
    await deps.vault.write(
      relPath,
      { frontmatter: next, body: existing.body },
      { baseHash: existing.hash }
    )
  } else {
    await deps.vault.write(relPath, {
      frontmatter: { ...appFields, project_id: null },
      body: initialBody(src),
    })
  }

  // 불변 이력. 같은 내용 재기록은 멱등하게 통과한다.
  await deps.runs.putSource(src.id, {
    id: src.id,
    source_hash: src.sourceHash,
    manifest: m,
    chunks: src.chunks,
  })
}

function countByTrack(src: SourceRecord): Partial<Record<TrackKind, number>> {
  const out: Partial<Record<TrackKind, number>> = {}
  for (const c of src.chunks) out[c.track] = (out[c.track] ?? 0) + 1
  return out
}

function maxChunks(perTrack: Partial<Record<TrackKind, number>>): number {
  return Math.max(0, ...Object.values(perTrack).map((n) => n ?? 0))
}

function changed(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return APP_OWNED_KEYS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

/**
 * 첫 발행 시의 본문.
 *
 * 긴 목적·맥락·agenda는 frontmatter가 아니라 여기에 둔다 (9절).
 * 뒤 Phase가 전사·요약을 채우기 전까지 사용자가 직접 적을 자리다.
 */
function initialBody(src: SourceRecord): string {
  return [
    `# ${src.id}`,
    '',
    '## 맥락',
    '',
    '## 메모',
    '',
  ].join('\n')
}
