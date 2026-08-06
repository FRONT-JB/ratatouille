/**
 * `whisper-cli` 호출 규약 — PLAN.md 순서 3 / Phase 0 실측.
 *
 * ⛔ **Hermes를 경유하지 않는다.** Phase 0.7b에서 Hermes STT 4개 경로
 *    (`local` / `local_command` / 플러그인 ABC / HTTP endpoint)가 **전부
 *    timestamp를 버린다**는 것을 확인했다. `review-contract.md`는
 *    "timestamp를 누르면 해당 음성을 바로 들을 수 있어야 한다"를 요구하므로
 *    타협할 수 없다. Hermes는 Phase 6의 **모델 경계만** 소유한다.
 *
 * 이 파일은 순수 함수만 둔다. 프로세스 실행은 `runner.ts`가 한다 —
 * 명령 구성과 출력 파싱을 실제 실행 없이 검증할 수 있어야 한다.
 */

import type { CaptureMode } from '@ratatouille/contracts'

/** Phase 0.5 실측값. 크게 벗어나면 설정을 의심한다. */
export const WHISPER_BASELINE = {
  audioSeconds: 507,
  elapsedSeconds: 34.9,
  realtimeFactor: 14.5,
  peakRssGb: 1.98,
  backend: 'Metal',
} as const

/** 프롬프트가 whisper 컨텍스트를 잡아먹지 않게 하는 상한 */
const PROMPT_MAX_CHARS = 400

export type WhisperOptions = {
  modelPath: string
  audioPath: string
  /** 확장자 없이. whisper가 `<prefix>.json`을 만든다 */
  outPrefix: string
  captureMode: CaptureMode
  /** 참석자·제품명 등. Phase 0.5e에서 정확도 57.1% → 90.0% */
  vocabulary?: string[]
}

/**
 * 고유명사 주입 문자열을 만든다.
 *
 * Phase 0.5e 실측: `--prompt`로 참석자·제품명을 미리 주면 고유명사 전사
 * 정확도가 57.1%에서 90.0%로 올랐다.
 */
export function buildPromptInjection(vocabulary: string[]): string | null {
  const cleaned = [...new Set(vocabulary.map((v) => v.trim()).filter(Boolean))]
  if (cleaned.length === 0) return null

  let out = ''
  for (const term of cleaned) {
    const next = out ? `${out}, ${term}` : term
    if (next.length > PROMPT_MAX_CHARS) break
    out = next
  }
  return out || null
}

export function buildWhisperArgs(opts: WhisperOptions): string[] {
  const args = [
    '-m',
    opts.modelPath,
    '-f',
    opts.audioPath,
    // 언어를 명시한다. 자동 감지는 짧은 무음 구간에서 틀린다.
    '-l',
    'ko',
    // ⛔ timestamp가 담긴 JSON. 이게 이 파이프라인의 존재 이유다.
    '-oj',
    '-of',
    opts.outPrefix,
  ]

  // ⛔ `-di`는 스테레오 좌/우 채널을 화자로 가른다 (Phase 0.5c, 정확도 98.2%).
  //    mic·remote를 두 채널로 합친 온라인 녹음에서만 의미가 있다.
  //    대면 모드는 단일 채널이라 붙이면 없는 화자를 만들어낸다.
  //    `-tdrz`(tinydiarize)는 **영어 전용**이라 한국어에 쓰지 않는다.
  if (opts.captureMode === 'online') args.push('-di')

  const prompt = buildPromptInjection(opts.vocabulary ?? [])
  if (prompt) {
    args.push('--prompt', prompt)
    // 없으면 프롬프트가 첫 구간에만 먹고 30분 회의 뒷부분에서 다시 깨진다
    args.push('--carry-initial-prompt')
  }

  return args
}

/**
 * whisper가 낸 세그먼트 하나.
 *
 * ⚠️ `contracts/evidence.ts`의 `TranscriptSegment`와 **다른 타입이다.**
 *    이쪽은 밀리초 offset과 화자 라벨을 가진 원본이고, 저쪽은 evidence 대조용
 *    (`timestamp` 문자열 + text)이다. 이름을 같게 두면 어느 쪽인지 모른 채
 *    섞여 쓰이므로 여기서는 `WhisperSegment`로 부른다.
 *    변환은 `runner.toEvidenceSegments` 한 곳에서만 한다.
 */
export type WhisperSegment = {
  id: string
  startMs: number
  endMs: number
  text: string
  /** `-di`가 붙인 채널 화자 라벨. 없으면 null */
  speaker: string | null
}

export type ParsedTranscript = {
  language: string | null
  segments: WhisperSegment[]
}

type WhisperRow = {
  offsets?: { from?: number; to?: number }
  text?: string
  speaker?: string
}

/**
 * `whisper-cli -oj` 출력을 읽는다.
 *
 * ⛔ 빈 결과를 성공으로 넘기지 않는다. 무음 파일이나 잘못된 경로로 0개
 *    세그먼트가 나오면, 그대로 통과시켰을 때 사용자는 "전사 완료"를 보고
 *    빈 화면을 마주한다.
 */
export function parseWhisperJson(raw: string): ParsedTranscript {
  let parsed: { transcription?: WhisperRow[]; result?: { language?: string } }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      'whisper 출력이 JSON이 아니다. `-oj`가 빠졌거나 실행이 중간에 끊겼을 수 있다.'
    )
  }

  if (!Array.isArray(parsed.transcription)) {
    throw new Error('whisper 출력에 transcription 배열이 없다.')
  }

  const segments: WhisperSegment[] = []
  for (const row of parsed.transcription) {
    const text = (row.text ?? '').trim()
    if (!text) continue
    segments.push({
      // 세그먼트 ID는 evidence 인용의 기준이다 (Phase 0 결함 A).
      // 순번으로 매기면 같은 transcript에서 항상 같은 ID가 나온다.
      id: `seg_${segments.length}`,
      startMs: row.offsets?.from ?? 0,
      endMs: row.offsets?.to ?? 0,
      text,
      speaker: row.speaker ?? null,
    })
  }

  if (segments.length === 0) {
    throw new Error(
      '전사 세그먼트가 하나도 없다. 무음이거나 오디오 변환이 잘못됐을 수 있다.'
    )
  }

  return { language: parsed.result?.language ?? null, segments }
}

/**
 * 처리 시간이 실측 기준선에서 크게 벗어났는지.
 *
 * 벗어난다고 실패로 처리하지는 않는다 — 결과는 멀쩡할 수 있다.
 * 다만 조용히 넘기면 몇 달 뒤 "왜 이렇게 느리지"로 돌아온다.
 */
export function suspiciousDuration(m: {
  audioMs: number
  elapsedMs: number
}): string | null {
  if (m.audioMs <= 0 || m.elapsedMs <= 0) return null
  const factor = m.audioMs / m.elapsedMs

  if (factor < 3) {
    return `전사가 기준선보다 느리다 (${factor.toFixed(1)}x, 기준 ${WHISPER_BASELINE.realtimeFactor}x). Metal이 붙지 않고 CPU로 떨어졌을 수 있다.`
  }
  if (factor > 200) {
    return `전사가 비정상적으로 빠르다 (${factor.toFixed(0)}x). 오디오가 잘렸거나 대부분 무음일 수 있다.`
  }
  return null
}
