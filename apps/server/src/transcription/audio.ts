/**
 * 조각 → whisper 입력 오디오.
 *
 * 두 가지를 한다.
 *   1. 조각을 순번대로 이어 붙인다 (MediaRecorder 한 세션의 조각은 연속 스트림이다)
 *   2. `ffmpeg`으로 16kHz PCM WAV로 바꾼다 — whisper.cpp가 요구하는 형식
 *
 * ⛔ **온라인 모드도 모노로 섞는다** — 2026-08-06 범위 변경.
 *
 *    예전에는 mic·remote를 좌/우 채널로 **분리**했다. `whisper-cli -di`가
 *    채널로 화자를 가르기 때문이었고, 0.5c 합성 오디오에서 98.2%가 나왔다.
 *    **실제 회의에서는 동작하지 않았다.** 실측(src_msgszcix, 58.6초):
 *
 *      stereo join + `-di` → 7 세그먼트(평균 8.4초), **전부 speaker 1**
 *      dynaudnorm + mono   → 15 세그먼트(평균 3.9초)
 *
 *    마이크가 탭보다 28.7 dB 작아 좌채널이 거의 무음이었다. 화자는 못 가르면서
 *    타임라인만 8초 덩어리로 뭉갰다. 재교정도 timestamp jump도 8초 덩어리로는
 *    쓸 수 없다.
 *
 * ⛔ 섞기 **전에** track별 음량을 맞춘다. 안 그러면 작은 쪽 발화가 전사에서
 *    통째로 누락된다 — 실제로 위 A안에서 마이크 발화가 거의 잡히지 않았다.
 *
 * ⚠️ 되돌릴 수 있다. mic·remote 조각은 track별로 그대로 보존된다.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { CaptureMode } from '@ratatouille/contracts'

/** whisper.cpp가 요구하는 샘플레이트 */
export const WHISPER_SAMPLE_RATE = 16_000

/**
 * track별 음량 평준화. 재생용(`audio/args.ts`)과 같은 설정을 쓴다.
 *
 * ⛔ 이게 없으면 작은 쪽 track의 발화가 전사에서 통째로 빠진다.
 *    실측: 마이크 mean −48.7 dB / 탭 −20.0 dB.
 */
const LEVEL_MATCH = 'dynaudnorm=f=250:g=15:m=20'

/**
 * ffmpeg 인자를 만든다.
 *
 * 대면(단일 track) → 모노 16kHz.
 * 온라인(두 track) → 음량을 맞춘 뒤 **모노로 섞어** 16kHz.
 */
export function buildFfmpegArgs(input: {
  captureMode: CaptureMode
  micPath: string
  remotePath?: string | null
  outPath: string
}): string[] {
  const both = input.captureMode === 'online' && Boolean(input.remotePath)

  const tail = [
    '-ar',
    String(WHISPER_SAMPLE_RATE),
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    input.outPath,
  ]

  if (!both) {
    return ['-y', '-i', input.micPath, '-af', LEVEL_MATCH, ...tail]
  }

  return [
    '-y',
    '-i',
    input.micPath,
    '-i',
    input.remotePath!,
    '-filter_complex',
    // 음량을 **각각** 맞춘 뒤 섞는다. 섞고 나서 맞추면 이미 묻힌 소리는
    // 돌아오지 않는다.
    `[0:a]${LEVEL_MATCH}[m];[1:a]${LEVEL_MATCH}[r];` +
      '[m][r]amix=inputs=2:duration=longest:dropout_transition=0[a]',
    '-map',
    '[a]',
    ...tail,
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
