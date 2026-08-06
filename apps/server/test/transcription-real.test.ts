import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunArtifactStore } from '../src/runs/store.ts'
import { Transcriber } from '../src/transcription/job.ts'
import { spawnProcess } from '../src/transcription/process.ts'

/**
 * ⛔ 실제 `whisper-cli`와 `ffmpeg`을 돌린다. mock이 아니다.
 *
 * Phase 4 품질 게이트: "실제 오디오 파일로 전사 성공, timestamp가 오디오와 일치".
 * 명령 구성이 맞아도 실행이 깨지는 경우가 있으므로(플래그 조합, 모델 형식,
 * 출력 경로) 한 번은 진짜로 돌려봐야 한다.
 *
 * 모델은 1.6GB라 저장소에 없다. 없으면 **건너뛰되 그 사실을 이름에 남긴다** —
 * 조용히 통과시키면 게이트가 통과된 것처럼 보인다.
 */

const REPO = path.resolve(import.meta.dirname, '../../..')
const MODEL = path.join(REPO, '.experiments/models/ggml-large-v3-turbo.bin')
const AUDIO = path.join(REPO, '.experiments/meeting-16k.wav')

const ready = existsSync(MODEL) && existsSync(AUDIO)
const maybe = ready ? describe : describe.skip

if (!ready) {
  describe('실제 전사', () => {
    it.skip(
      `건너뜀 — 모델(${path.basename(MODEL)}) 또는 오디오가 없다. 품질 게이트는 아직 통과하지 않았다`,
      () => undefined
    )
  })
}

let root: string
let runs: RunArtifactStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-real-'))
  runs = new RunArtifactStore(path.join(root, 'runs'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

maybe('⛔ 실제 whisper-cli 전사 — Phase 4 품질 게이트', () => {
  /** 짧게 잘라 쓴다. 전체 회의는 35초 걸린다 (Phase 0 실측). */
  async function clip(seconds: number): Promise<string> {
    const out = path.join(root, `clip-${seconds}s.wav`)
    const r = await spawnProcess('ffmpeg', [
      '-y',
      '-i',
      AUDIO,
      '-t',
      String(seconds),
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      out,
    ])
    expect(r.code).toBe(0)
    return out
  }

  function transcriber() {
    return new Transcriber({
      runs,
      workRoot: path.join(root, 'work'),
      modelPath: MODEL,
      run: spawnProcess,
    })
  }

  it(
    '한국어 회의 오디오를 전사한다',
    async () => {
      const { job, transcript } = await transcriber().transcribe({
        jobId: 'tr_real',
        sourceId: 'src_real',
        captureMode: 'in_person',
        chunkFiles: { mic: [await clip(20)] },
      })

      expect(job.error).toBeNull()
      expect(job.state).toBe('completed')
      expect(transcript!.segments.length).toBeGreaterThan(0)
      // 한국어가 나와야 한다 — 언어 플래그가 먹었는지 확인
      expect(transcript!.segments.map((s) => s.text).join(' ')).toMatch(/[가-힣]/)
    },
    120_000
  )

  it(
    '⛔ timestamp가 오디오 길이 안에 있고 순서대로다',
    async () => {
      const seconds = 20
      const { job, transcript } = await transcriber().transcribe({
        jobId: 'tr_ts',
        sourceId: 'src_real',
        captureMode: 'in_person',
        chunkFiles: { mic: [await clip(seconds)] },
      })

      const segs = transcript!.segments
      expect(job.audioMs).toBeGreaterThan(0)

      for (const s of segs) {
        expect(s.startMs).toBeGreaterThanOrEqual(0)
        expect(s.endMs).toBeGreaterThanOrEqual(s.startMs)
        // whisper가 마지막 세그먼트를 오디오 끝까지 늘리는 경우가 있어 여유를 준다
        expect(s.endMs).toBeLessThanOrEqual(seconds * 1000 + 2000)
      }

      // 시간순이어야 한다 — 교정 화면에서 클릭해 그 지점을 재생한다
      const starts = segs.map((s) => s.startMs)
      expect([...starts].sort((a, b) => a - b)).toEqual(starts)
    },
    120_000
  )

  it(
    'Metal 가속이 붙어 기준선 안에서 끝난다',
    async () => {
      const { job } = await transcriber().transcribe({
        jobId: 'tr_speed',
        sourceId: 'src_real',
        captureMode: 'in_person',
        chunkFiles: { mic: [await clip(20)] },
      })

      // 경고가 있으면 CPU 폴백이거나 오디오가 잘린 것이다
      expect(job.warning).toBeNull()
      expect(job.elapsedMs).toBeLessThan(60_000)
    },
    120_000
  )

  it(
    '불변 이력이 남고 다시 읽을 수 있다',
    async () => {
      await transcriber().transcribe({
        jobId: 'tr_artifact',
        sourceId: 'src_real',
        captureMode: 'in_person',
        chunkFiles: { mic: [await clip(10)] },
      })
      const raw = (await runs.readRawTranscript('tr_artifact')) as {
        segments: Array<{ id: string }>
        language: string | null
      }
      expect(raw.language).toBe('ko')
      expect(raw.segments[0]?.id).toBe('seg_0')
    },
    120_000
  )
})
