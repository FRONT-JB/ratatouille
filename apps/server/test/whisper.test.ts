import { describe, expect, it } from 'vitest'
import {
  WHISPER_BASELINE,
  buildPromptInjection,
  buildWhisperArgs,
  parseWhisperJson,
  suspiciousDuration,
} from '../src/transcription/whisper.ts'

const base = {
  modelPath: '/m/ggml-large-v3-turbo.bin',
  audioPath: '/a/in.wav',
  outPrefix: '/o/out',
}

describe('명령 구성 — Phase 0에서 확정한 설정', () => {
  it('한국어를 명시한다 — 자동 감지에 맡기지 않는다', () => {
    expect(buildWhisperArgs(base)).toContain('-l')
    expect(buildWhisperArgs(base)).toContain('ko')
  })

  it('⛔ timestamp가 담긴 JSON을 요구한다', () => {
    // timestamp는 review-contract.md의 하드 계약이다.
    // "timestamp를 누르면 해당 음성을 바로 들을 수 있어야 한다"
    expect(buildWhisperArgs(base)).toContain('-oj')
  })

  it('모델과 입력 파일을 넘긴다', () => {
    const a = buildWhisperArgs(base)
    expect(a[a.indexOf('-m') + 1]).toBe(base.modelPath)
    expect(a[a.indexOf('-f') + 1]).toBe(base.audioPath)
  })

  it('출력 경로를 지정한다 — 입력 옆에 흘리지 않는다', () => {
    const a = buildWhisperArgs(base)
    expect(a[a.indexOf('-of') + 1]).toBe(base.outPrefix)
  })
})

describe('⛔ 화자 분리를 쓰지 않는다 (2026-08-06 범위 변경)', () => {
  /*
   * 접은 이유 — 실측(src_msgszcix, 58.6초 온라인 회의, 같은 모델):
   *
   *   stereo join + `-di`  → 7 세그먼트(평균 8.4초), **전부 speaker 1**
   *   dynaudnorm + mono    → 15 세그먼트(평균 3.9초)
   *
   * 화자 분리는 **동작하지 않았다**. 마이크가 탭보다 28.7 dB 작아서 좌채널이
   * 거의 무음이었기 때문이다(0.5c의 98.2%는 음량이 맞는 합성 오디오였다).
   * 그 대가로 타임라인이 8초 덩어리로 뭉개졌다. 8초짜리 덩어리는 어디를
   * 고쳐야 할지 짚을 수 없어 재교정과 timestamp jump 양쪽을 망친다.
   *
   * ⚠️ 되돌릴 수 있다. mic·remote 조각은 track별로 그대로 보존된다.
   */

  it('-di를 붙이지 않는다', () => {
    expect(buildWhisperArgs(base)).not.toContain('-di')
  })

  it('⛔ tinydiarize(-tdrz)도 쓰지 않는다 — 영어 전용이다', () => {
    // Phase 0.5c에서 확인. 한국어에 붙이면 조용히 이상한 결과가 나온다.
    expect(buildWhisperArgs(base)).not.toContain('-tdrz')
  })

  it('⛔ 입력 모드로 화자 분리를 되살릴 수 없다 — 옵션 자체가 없다', () => {
    // `captureMode`를 지웠다. 남겨두면 "온라인일 때만 켜자"가 언제든 돌아온다.
    expect(Object.keys(base)).not.toContain('captureMode')
  })
})

describe('고유명사 주입 — Phase 0.5e (57.1% → 90.0%)', () => {
  it('용어가 있으면 --prompt로 넘긴다', () => {
    const a = buildWhisperArgs({ ...base, vocabulary: ['한결', 'PG 계약서'] })
    expect(a).toContain('--prompt')
    expect(a[a.indexOf('--prompt') + 1]).toContain('한결')
  })

  it('⛔ 긴 오디오에서도 유지되도록 carry-initial-prompt를 함께 준다', () => {
    // 안 주면 프롬프트가 첫 구간에만 적용되고, 30분 회의 뒷부분에서
    // 다시 고유명사가 깨진다.
    const a = buildWhisperArgs({ ...base, vocabulary: ['한결'] })
    expect(a).toContain('--carry-initial-prompt')
  })

  it('용어가 없으면 프롬프트를 붙이지 않는다', () => {
    expect(buildWhisperArgs(base)).not.toContain('--prompt')
  })

  it('빈 문자열과 공백만 있는 항목은 버린다', () => {
    expect(buildPromptInjection(['', '  ', '한결'])).toBe('한결')
  })

  it('전부 비면 null이다', () => {
    expect(buildPromptInjection(['', '   '])).toBeNull()
  })

  it('중복을 지운다', () => {
    expect(buildPromptInjection(['한결', '한결', 'PG'])).toBe('한결, PG')
  })

  it('⛔ 프롬프트가 너무 길면 자른다 — whisper의 컨텍스트를 잡아먹는다', () => {
    const many = Array.from({ length: 200 }, (_, i) => `용어${i}`)
    const p = buildPromptInjection(many)!
    expect(p.length).toBeLessThanOrEqual(400)
  })
})

