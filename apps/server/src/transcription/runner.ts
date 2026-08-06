/**
 * 전사 실행 — 조각을 오디오로 만들고 `whisper-cli`를 돌린다.
 *
 * `whisper.ts`·`audio.ts`가 **무엇을 실행할지** 정하고, 여기서 **실제로 실행**한다.
 * 나눠 둔 이유: 명령 구성과 출력 파싱은 프로세스를 띄우지 않고 검증할 수 있어야
 * 하고, 이 파일만 실제 바이너리를 요구하게 하려는 것이다.
 *
 * ⛔ Hermes를 거치지 않는다 (`whisper.ts` 머리말 참조).
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { CaptureMode } from '@ratatouille/contracts'
import {
  buildFfmpegArgs,
  buildFfprobeArgs,
  concatChunks,
  parseFfprobeDuration,
} from './audio.ts'
import {
  type ParsedTranscript,
  type WhisperSegment,
  buildWhisperArgs,
  parseWhisperJson,
  suspiciousDuration,
} from './whisper.ts'

export class TranscriptionFailed extends Error {
  constructor(
    message: string,
    /**
     * 다시 시도해서 결과가 달라질 수 있는가.
     *
     * ⛔ 이 판단이 `failed_retryable`과 영구 실패를 가른다. 전부 재시도 가능으로
     *    두면 사용자가 같은 실패를 무한히 반복한다. 반대로 전부 영구 실패로 두면
     *    네트워크·일시적 자원 부족에도 녹음을 버리게 된다.
     */
    readonly retryable: boolean,
    readonly detail = ''
  ) {
    super(message)
    this.name = 'TranscriptionFailed'
  }
}

export type RunnerDeps = {
  whisperBin?: string
  ffmpegBin?: string
  ffprobeBin?: string
  modelPath: string
  /** 실행 시간 상한. 30분 회의는 실측 기준 약 2분이다. */
  timeoutMs?: number
  spawnFn?: typeof spawn
}

export type TranscribeInput = {
  sourceId: string
  captureMode: CaptureMode
  /** track별 조각 파일 경로. 순번 오름차순으로 정렬되어 있어야 한다. */
  chunks: { mic: string[]; remote?: string[] }
  /** 중간 산출물과 결과를 놓을 디렉토리 */
  workDir: string
  /** 참석자·제품명 (Phase 0.5e: 정확도 57.1% → 90.0%) */
  vocabulary?: string[]
  signal?: AbortSignal
}

export type TranscribeResult = ParsedTranscript & {
  /** whisper가 만든 원본 JSON. **불변으로 보존한다** */
  rawJsonPath: string
  audioPath: string
  audioMs: number | null
  elapsedMs: number
  /** 실측 기준선에서 벗어났으면 그 설명. 실패는 아니다 */
  performanceWarning: string | null
}

export class TranscriptionRunner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(input: TranscribeInput): Promise<TranscribeResult> {
    const startedAt = Date.now()
    await fs.mkdir(input.workDir, { recursive: true })

    const audioPath = await this.prepareAudio(input)
    const audioMs = await this.probeDuration(audioPath)

    const outPrefix = path.join(input.workDir, 'transcript.raw')
    const args = buildWhisperArgs({
      modelPath: this.deps.modelPath,
      audioPath,
      outPrefix,
      vocabulary: input.vocabulary,
    })

    await this.exec(this.deps.whisperBin ?? 'whisper-cli', args, {
      signal: input.signal,
      timeoutMs: this.deps.timeoutMs ?? 20 * 60 * 1000,
      what: '전사',
    })

    const rawJsonPath = `${outPrefix}.json`
    let raw: string
    try {
      raw = await fs.readFile(rawJsonPath, 'utf8')
    } catch {
      throw new TranscriptionFailed(
        `전사는 끝났는데 결과 JSON이 없다: ${rawJsonPath}. whisper-cli의 -oj 출력 규칙이 바뀌었을 수 있다.`,
        false
      )
    }

    let parsed: ParsedTranscript
    try {
      parsed = parseWhisperJson(raw)
    } catch (e) {
      // 무음이거나 오디오 변환이 잘못된 경우다. 다시 돌려도 같다.
      throw new TranscriptionFailed(
        e instanceof Error ? e.message : String(e),
        false
      )
    }

