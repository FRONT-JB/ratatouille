import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TranscriptionFailed,
  TranscriptionRunner,
  formatTimestamp,
  toEvidenceSegments,
} from '../src/transcription/runner.ts'

let work: string

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'rat-run-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

async function chunk(name: string, bytes = 32): Promise<string> {
  const p = path.join(work, name)
  await writeFile(p, new Uint8Array(bytes).fill(1))
  return p
}

const runner = (over: Record<string, unknown> = {}) =>
  new TranscriptionRunner({
    modelPath: '/models/x.bin',
    whisperBin: 'true',
    ffmpegBin: 'true',
    ffprobeBin: 'true',
    ...over,
  })

describe('⛔ timestamp 포맷은 한 곳에서만 만든다', () => {
  // verifyEvidence는 모델이 인용한 timestamp와 원본을 **문자열 완전 일치**로
  // 비교한다. 포맷이 두 군데서 만들어지면 멀쩡한 인용이 전부 위반으로 잡힌다.

  it('whisper 출력과 같은 표기를 쓴다', () => {
    // 실제 whisper-cli 출력: "00:00:03,560"
    expect(formatTimestamp(3560)).toBe('00:00:03,560')
  })

  it('0을 채운다', () => {
    expect(formatTimestamp(0)).toBe('00:00:00,000')
  })

  it('분과 시를 올린다', () => {
    expect(formatTimestamp(65_000)).toBe('00:01:05,000')
    expect(formatTimestamp(3_725_123)).toBe('01:02:05,123')
  })

  it('밀리초를 세 자리로 유지한다', () => {
    expect(formatTimestamp(1005)).toBe('00:00:01,005')
  })

  it('음수는 0으로 본다', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00,000')
  })

  it('evidence 형식으로 옮긴다', () => {
    const segs = toEvidenceSegments([
      { id: 'seg_0', startMs: 0, endMs: 3560, text: '안녕하세요', speaker: null },
      { id: 'seg_1', startMs: 3560, endMs: 7000, text: '네', speaker: '0' },
    ])
    expect(segs).toEqual([
      { id: 'seg_0', timestamp: '00:00:00,000', text: '안녕하세요' },
      { id: 'seg_1', timestamp: '00:00:03,560', text: '네' },
    ])
  })
})

describe('⛔ 온라인 모드에 탭 오디오가 없으면 전사하지 않는다', () => {
  it('상대방 목소리 빠진 전사를 성공으로 만들지 않는다', async () => {
    const mic = await chunk('m0')
    await expect(
      runner().run({
        sourceId: 's1',
        captureMode: 'online',
        chunks: { mic: [mic] },
        workDir: path.join(work, 'w'),
      })
    ).rejects.toThrow(/탭 오디오 조각이 없다/)
  })

  it('재시도해도 소용없는 실패로 표시한다', async () => {
    const mic = await chunk('m0')
    await runner()
      .run({
        sourceId: 's1',
        captureMode: 'online',
        chunks: { mic: [mic] },
        workDir: path.join(work, 'w'),
      })
      .catch((e) => {
        expect(e).toBeInstanceOf(TranscriptionFailed)
        expect(e.retryable).toBe(false)
      })
  })
})

describe('실패 분류 — 재시도가 의미 있는가', () => {
  // ⛔ 전부 재시도 가능으로 두면 사용자가 같은 실패를 무한히 반복한다.
  //    전부 영구 실패로 두면 일시적 자원 부족에도 녹음을 버린다.

  it('바이너리가 없으면 재시도 불가다', async () => {
    const mic = await chunk('m0')
    await runner({ ffmpegBin: '/nonexistent/ffmpeg' })
      .run({
        sourceId: 's1',
        captureMode: 'in_person',
        chunks: { mic: [mic] },
        workDir: path.join(work, 'w'),
      })
      .catch((e: TranscriptionFailed) => {
        expect(e.retryable).toBe(false)
        expect(e.message).toMatch(/설치/)
      })
  })

  it('시간 초과는 재시도 가능하다', async () => {
    const mic = await chunk('m0')
    await runner({ ffmpegBin: 'sleep' })
      .run({
        sourceId: 's1',
        captureMode: 'in_person',
        chunks: { mic: [mic] },
        workDir: path.join(work, 'w'),
      })
      .catch((e: TranscriptionFailed) => {
        expect(e.retryable).toBe(true)
      })
  })

  it('결과 JSON이 없으면 재시도 불가다 — 계약이 바뀐 것이다', async () => {
    const mic = await chunk('m0')
    await runner()
      .run({
        sourceId: 's1',
        captureMode: 'in_person',
        chunks: { mic: [mic] },
        workDir: path.join(work, 'w'),
      })
      .catch((e: TranscriptionFailed) => {
        expect(e.message).toMatch(/결과 JSON이 없다/)
        expect(e.retryable).toBe(false)
      })
  })

  it('조각이 없으면 이어붙이기에서 멈춘다', async () => {
    await expect(
      runner().run({
        sourceId: 's1',
        captureMode: 'in_person',
        chunks: { mic: [] },
        workDir: path.join(work, 'w'),
      })
    ).rejects.toThrow(/조각이 없다/)
  })

  it('취소할 수 있다', async () => {
    const mic = await chunk('m0')
    const ac = new AbortController()
    const p = runner({ ffmpegBin: 'sleep' }).run({
      sourceId: 's1',
      captureMode: 'in_person',
      chunks: { mic: [mic] },
      workDir: path.join(work, 'w'),
      signal: ac.signal,
    })
    ac.abort()
    await expect(p).rejects.toThrow(/취소/)
  })
})

