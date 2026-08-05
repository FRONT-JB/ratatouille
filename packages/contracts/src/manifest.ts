/**
 * 녹음 manifest와 조각 검증 — technical-foundation.md 4절 `브라우저 수집 계약`.
 *
 * Phase 0 실측으로 확정된 파라미터 (.experiments/BROWSER-RESULTS.md):
 *   · chunk 길이 5초 · 30분 = 360조각 ≈ 29MB
 *   · 조각당 SHA-256이 0.03ms → 전 조각 hash 검증이 비용 부담이 아니다
 *   · 두 track은 동시 시작·동시 일시정지. 편측 정지 시 295ms 드리프트
 *
 * ⛔ "종료 후 모든 조각과 manifest가 확인될 때만 `ready`가 된다."
 *    불완전한 source는 Inbox에 남고 문서화 job을 만들지 않는다.
 */

export const TRACK_KINDS = ['mic', 'remote'] as const
export type TrackKind = (typeof TRACK_KINDS)[number]

export const CAPTURE_MODES = ['in_person', 'online'] as const
export type CaptureMode = (typeof CAPTURE_MODES)[number]

/** 업로드된 조각 하나. 순번·크기·hash로 검증한다. */
export type ChunkRecord = {
  track: TrackKind
  /** 0부터 시작하는 조각 순번 */
  seq: number
  bytes: number
  /** `sha256:...` */
  hash: string
}

/** 일시정지 구간. 두 track에 **동시** 적용되어야 한다 (Phase 0.4). */
export type PauseInterval = {
  /** 녹음 시작으로부터의 밀리초 */
  fromMs: number
  toMs: number
}

export type RecordingManifest = {
  sourceId: string
  captureMode: CaptureMode
  /** 시작 시점에 기록한다. PLAN.md 순서 2 완료 조건. */
  startedAt: string
  /** 선택한 입력 장치 라벨 */
  devices: Partial<Record<TrackKind, string>>
  /** 실제로 수집한 track. 온라인 모드는 mic + remote 둘 다여야 한다. */
  tracks: TrackKind[]
  /** track별 조각 총 개수. 녹음 종료 시 클라이언트가 선언한다. */
  expectedChunks: Partial<Record<TrackKind, number>>
  pauses: PauseInterval[]
  chunkDurationMs: number
}

export type ManifestViolation =
  | { kind: 'missing_track'; track: TrackKind }
  | { kind: 'online_requires_remote' }
  | { kind: 'no_chunks'; track: TrackKind }
  | { kind: 'sequence_gap'; track: TrackKind; missing: number[] }
  | { kind: 'count_mismatch'; track: TrackKind; expected: number; actual: number }
  | { kind: 'duplicate_seq'; track: TrackKind; seq: number; conflicting: true }
  | { kind: 'bad_hash_format'; track: TrackKind; seq: number; hash: string }
  | { kind: 'empty_chunk'; track: TrackKind; seq: number }
  | { kind: 'unknown_track'; track: string }
  | { kind: 'track_count_drift'; counts: Record<string, number> }

const SHA256_RE = /^sha256:[0-9a-f]{64}$/

/**
 * 같은 순번을 두 번 받은 경우를 정리한다.
 *
 * 재전송 protocol상 **중복 수신은 정상**이다 (네트워크 재시도).
 * hash가 같으면 멱등하게 하나로 취급하고, 다르면 무결성 위반이다.
 */
