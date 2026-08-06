/**
 * 전사 job — `technical-foundation` 5절의 `transcription_job` 상태 머신.
 *
 *   queued → transcribing → completed
 *                        ↘ failed_retryable → queued
 *
 * ⛔ **`ready` 이전 source로는 job을 만들지 못한다** (5절). 불완전한 조각으로
 *    전사하면 잘린 회의록이 나오고, 그 사실이 검수 단계에서야 드러난다.
 *
 * ⛔ `transcript.raw.json`은 **불변**이다. 재시도는 새 transcription id로
 *    남기고, 기존 결과를 덮지 않는다 (11절 run artifact).
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  type CaptureMode,
  type TrackKind,
  type TranscriptionJobState,
  transition,
} from '@ratatouille/contracts'
import type { RunArtifactStore } from '../runs/store.ts'
import {
  buildFfmpegArgs,
  buildFfprobeArgs,
  concatChunks,
  parseFfprobeDuration,
} from './audio.ts'
import {
  type ParsedTranscript,
  buildWhisperArgs,
  parseWhisperJson,
  suspiciousDuration,
} from './whisper.ts'

export type RunProcess = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number }
) => Promise<{ code: number; stdout: string; stderr: string }>

export type TranscriptionJob = {
  id: string
  sourceId: string
  state: TranscriptionJobState
  /** 몇 번째 시도인지. 재시도할 때마다 새 transcription id가 생긴다 */
  attempt: number
  error: string | null
  /**
   * 다시 시도해서 풀릴 수 있는 실패인지.
   *
   * ⛔ 상태와 **따로** 둔다. `transcription_job` 머신에는 실패 상태가
   *    `failed_retryable` 하나뿐이라(5절), 영구 실패를 상태로 표현할 수 없다.
   *    억지로 다른 상태에 두면 job이 `transcribing`에 영원히 머문다.
   *    화면은 이 값이 false일 때 재시도 버튼을 내지 않는다.
   */
  retryable: boolean
  /** 기준선을 벗어났을 때의 경고. 실패는 아니다 */
  warning: string | null
  audioMs: number | null
  elapsedMs: number | null
  segmentCount: number | null
}

export type TranscriptionDeps = {
  runs: RunArtifactStore
  /** 작업 파일을 두는 곳. 전사가 끝나면 지운다 */
  workRoot: string
  modelPath: string
  run: RunProcess
  whisperBin?: string
  ffmpegBin?: string
  ffprobeBin?: string
  now?: () => number
}

export type TranscribeInput = {
  jobId: string
  sourceId: string
  captureMode: CaptureMode
  /** track별 조각 파일 경로 — **순번 오름차순으로 정렬해 넘긴다** */
  chunkFiles: Partial<Record<TrackKind, string[]>>
  vocabulary?: string[]
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    /** 재시도로 풀릴 수 있는 실패인지 */
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'TranscriptionError'
  }
}

/**
 * 전사를 수행한다.
 *
 * 실패는 두 종류다. `retryable`이면 job이 `failed_retryable`로 가고 사용자가
 * 다시 시도할 수 있다. 아니면 그대로 실패한다 — 재시도해도 결과가 같다.
 */
export class Transcriber {
  private readonly whisperBin: string
  private readonly ffmpegBin: string
  private readonly ffprobeBin: string
  private readonly now: () => number

  constructor(private readonly deps: TranscriptionDeps) {
    this.whisperBin = deps.whisperBin ?? 'whisper-cli'
    this.ffmpegBin = deps.ffmpegBin ?? 'ffmpeg'
    this.ffprobeBin = deps.ffprobeBin ?? 'ffprobe'
    this.now = deps.now ?? (() => Date.now())
  }

