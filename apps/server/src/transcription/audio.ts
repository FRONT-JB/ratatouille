/**
 * 조각 → whisper 입력 오디오.
 *
 * 두 가지를 한다.
 *   1. 조각을 순번대로 이어 붙인다 (MediaRecorder 한 세션의 조각은 연속 스트림이다)
 *   2. `ffmpeg`으로 16kHz PCM WAV로 바꾼다 — whisper.cpp가 요구하는 형식
 *
 * ⛔ 온라인 모드는 mic·remote를 **스테레오 좌/우 채널**로 합친다.
 *    Phase 0.5c 실측: `whisper-cli -di`는 채널로 화자를 가른다(정확도 98.2%).
 *    두 track을 섞어(mix) 모노로 만들면 화자 분리가 **원리적으로 불가능**해진다.
 *    이건 취향이 아니라 `-di`가 동작하기 위한 전제다.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { CaptureMode, TrackKind } from '@ratatouille/contracts'

/** whisper.cpp가 요구하는 샘플레이트 */
export const WHISPER_SAMPLE_RATE = 16_000

export type TrackChunks = {
  track: TrackKind
  /** 순번 오름차순 파일 경로 */
  files: string[]
}

/**
 * ffmpeg 인자를 만든다.
 *
 * 대면(단일 track) → 모노 16kHz.
 * 온라인(두 track) → 스테레오 16kHz, mic=좌 / remote=우.
 */
export function buildFfmpegArgs(input: {
  captureMode: CaptureMode
  micPath: string
  remotePath?: string | null
  outPath: string
}): string[] {
  const stereo =
    input.captureMode === 'online' && Boolean(input.remotePath)

  if (!stereo) {
    return [
      '-y',
      '-i',
      input.micPath,
      '-ar',
      String(WHISPER_SAMPLE_RATE),
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      input.outPath,
    ]
  }

  return [
    '-y',
    '-i',
    input.micPath,
    '-i',
    input.remotePath!,
    // ⛔ amix가 아니라 join이다. amix는 두 소리를 섞어 모노로 만들고,
    //    그러면 -di가 화자를 가를 채널이 사라진다.
    '-filter_complex',
    '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]',
    '-map',
    '[a]',
    '-ar',
    String(WHISPER_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    input.outPath,
  ]
}

/**
 * 조각 파일들을 하나로 잇는다.
 *
 * MediaRecorder가 한 세션에서 낸 조각은 이어 붙이면 그대로 재생 가능한
 * 스트림이 된다(첫 조각에 헤더가 있다). 그래서 바이트 연결로 충분하다.
 *
 * ⛔ 순번 순서를 신뢰하지 않고 호출자가 정렬해 넘겨야 한다. 파일명 정렬은
 *    `10`이 `9`보다 앞에 오는 문제가 있다.
 */
export async function concatChunks(files: string[], outPath: string): Promise<number> {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  const handle = await fs.open(outPath, 'w')
  let bytes = 0
  try {
    for (const f of files) {
      const buf = await fs.readFile(f)
      await handle.write(buf)
      bytes += buf.byteLength
    }
  } finally {
    await handle.close()
  }
  if (bytes === 0) {
    throw new Error('이어붙일 조각이 없다. 전사할 오디오가 존재하지 않는다.')
  }
  return bytes
}

/** `ffprobe`로 길이를 잰다. 기준선 비교와 진행률에 쓴다. */
export function buildFfprobeArgs(filePath: string): string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]
}

export function parseFfprobeDuration(stdout: string): number | null {
  const n = Number.parseFloat(stdout.trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null
}