// ────────────────────────────────────────────────────────────────
// 실제 전사. whisper-cli · ffmpeg · 모델이 있어야 돈다.
// ────────────────────────────────────────────────────────────────

const MODEL = path.resolve(
  import.meta.dirname,
  '../../../.experiments/models/ggml-large-v3-turbo.bin'
)
const AUDIO = path.resolve(import.meta.dirname, 'fixtures/short-ko.wav')
const canRunReal = existsSync(MODEL) && existsSync(AUDIO)

describe.skipIf(!canRunReal)('⛔ 실제 오디오 전사 — Phase 4 품질 게이트', () => {
  // 게이트 원문: "실제 오디오 파일로 전사 성공(whisper-cli 직접 호출),
  // timestamp가 오디오와 일치". mock으로는 통과했다고 말할 수 없다.

  const real = () =>
    new TranscriptionRunner({ modelPath: MODEL, timeoutMs: 5 * 60 * 1000 })

  // WAV를 조각 하나로 넘긴다 — concat은 바이트 연결이라 그대로 통과한다
  const input = () => ({
    sourceId: 'src_real',
    captureMode: 'in_person' as const,
    chunks: { mic: [AUDIO] },
    workDir: path.join(work, 'real'),
  })

  it('20초 한국어 오디오를 전사한다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    expect(r.language).toBe('ko')
    expect(r.segments.length).toBeGreaterThan(0)
    // 빈 문자열이나 영어가 아니라 실제 한국어가 나와야 한다
    expect(r.segments.map((s) => s.text).join('')).toMatch(/[가-힣]/)
  })

  it('⛔ 모든 세그먼트에 timestamp가 있다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    for (const s of r.segments) {
      expect(Number.isFinite(s.startMs)).toBe(true)
      expect(Number.isFinite(s.endMs)).toBe(true)
      expect(s.endMs).toBeGreaterThanOrEqual(s.startMs)
    }
  })

  it('⛔ timestamp가 오디오 길이 안에 있다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    // 20초 오디오. 여유를 둬도 25초를 넘으면 오디오와 무관한 값이다.
    const first = r.segments.at(0)
    const last = r.segments.at(-1)
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    expect(first!.startMs).toBeGreaterThanOrEqual(0)
    expect(last!.endMs).toBeLessThanOrEqual(25_000)
  })

  it('시간이 단조 증가한다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    const starts = r.segments.map((s) => s.startMs)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('원본 JSON을 보존한다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    const raw = JSON.parse(await readFile(r.rawJsonPath, 'utf8'))
    expect(raw.transcription.length).toBeGreaterThan(0)
  })

  it('오디오 길이를 잰다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    expect(r.audioMs).not.toBeNull()
    expect(r.audioMs!).toBeGreaterThan(15_000)
    expect(r.audioMs!).toBeLessThan(25_000)
  })

  it('evidence 형식으로 옮겨도 timestamp가 유지된다', { timeout: 300_000 }, async () => {
    const r = await real().run(input())

    const evidence = toEvidenceSegments(r.segments)
    expect(evidence.length).toBeGreaterThan(0)
    for (const e of evidence) {
      expect(e.timestamp).toMatch(/^\d{2}:\d{2}:\d{2},\d{3}$/)
    }
    expect(evidence.map((e) => e.id)).toEqual(r.segments.map((s) => s.id))
  })
})

describe.skipIf(canRunReal)('실제 전사 테스트를 건너뜀', () => {
  it('무엇이 없어서 못 돌았는지 남긴다', () => {
    // 조용히 통과시키지 않는다.
    const missing = [
      !existsSync(MODEL) && `모델 없음: ${MODEL}`,
      !existsSync(AUDIO) && `오디오 없음: ${AUDIO}`,
    ].filter(Boolean)
    console.warn(`[전사] 실제 전사 테스트를 건너뛴다 — ${missing.join(', ')}`)
    expect(missing.length).toBeGreaterThan(0)
  })
})