describe('출력 파싱', () => {
  const raw = JSON.stringify({
    systeminfo: 'Metal',
    model: { type: 'large' },
    result: { language: 'ko' },
    transcription: [
      {
        timestamps: { from: '00:00:00,000', to: '00:00:04,120' },
        offsets: { from: 0, to: 4120 },
        text: ' 결제 모듈 오픈을 연기합니다.',
      },
      {
        timestamps: { from: '00:00:04,120', to: '00:00:08,000' },
        offsets: { from: 4120, to: 8000 },
        text: ' 3월 16일로 하죠.',
        speaker: '1',
      },
    ],
  })

  it('세그먼트를 뽑아낸다', () => {
    expect(parseWhisperJson(raw).segments.length).toBe(2)
  })

  it('⛔ timestamp를 밀리초로 보존한다', () => {
    const s = parseWhisperJson(raw).segments[0]!
    expect(s.startMs).toBe(0)
    expect(s.endMs).toBe(4120)
  })

  it('앞뒤 공백을 정리한다 — whisper는 항상 공백을 붙인다', () => {
    expect(parseWhisperJson(raw).segments[0]!.text).toBe('결제 모듈 오픈을 연기합니다.')
  })

  it('⛔ 세그먼트 ID를 순번으로 부여한다 — evidence 인용의 기준이다', () => {
    expect(parseWhisperJson(raw).segments.map((s) => s.id)).toEqual(['seg_0', 'seg_1'])
  })

  it('화자 라벨이 있으면 남기고 없으면 null이다', () => {
    const segs = parseWhisperJson(raw).segments
    expect(segs[0]!.speaker).toBeNull()
    expect(segs[1]!.speaker).toBe('1')
  })

  it('감지된 언어를 남긴다', () => {
    expect(parseWhisperJson(raw).language).toBe('ko')
  })

  it('빈 텍스트 세그먼트는 버린다', () => {
    const empty = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 100 }, text: '   ' },
        { offsets: { from: 100, to: 200 }, text: '있음' },
      ],
    })
    expect(parseWhisperJson(empty).segments.length).toBe(1)
  })

  it('망가진 JSON은 무엇이 문제인지 말한다', () => {
    expect(() => parseWhisperJson('{ 깨짐')).toThrow(/whisper/)
  })

  it('transcription 배열이 없으면 던진다 — 빈 전사로 넘어가지 않는다', () => {
    expect(() => parseWhisperJson('{"result":{}}')).toThrow(/transcription/)
  })

  it('세그먼트가 0개면 던진다 — 무음 파일을 성공으로 치지 않는다', () => {
    expect(() => parseWhisperJson('{"transcription":[]}')).toThrow(/세그먼트/)
  })
})

describe('실측 기준선에서 벗어나면 의심한다', () => {
  // Phase 0.5: 507초 오디오 → 34.9초 (14.5x 실시간), 피크 1.98GB.
  // 크게 벗어나면 Metal이 안 붙었거나 잘못된 모델을 쓰는 것이다.

  it('기준선이 기록되어 있다', () => {
    expect(WHISPER_BASELINE.realtimeFactor).toBeGreaterThan(10)
  })

  it('정상 범위는 의심하지 않는다', () => {
    // 507초 오디오를 35초에 처리
    expect(suspiciousDuration({ audioMs: 507_000, elapsedMs: 35_000 })).toBeNull()
  })

  it('⛔ 너무 느리면 알려준다 — Metal이 안 붙었을 수 있다', () => {
    // 507초를 300초에 (1.7x) — CPU 폴백 의심
    const w = suspiciousDuration({ audioMs: 507_000, elapsedMs: 300_000 })
    expect(w).toMatch(/느|Metal|CPU/)
  })

  it('너무 빠르면 알려준다 — 오디오가 잘렸을 수 있다', () => {
    const w = suspiciousDuration({ audioMs: 507_000, elapsedMs: 500 })
    expect(w).toMatch(/빠|잘/)
  })

  it('오디오 길이를 모르면 판단하지 않는다', () => {
    expect(suspiciousDuration({ audioMs: 0, elapsedMs: 1000 })).toBeNull()
  })
})