    const elapsedMs = Date.now() - startedAt
    return {
      ...parsed,
      rawJsonPath,
      audioPath,
      audioMs,
      elapsedMs,
      performanceWarning:
        audioMs === null ? null : suspiciousDuration({ audioMs, elapsedMs }),
    }
  }

  /** 조각을 잇고 whisper가 읽을 수 있는 WAV로 바꾼다. */
  private async prepareAudio(input: TranscribeInput): Promise<string> {
    const micRaw = path.join(input.workDir, 'mic.raw')
    await concatChunks(input.chunks.mic, micRaw)

    let remoteRaw: string | null = null
    if (input.captureMode === 'online' && input.chunks.remote?.length) {
      remoteRaw = path.join(input.workDir, 'remote.raw')
      await concatChunks(input.chunks.remote, remoteRaw)
    }

    // ⛔ 온라인인데 remote가 없으면 여기서 멈춘다. 그냥 진행하면 상대방
    //    목소리 없는 전사가 "성공"으로 남고, -di도 화자를 가를 수 없다.
    if (input.captureMode === 'online' && !remoteRaw) {
      throw new TranscriptionFailed(
        '온라인 모드인데 탭 오디오 조각이 없다. 상대방 목소리가 빠진 전사를 만들지 않는다.',
        false
      )
    }

    const outPath = path.join(input.workDir, 'audio-16k.wav')
    await this.exec(
      this.deps.ffmpegBin ?? 'ffmpeg',
      buildFfmpegArgs({
        captureMode: input.captureMode,
        micPath: micRaw,
        remotePath: remoteRaw,
        outPath,
      }),
      { signal: input.signal, timeoutMs: 10 * 60 * 1000, what: '오디오 변환' }
    )
    return outPath
  }

  private async probeDuration(audioPath: string): Promise<number | null> {
    try {
      const { stdout } = await this.exec(
        this.deps.ffprobeBin ?? 'ffprobe',
        buildFfprobeArgs(audioPath),
        { timeoutMs: 30_000, what: '길이 측정' }
      )
      return parseFfprobeDuration(stdout)
    } catch {
      // 길이를 몰라도 전사는 할 수 있다. 성능 비교만 포기한다.
      return null
    }
  }

  private exec(
    bin: string,
    args: string[],
    opts: { signal?: AbortSignal; timeoutMs: number; what: string }
  ): Promise<{ stdout: string; stderr: string }> {
    const spawnFn = this.deps.spawnFn ?? spawn

    return new Promise((resolve, reject) => {
      // 이미 취소됐으면 프로세스를 띄우지 않는다. 띄우고 나서 죽이면
      // whisper가 1.6GB 모델을 로드하다 죽는 낭비가 생기고, 종료 코드가
      // 먼저 도착하면 취소가 "실패"로 둔갑한다.
      if (opts.signal?.aborted) {
        reject(new TranscriptionFailed(`${opts.what}이 취소되었다.`, true))
        return
      }

      const child = spawnFn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        fn()
      }

      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL')
          reject(
            new TranscriptionFailed(
              `${opts.what}이 ${Math.round(opts.timeoutMs / 1000)}초 안에 끝나지 않아 중단했다.`,
              // 자원 경합으로 느렸을 수 있다 — 다시 시도할 여지를 남긴다
              true,
              stderr
            )
          )
        })
      }, opts.timeoutMs)

      const onAbort = () => {
        finish(() => {
          child.kill('SIGKILL')
          reject(new TranscriptionFailed(`${opts.what}이 취소되었다.`, true, stderr))
        })
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout?.on('data', (d) => (stdout += d))
      child.stderr?.on('data', (d) => (stderr += d))

      child.on('error', (e) => {
        finish(() =>
          reject(
            new TranscriptionFailed(
              `${bin}을 실행할 수 없다: ${e.message}. 설치되어 있는지 확인한다.`,
              // 바이너리가 없는 것은 재시도로 안 풀린다
              false,
              stderr
            )
          )
        )
      })

      child.on('close', (code) => {
        finish(() => {
          if (code === 0) resolve({ stdout, stderr })
          else
            reject(
              new TranscriptionFailed(
                `${opts.what} 실패 (종료 코드 ${code})`,
                // 종료 코드만으로는 일시적인지 알 수 없다. 재시도를 허용하되
                // stderr를 남겨 사용자가 판단할 수 있게 한다.
                true,
                stderr
              )
            )
        })
      })
    })
  }
}

/**
 * 세그먼트 시각을 evidence용 문자열로 만든다.
 *
 * ⛔ **포맷은 여기 한 곳에서만 만든다.** `verifyEvidence`는 모델이 인용한
 *    timestamp와 원본을 **문자열 완전 일치**로 비교한다(Phase 0 결함 A 대응).
 *    두 군데서 만들면 한쪽이 `00:01:05`, 다른 쪽이 `00:01:05,000`이 되어
 *    멀쩡한 인용이 전부 위반으로 잡힌다.
 *
 * ⛔ **`HH:MM:SS`다. 밀리초를 붙이지 않는다.**
 *    Phase 0 실측에서 모델에게 준 세그먼트도, 모델이 돌려준 인용도 전부
 *    `00:02:27` 형식이었다(`contracts/test/fixtures/meeting-*.json`). 그 조건에서
 *    인용 정확도 22/22·환각 0을 쟀다. 밀리초를 붙이면 그 측정이 무효가 되고
 *    `contracts/evidence.ts`의 `TranscriptSegment.timestamp` 주석과도 어긋난다.
 *    초 단위면 "timestamp를 눌러 그 지점을 재생"하는 데도 충분하다.
 */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60_000) % 60
  const h = Math.floor(total / 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}`
}

export function toEvidenceSegments(
  segments: readonly WhisperSegment[]
): Array<{ id: string; timestamp: string; text: string }> {
  return segments.map((s) => ({
    id: s.id,
    timestamp: formatTimestamp(s.startMs),
    text: s.text,
  }))
}
