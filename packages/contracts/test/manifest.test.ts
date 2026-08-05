import { describe, expect, it } from 'vitest'
import {
  type ChunkRecord,
  type ManifestViolation,
  type RecordingManifest,
  type TrackKind,
  canMarkReady,
  dedupeChunks,
  describeManifestViolation,
  missingSeqs,
  verifyManifest,
} from '../src/manifest.ts'

/** Phase 0 실측값: 5초 조각, 약 80KB */
const CHUNK_BYTES = 80_540

function hash(n: number): string {
  return `sha256:${String(n).padStart(64, '0')}`
}

function chunks(track: TrackKind, count: number, from = 0): ChunkRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    track,
    seq: from + i,
    bytes: CHUNK_BYTES,
    hash: hash(from + i),
  }))
}

function manifest(over: Partial<RecordingManifest> = {}): RecordingManifest {
  return {
    sourceId: 'src_01H',
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: 'MacBook Pro 마이크' },
    tracks: ['mic'],
    expectedChunks: { mic: 6 },
    pauses: [],
    chunkDurationMs: 5000,
    ...over,
  }
}

describe('정상 케이스', () => {
  it('대면 모드 6조각이 온전하면 위반이 없다', () => {
    const v = verifyManifest(manifest(), chunks('mic', 6))
    expect(v).toEqual([])
    expect(canMarkReady(v)).toBe(true)
  })

  it('온라인 모드 mic + remote가 온전하면 통과한다', () => {
    const m = manifest({
      captureMode: 'online',
      tracks: ['mic', 'remote'],
      devices: { mic: '마이크', remote: 'Chrome 탭' },
      expectedChunks: { mic: 6, remote: 6 },
    })
    const v = verifyManifest(m, [...chunks('mic', 6), ...chunks('remote', 6)])
    expect(v).toEqual([])
  })

  it('30분 녹음(360조각)도 통과한다 — Phase 0 실측 규모', () => {
    const m = manifest({ expectedChunks: { mic: 360 } })
    expect(verifyManifest(m, chunks('mic', 360))).toEqual([])
  })
})

describe('온라인 모드는 탭 오디오 track이 필수다', () => {
  it('remote track이 없으면 거부한다 — PLAN.md 순서 2 완료 조건', () => {
    const m = manifest({ captureMode: 'online', tracks: ['mic'] })
    const v = verifyManifest(m, chunks('mic', 6))
    expect(v).toContainEqual({ kind: 'online_requires_remote' })
    expect(canMarkReady(v)).toBe(false)
  })

  it('클라이언트 검증만 믿지 않는다 — 서버에서도 같은 규칙이 걸린다', () => {
    // 클라이언트가 어떤 이유로든 remote 없이 online을 올려도 ready가 되지 않는다
    const m = manifest({ captureMode: 'online', tracks: ['mic'] })
    expect(canMarkReady(verifyManifest(m, chunks('mic', 6)))).toBe(false)
  })
})

describe('조각 유실 — 순번 구멍', () => {
  it('중간이 빠지면 잡는다', () => {
    const c = chunks('mic', 6).filter((x) => x.seq !== 2 && x.seq !== 4)
    const v = verifyManifest(manifest(), c)
    expect(v).toContainEqual({
      kind: 'sequence_gap',
      track: 'mic',
      missing: [2, 4],
    })
  })

  it('선언한 개수와 실제가 다르면 잡는다', () => {
    const v = verifyManifest(manifest({ expectedChunks: { mic: 6 } }), chunks('mic', 4))
    expect(v).toContainEqual({
      kind: 'count_mismatch',
      track: 'mic',
      expected: 6,
      actual: 4,
    })
  })

  it('조각이 하나도 없으면 잡는다', () => {
    expect(verifyManifest(manifest(), [])).toContainEqual({
      kind: 'no_chunks',
      track: 'mic',
    })
  })
})

describe('멱등 재전송 — dedupeChunks', () => {
  it('같은 내용의 중복 수신은 하나로 합친다', () => {
    const c = chunks('mic', 3)
    const { unique, conflicts } = dedupeChunks([...c, c[1]!, c[1]!])
    expect(unique).toHaveLength(3)
    expect(conflicts).toEqual([])
  })

  it('중복 수신이 있어도 manifest 검증을 통과한다 — 네트워크 재시도는 정상이다', () => {
    const c = chunks('mic', 6)
    const withRetries = [...c, c[0]!, c[3]!, c[5]!]
    expect(verifyManifest(manifest(), withRetries)).toEqual([])
  })

  it('같은 순번인데 hash가 다르면 충돌로 본다 — 데이터 오염', () => {
    const c = chunks('mic', 3)
    const tampered: ChunkRecord = { ...c[1]!, hash: hash(999) }
    const { conflicts } = dedupeChunks([...c, tampered])
    expect(conflicts).toEqual([{ track: 'mic', seq: 1 }])
  })

  it('같은 순번인데 크기가 다르면 충돌로 본다', () => {
    const c = chunks('mic', 3)
    const { conflicts } = dedupeChunks([...c, { ...c[2]!, bytes: 1 }])
    expect(conflicts).toEqual([{ track: 'mic', seq: 2 }])
  })

  it('충돌은 verifyManifest에서 위반으로 보고된다', () => {
    const c = chunks('mic', 6)
    const v = verifyManifest(manifest(), [...c, { ...c[0]!, hash: hash(999) }])
    expect(v).toContainEqual({
      kind: 'duplicate_seq',
      track: 'mic',
      seq: 0,
      conflicting: true,
    })
  })
})