export function dedupeChunks(chunks: readonly ChunkRecord[]): {
  unique: ChunkRecord[]
  conflicts: Array<{ track: TrackKind; seq: number }>
} {
  const byKey = new Map<string, ChunkRecord>()
  const conflicts: Array<{ track: TrackKind; seq: number }> = []

  for (const c of chunks) {
    const key = `${c.track}#${c.seq}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, c)
      continue
    }
    // 같은 내용의 재전송이면 무시한다 — 멱등
    if (prev.hash !== c.hash || prev.bytes !== c.bytes) {
      conflicts.push({ track: c.track, seq: c.seq })
    }
  }

  return { unique: [...byKey.values()], conflicts }
}

/**
 * manifest와 수집된 조각을 대조한다.
 *
 * 위반이 하나라도 있으면 source를 `ready`로 만들지 않는다.
 */
export function verifyManifest(
  manifest: RecordingManifest,
  chunks: readonly ChunkRecord[]
): ManifestViolation[] {
  const violations: ManifestViolation[] = []

  // 온라인 모드는 mic + remote 둘 다 있어야 한다.
  // "탭 track이 없으면 녹음 전에 경고한다" (technical-foundation 4절)의 서버 측 확인.
  if (manifest.captureMode === 'online' && !manifest.tracks.includes('remote')) {
    violations.push({ kind: 'online_requires_remote' })
  }

  const { unique, conflicts } = dedupeChunks(chunks)
  for (const c of conflicts) {
    violations.push({ ...c, kind: 'duplicate_seq', conflicting: true })
  }

  // manifest에 없는 track의 조각이 올라온 경우
  for (const t of new Set(unique.map((c) => c.track))) {
    if (!manifest.tracks.includes(t)) {
      violations.push({ kind: 'unknown_track', track: t })
    }
  }

  const perTrackCount: Record<string, number> = {}

  for (const track of manifest.tracks) {
    const own = unique
      .filter((c) => c.track === track)
      .sort((a, b) => a.seq - b.seq)
    perTrackCount[track] = own.length

    if (own.length === 0) {
      violations.push({ kind: 'no_chunks', track })
      continue
    }

    // 순번 구멍 — 0..max 사이에 빠진 것
    const seen = new Set(own.map((c) => c.seq))
    const max = own[own.length - 1]!.seq
    const missing: number[] = []
    for (let i = 0; i <= max; i++) if (!seen.has(i)) missing.push(i)
    if (missing.length > 0) {
      violations.push({ kind: 'sequence_gap', track, missing })
    }

    // 클라이언트가 선언한 개수와 대조
    const expected = manifest.expectedChunks[track]
    if (expected !== undefined && expected !== own.length) {
      violations.push({
        kind: 'count_mismatch',
        track,
        expected,
        actual: own.length,
      })
    }

    for (const c of own) {
      if (!SHA256_RE.test(c.hash)) {
        violations.push({
          kind: 'bad_hash_format',
          track,
          seq: c.seq,
          hash: c.hash,
        })
      }
      if (c.bytes <= 0) {
        violations.push({ kind: 'empty_chunk', track, seq: c.seq })
      }
    }
  }

  /**
   * Phase 0.4 실측: 한쪽 track만 일시정지하면 조각 수가 어긋난다(295ms 드리프트).
   * 조각 수 불일치 자체가 정렬 이상 신호다.
   *
   * 일시정지 구간이 기록되어 있으면 의도된 차이일 수 있으므로,
   * pause가 없는데 개수가 다를 때만 문제 삼는다.
   */
  if (manifest.tracks.length > 1 && manifest.pauses.length === 0) {
    const counts = Object.values(perTrackCount)
    if (counts.length > 1 && new Set(counts).size > 1) {
      violations.push({ kind: 'track_count_drift', counts: perTrackCount })
    }
  }

  return violations
}

/** 모든 조각과 manifest가 확인되었는가. 이것이 `ready`의 유일한 조건이다. */
export function canMarkReady(violations: ManifestViolation[]): boolean {
  return violations.length === 0
}

/**
 * 재개 시 클라이언트가 묻는 "어디까지 받았나"에 답한다.
 *
 * PLAN.md 순서 3 완료 조건: **재접속 후 같은 source를 중복 업로드하지 않는다.**
 * 순번 구멍이 있으면 그 구멍만 다시 보내면 된다.
 */
export function missingSeqs(
  chunks: readonly ChunkRecord[],
  track: TrackKind,
  expectedCount: number
): number[] {
  const seen = new Set(
    chunks.filter((c) => c.track === track).map((c) => c.seq)
  )
  const missing: number[] = []
  for (let i = 0; i < expectedCount; i++) if (!seen.has(i)) missing.push(i)
  return missing
}

export function describeManifestViolation(v: ManifestViolation): string {
  switch (v.kind) {
    case 'missing_track':
      return `${v.track} track의 조각이 하나도 없다`
    case 'online_requires_remote':
      return '온라인 모드인데 remote(탭 오디오) track이 없다'
    case 'no_chunks':
      return `${v.track}: 조각이 하나도 도착하지 않았다`
    case 'sequence_gap':
      return `${v.track}: 순번 ${v.missing.join(', ')}이 빠졌다`
    case 'count_mismatch':
      return `${v.track}: 선언 ${v.expected}개, 실제 ${v.actual}개`
    case 'duplicate_seq':
      return `${v.track}#${v.seq}: 같은 순번인데 내용이 다르다`
    case 'bad_hash_format':
      return `${v.track}#${v.seq}: hash 형식이 sha256:<64hex>가 아니다`
    case 'empty_chunk':
      return `${v.track}#${v.seq}: 크기가 0이다`
    case 'unknown_track':
      return `manifest에 없는 track '${v.track}'의 조각이 올라왔다`
    case 'track_count_drift':
      return `track별 조각 수가 다르다 (${JSON.stringify(v.counts)}) — 편측 일시정지나 입력 단절 의심`
  }
}
