/**
 * 재생용 오디오의 ffmpeg 인자.
 *
 * ⛔ **전사용(`transcription/audio.ts`)과 의도적으로 다르다.**
 *    전사용은 mic·remote를 **좌/우 채널로 분리**한다 — `whisper-cli -di`가
 *    채널로 화자를 가르기 때문이다(Phase 0.5c, 98.2%). 사람에게 그대로
 *    들려주면 한쪽 귀에는 내 목소리만, 다른 쪽에는 상대 목소리만 나온다.
 *    재생용은 **섞는다.** 같은 함수로 합치려는 유혹을 받으면 이 주석을 읽는다.
 */

import type { CaptureMode } from '@ratatouille/contracts'

/** 재생용 파일 확장자. MP4/AAC는 Chrome·Safari 양쪽에서 탐색이 안정적이다. */
export const PLAYBACK_EXT = '.m4a'

export function buildPlaybackArgs(input: {
  captureMode: CaptureMode
  micPath: string
  remotePath?: string | null
  outPath: string
}): string[] {
  const both = input.captureMode === 'online' && Boolean(input.remotePath)

  const common = [
    '-c:a',
    // ⛔ `copy`가 아니다. 조각 원본(webm)에는 duration도 Cues도 없어서
    //    브라우저가 탐색을 못 한다. timestamp jump가 Phase 5 완료 조건이므로
    //    컨테이너를 새로 만들어야 한다.
    'aac',
    '-b:a',
    // 말소리다. 128k는 과하고 64k면 알아듣는 데 지장이 없다.
    '64k',
    '-movflags',
    // moov를 앞으로. 없으면 파일 전체를 받기 전에는 탐색이 안 된다.
    '+faststart',
    input.outPath,
  ]

  if (!both) {
    return ['-y', '-i', input.micPath, ...common]
  }

  return [
    '-y',
    '-i',
    input.micPath,
    '-i',
    input.remotePath!,
    '-filter_complex',
    // ⛔ 섞기 **전에** 각 track의 음량을 맞춘다. 실측(src_msgszcix)에서 마이크
    //    mean −48.7 dB, 탭 mean −20.0 dB로 29 dB 차이가 났다. 그대로 amix하면
    //    (amix는 입력 수로 나눈다) 내 목소리가 −54 dB가 되어 **안 들린다.**
    //    회의의 절반이 안 들리는 재생기는 근거 확인에 쓸 수 없다.
    //
    // ⚠️ 재생용 오디오는 파생물이다. 원본 조각과 전사 timestamp는 그대로이므로
    //    음량을 만지는 것이 증거를 바꾸지 않는다.
    `[0:a]${LEVEL_MATCH}[m];[1:a]${LEVEL_MATCH}[r];` +
      // `dropout_transition=0`: 한쪽이 끝나도 남은 쪽 음량을 건드리지 않는다.
      '[m][r]amix=inputs=2:duration=longest:dropout_transition=0[a]',
    '-map',
    '[a]',
    ...common,
  ]
}

/**
 * track별 음량 평준화.
 *
 * `loudnorm`이 아니라 `dynaudnorm`인 이유: loudnorm은 제대로 쓰려면 2-pass라
 * 30분 녹음에서 인코딩 시간이 두 배가 된다. 재생용에는 단일 pass로 충분하다.
 *
 * 실측(src_msgszcix, 58.6초 온라인 회의):
 *   mic    mean −48.7 → −29.5 dB (max −18.4 → −0.8)
 *   remote mean −20.0 → −18.2 dB
 *   두 track의 차이 28.7 dB → 11.3 dB.
 *
 * ⚠️ **차이가 0이 되지는 않는다.** dynaudnorm은 창(window)의 peak를 맞추는데,
 *    마이크는 말 사이 무음이 길어 mean이 peak보다 훨씬 낮다. `m`을 30까지
 *    올려도 −28.8 dB로 0.7 dB밖에 안 는다(대신 클리핑에 가까워진다).
 *    작은 쪽이 여전히 조금 작게 들리는 것은 알고 남긴 한계다.
 */
const LEVEL_MATCH = 'dynaudnorm=f=250:g=15:m=20'