describe('조각 무결성', () => {
  it('hash 형식이 sha256:<64hex>가 아니면 거부한다', () => {
    const c = chunks('mic', 6)
    c[2] = { ...c[2]!, hash: 'md5:abc' }
    expect(verifyManifest(manifest(), c)).toContainEqual({
      kind: 'bad_hash_format',
      track: 'mic',
      seq: 2,
      hash: 'md5:abc',
    })
  })

  it('대문자 hex를 거부한다', () => {
    const c = chunks('mic', 6)
    c[0] = { ...c[0]!, hash: `sha256:${'A'.repeat(64)}` }
    expect(verifyManifest(manifest(), c).map((x) => x.kind)).toContain(
      'bad_hash_format'
    )
  })

  it('크기가 0인 조각을 거부한다', () => {
    const c = chunks('mic', 6)
    c[4] = { ...c[4]!, bytes: 0 }
    expect(verifyManifest(manifest(), c)).toContainEqual({
      kind: 'empty_chunk',
      track: 'mic',
      seq: 4,
    })
  })

  it('manifest에 없는 track의 조각을 거부한다', () => {
    const v = verifyManifest(manifest(), [
      ...chunks('mic', 6),
      ...chunks('remote', 2),
    ])
    expect(v).toContainEqual({ kind: 'unknown_track', track: 'remote' })
  })
})

describe('Phase 0.4 — track 간 시간축 정렬', () => {
  const online = manifest({
    captureMode: 'online',
    tracks: ['mic', 'remote'],
    devices: { mic: '마이크', remote: '탭' },
    expectedChunks: { mic: 6, remote: 6 },
  })

  it('일시정지 없이 조각 수가 다르면 정렬 이상으로 본다', () => {
    // 편측 일시정지·입력 단절 시 실측에서 295ms 드리프트가 났다
    const v = verifyManifest(
      { ...online, expectedChunks: { mic: 5, remote: 6 } },
      [...chunks('mic', 5), ...chunks('remote', 6)]
    )
    expect(v).toContainEqual({
      kind: 'track_count_drift',
      counts: { mic: 5, remote: 6 },
    })
  })

  it('일시정지가 기록돼 있으면 개수 차이를 문제 삼지 않는다', () => {
    const withPause = {
      ...online,
      expectedChunks: { mic: 5, remote: 6 },
      pauses: [{ fromMs: 10_000, toMs: 10_400 }],
    }
    const v = verifyManifest(withPause, [
      ...chunks('mic', 5),
      ...chunks('remote', 6),
    ])
    expect(v.filter((x) => x.kind === 'track_count_drift')).toEqual([])
  })

  it('조각 수가 같으면 정렬 이상이 아니다', () => {
    const v = verifyManifest(online, [
      ...chunks('mic', 6),
      ...chunks('remote', 6),
    ])
    expect(v).toEqual([])
  })
})

describe('missingSeqs — 재개 시 "어디까지 받았나"', () => {
  it('빠진 순번만 돌려준다', () => {
    const c = chunks('mic', 6).filter((x) => ![1, 3].includes(x.seq))
    expect(missingSeqs(c, 'mic', 6)).toEqual([1, 3])
  })

  it('전부 받았으면 빈 배열이다 — 중복 업로드를 만들지 않는다', () => {
    expect(missingSeqs(chunks('mic', 6), 'mic', 6)).toEqual([])
  })

  it('아무것도 못 받았으면 전부 돌려준다', () => {
    expect(missingSeqs([], 'mic', 3)).toEqual([0, 1, 2])
  })

  it('track별로 독립적이다', () => {
    const c = [...chunks('mic', 6), ...chunks('remote', 3)]
    expect(missingSeqs(c, 'mic', 6)).toEqual([])
    expect(missingSeqs(c, 'remote', 6)).toEqual([3, 4, 5])
  })
})

describe('describeManifestViolation', () => {
  it('모든 위반 유형을 한국어 문장으로 설명한다', () => {
    const all: ManifestViolation[] = [
      { kind: 'missing_track', track: 'mic' },
      { kind: 'online_requires_remote' },
      { kind: 'no_chunks', track: 'mic' },
      { kind: 'sequence_gap', track: 'mic', missing: [1, 2] },
      { kind: 'count_mismatch', track: 'mic', expected: 6, actual: 4 },
      { kind: 'duplicate_seq', track: 'mic', seq: 1, conflicting: true },
      { kind: 'bad_hash_format', track: 'mic', seq: 1, hash: 'x' },
      { kind: 'empty_chunk', track: 'mic', seq: 1 },
      { kind: 'unknown_track', track: 'ghost' },
      { kind: 'track_count_drift', counts: { mic: 5, remote: 6 } },
    ]
    for (const v of all) {
      const s = describeManifestViolation(v)
      expect(s.length).toBeGreaterThan(0)
      expect(s).not.toContain('undefined')
    }
  })
})
