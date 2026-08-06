/**
 * 재생용 오디오를 만들고 캐시한다.
 *
 * ⛔ **매 요청마다 인코딩하지 않는다.** 30분 녹음이면 재생 버튼을 누를 때마다
 *    기다리게 된다. 한 번 만들어 두고 다시 쓴다.
 *
 * ⛔ **실패한 결과를 캐시에 남기지 않는다.** 임시 파일에 쓰고 성공했을 때만
 *    rename한다. 반쪽 파일이 캐시에 앉으면 "재생은 되는데 소리가 없다"가
 *    되고 원인을 찾을 수 없다.
 *
 * ⚠️ 캐시는 파생물이다. 지워도 조각에서 다시 만들 수 있다.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { CaptureMode, TrackKind } from '@ratatouille/contracts'
import { concatChunks } from '../transcription/audio.ts'
import { PLAYBACK_EXT, buildPlaybackArgs } from './args.ts'

export class AudioUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioUnavailableError'
  }
}

export type SpawnLike = (
  bin: string,
  args: string[],
  opts: { stdio: ['ignore', 'pipe', 'pipe'] }
) => ChildProcess

export type PublisherDeps = {
  /** 완성된 재생용 파일이 사는 곳 */
  cacheRoot: string
  /** 이어붙인 원본과 임시 출력이 잠깐 머무는 곳 */
  workRoot: string
  ffmpegBin?: string
  spawnFn?: SpawnLike
  /** 인코딩 제한 시간. 30분 녹음도 넉넉히 들어간다 */
  timeoutMs?: number
}

export type SourceAudioInput = {
  captureMode: CaptureMode
  chunks: Partial<Record<TrackKind, string[]>>
}

export class AudioPublisher {
  /** 진행 중인 인코딩. 같은 source를 두 번 인코딩하지 않는다. */
  private readonly inFlight = new Map<string, Promise<string>>()

  constructor(private readonly deps: PublisherDeps) {}

  pathOf(sourceId: string): string {
    return path.join(this.deps.cacheRoot, `${sourceId}${PLAYBACK_EXT}`)
  }

  /** 재생용 파일 경로. 없으면 만든다. */
  async ensure(sourceId: string, input: SourceAudioInput): Promise<string> {
    const out = this.pathOf(sourceId)
    try {
      await fs.access(out)
      return out
    } catch {
      // 없으면 만든다
    }

    const running = this.inFlight.get(sourceId)
    if (running) return running

    const job = this.encode(sourceId, input, out).finally(() => {
      this.inFlight.delete(sourceId)
    })
    this.inFlight.set(sourceId, job)
    return job
  }

  /** 캐시를 버린다. 조각에서 다시 만들 수 있으므로 잃는 것이 없다. */
  async invalidate(sourceId: string): Promise<void> {
    await fs.rm(this.pathOf(sourceId), { force: true })
  }

  private async encode(
    sourceId: string,
    input: SourceAudioInput,
    out: string
  ): Promise<string> {
    const work = path.join(this.deps.workRoot, `audio-${sourceId}`)
    await fs.mkdir(work, { recursive: true })
    await fs.mkdir(this.deps.cacheRoot, { recursive: true })

    // 성공했을 때만 캐시 자리로 옮긴다
    const tmp = path.join(work, `out${PLAYBACK_EXT}`)

    try {
      if (!input.chunks.mic?.length) {
        throw new AudioUnavailableError(
          '재생할 조각이 없습니다. 이 회의에는 저장된 오디오가 없습니다.'
        )
      }
      const micRaw = path.join(work, 'mic.raw')
      await concatChunks(input.chunks.mic, micRaw)

      let remoteRaw: string | null = null
      if (input.chunks.remote?.length) {
        remoteRaw = path.join(work, 'remote.raw')
        await concatChunks(input.chunks.remote, remoteRaw)
      }

      await this.run(
        buildPlaybackArgs({
          captureMode: input.captureMode,
          micPath: micRaw,
          remotePath: remoteRaw,
          outPath: tmp,
        })
      )
      await fs.rename(tmp, out)
      return out
    } finally {
      // 이어붙인 원본과 임시 출력은 남길 이유가 없다. 조각이 원본이다.
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private run(args: string[]): Promise<void> {
    const spawnFn = this.deps.spawnFn ?? (spawn as unknown as SpawnLike)
    const timeoutMs = this.deps.timeoutMs ?? 10 * 60_000

    return new Promise((resolve, reject) => {
      const child = spawnFn(this.deps.ffmpegBin ?? 'ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }

      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL')
          reject(
            new AudioUnavailableError(
              `재생용 오디오 변환이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`
            )
          )
        })
      }, timeoutMs)

      child.stderr?.on('data', (d) => {
        stderr += String(d)
      })
      child.on('error', (e) =>
        finish(() => reject(new AudioUnavailableError(`ffmpeg을 실행하지 못했습니다: ${e.message}`)))
      )
      child.on('close', (code) =>
        finish(() =>
          code === 0
            ? resolve()
            : reject(
                new AudioUnavailableError(
                  `재생용 오디오 변환이 실패했습니다 (종료 코드 ${code}). ${stderr.slice(0, 200)}`
                )
              )
        )
      )
    })
  }
}