  async transcribe(input: TranscribeInput): Promise<{
    job: TranscriptionJob
    transcript: ParsedTranscript | null
  }> {
    const job: TranscriptionJob = {
      id: input.jobId,
      sourceId: input.sourceId,
      state: 'queued',
      attempt: 1,
      error: null,
      retryable: true,
      warning: null,
      audioMs: null,
      elapsedMs: null,
      segmentCount: null,
    }

    const work = path.join(this.deps.workRoot, input.jobId)
    try {
      job.state = transition(
        'transcriptionJob',
        'queued',
        'transcribing'
      ) as TranscriptionJobState

      const started = this.now()
      const wav = await this.prepareAudio(input, work)
      job.audioMs = await this.probeDuration(wav)

      const transcript = await this.runWhisper(input, wav, work)

      job.elapsedMs = this.now() - started
      job.segmentCount = transcript.segments.length
      job.warning =
        job.audioMs !== null
          ? suspiciousDuration({ audioMs: job.audioMs, elapsedMs: job.elapsedMs })
          : null

      // ⛔ 불변 이력. 같은 내용 재기록은 멱등 통과, 다른 내용은 거부된다.
      await this.deps.runs.putRawTranscript(input.jobId, {
        source_id: input.sourceId,
        capture_mode: input.captureMode,
        language: transcript.language,
        audio_ms: job.audioMs,
        segments: transcript.segments,
      })

      job.state = transition(
        'transcriptionJob',
        'transcribing',
        'completed'
      ) as TranscriptionJobState

      return { job, transcript }
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e)
      job.retryable = e instanceof TranscriptionError ? e.retryable : true
      // 실패는 언제나 failed_retryable로 간다 — 머신에 있는 유일한 실패 상태다.
      // "다시 해도 소용없음"은 retryable 플래그가 전한다.
      job.state = transition(
        'transcriptionJob',
        'transcribing',
        'failed_retryable'
      ) as TranscriptionJobState
      return { job, transcript: null }
    } finally {
      // 작업 파일은 지운다. 원본 조각과 transcript.raw.json은 남는다.
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async prepareAudio(
    input: TranscribeInput,
    work: string
  ): Promise<string> {
    await fs.mkdir(work, { recursive: true })

    const mic = input.chunkFiles.mic ?? []
    if (mic.length === 0) {
      throw new TranscriptionError('mic track 조각이 없어 전사할 수 없다.', false)
    }
    const micRaw = path.join(work, 'mic.webm')
    await concatChunks(mic, micRaw)

    let remoteRaw: string | null = null
    const remote = input.chunkFiles.remote ?? []
    if (remote.length > 0) {
      remoteRaw = path.join(work, 'remote.webm')
      await concatChunks(remote, remoteRaw)
    }

    if (input.captureMode === 'online' && !remoteRaw) {
      // 화자 분리를 기대했는데 채널이 하나뿐이다. 조용히 모노로 전사하면
      // 담당자 필드가 통째로 비어 나오고, 이유를 아무도 모른다.
      throw new TranscriptionError(
        '온라인 모드인데 remote track 조각이 없다. 화자 분리를 할 수 없으므로 전사하지 않는다.',
        false
      )
    }

    const wav = path.join(work, 'input.wav')
    const args = buildFfmpegArgs({
      captureMode: input.captureMode,
      micPath: micRaw,
      remotePath: remoteRaw,
      outPath: wav,
    })
    const r = await this.deps.run(this.ffmpegBin, args, { timeoutMs: 10 * 60_000 })
    if (r.code !== 0) {
      throw new TranscriptionError(
        `오디오 변환에 실패했다 (ffmpeg ${r.code}): ${tail(r.stderr)}`,
        true
      )
    }
    return wav
  }

  private async probeDuration(wav: string): Promise<number | null> {
    try {
      const r = await this.deps.run(this.ffprobeBin, buildFfprobeArgs(wav))
      return r.code === 0 ? parseFfprobeDuration(r.stdout) : null
    } catch {
      // 길이를 못 재는 것은 전사를 막을 이유가 아니다. 기준선 비교만 못 한다.
      return null
    }
  }

  private async runWhisper(
    input: TranscribeInput,
    wav: string,
    work: string
  ): Promise<ParsedTranscript> {
    const outPrefix = path.join(work, 'out')
    const args = buildWhisperArgs({
      modelPath: this.deps.modelPath,
      audioPath: wav,
      outPrefix,
      captureMode: input.captureMode,
      vocabulary: input.vocabulary,
    })

    const r = await this.deps.run(this.whisperBin, args, {
      // 30분 회의 ≈ 2분(실측 외삽). 넉넉히 잡되 무한정 매달리지 않는다.
      timeoutMs: 30 * 60_000,
    })
    if (r.code !== 0) {
      throw new TranscriptionError(
        `전사 실행에 실패했다 (whisper-cli ${r.code}): ${tail(r.stderr)}`,
        true
      )
    }

    let raw: string
    try {
      raw = await fs.readFile(`${outPrefix}.json`, 'utf8')
    } catch {
      throw new TranscriptionError(
        'whisper가 JSON 출력을 만들지 않았다. `-oj`가 빠졌거나 쓰기에 실패했다.',
        true
      )
    }
    return parseWhisperJson(raw)
  }
}

function tail(s: string, n = 300): string {
  const t = s.trim()
  return t.length <= n ? t : `…${t.slice(-n)}`
}
