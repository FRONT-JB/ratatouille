/**
 * 전사 입력 오디오.
 *
 * ⛔ **이 파일은 뒤늦게 생겼다.** `buildFfmpegArgs`는 「온라인은 반드시 스테레오
 *    좌/우 분리」라는 가장 강한 불변식을 주석으로만 지키고 있었고 테스트가
 *    하나도 없었다. 그 사이 실제 회의에서는 그 방식이 화자를 못 가르면서
 *    타임라인만 뭉개고 있었는데, 아무 테스트도 깨지지 않았다.
 *    **주석으로 지키는 계약은 지켜지지 않는다.**
 */

import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs, parseFfprobeDuration } from '../src/transcription/audio.ts'

const args = (over: Partial<Parameters<typeof buildFfmpegArgs>[0]> = {}) =>
  buildFfmpegArgs({
    captureMode: 'in_person',
    micPath: '/m.raw',
    outPath: '/out.wav',
    ...over,
  })

describe('whisper가 읽을 수 있는 형식', () => {
  it('16kHz PCM 모노다', () => {
    const a = args()
    expect(a[a.indexOf('-ar') + 1]).toBe('16000')
    expect(a[a.indexOf('-ac') + 1]).toBe('1')
    expect(a).toContain('pcm_s16le')
  })

  it('온라인 모드도 모노로 나온다', () => {
    const a = args({ captureMode: 'online', remotePath: '/r.raw' })
    expect(a[a.indexOf('-ac') + 1]).toBe('1')
  })
})

describe('⛔ 화자 분리를 위한 채널 분리를 하지 않는다 (2026-08-06 범위 변경)', () => {
  /*
   * 실측(src_msgszcix, 58.6초 온라인 회의, 같은 모델):
   *   stereo join + `-di` → 7 세그먼트(평균 8.4초), **전부 speaker 1**
   *   dynaudnorm + mono   → 15 세그먼트(평균 3.9초)
   *
   * 마이크가 탭보다 28.7 dB 작아 좌채널이 거의 무음이었다. 화자는 못 가르면서
   * 타임라인만 8초 덩어리로 뭉갰다.
   */

  it('온라인 모드에서 join(채널 분리)을 쓰지 않는다', () => {
    const a = args({ captureMode: 'online', remotePath: '/r.raw' })
    expect(a.join(' ')).not.toContain('join=inputs')
  })

  it('두 track을 섞는다', () => {
    const a = args({ captureMode: 'online', remotePath: '/r.raw' })
    expect(a.join(' ')).toContain('amix=inputs=2')
  })
})

describe('⛔ 섞기 전에 음량을 맞춘다', () => {
  // 안 맞추면 작은 쪽 발화가 전사에서 통째로 빠진다.
  // 실측: 마이크 mean −48.7 dB / 탭 −20.0 dB.

  it('두 입력 각각에 건다 — 섞은 뒤에 걸면 묻힌 소리는 안 돌아온다', () => {
    const a = args({ captureMode: 'online', remotePath: '/r.raw' })
    const filter = a[a.indexOf('-filter_complex') + 1]!
    expect(filter.match(/dynaudnorm/g)).toHaveLength(2)
    expect(filter.indexOf('dynaudnorm')).toBeLessThan(filter.indexOf('amix'))
  })

  it('track이 하나뿐인 대면 모드에도 건다 — 작게 녹음된 마이크는 똑같이 문제다', () => {
    expect(args().join(' ')).toContain('dynaudnorm')
  })
})

describe('탭 조각이 없는 온라인', () => {
  it('있는 track만 쓴다 — 인자 조립에서 터지지 않는다', () => {
    // "상대 목소리 없는 전사를 만들지 않는다"는 판단은 runner가 한다.
    // 인자 조립기가 대신 판단하면 두 곳에서 다른 결론이 날 수 있다.
    const a = args({ captureMode: 'online', remotePath: null })
    expect(a.join(' ')).not.toContain('amix')
    expect(a).toContain('/m.raw')
  })
})

describe('길이 파싱', () => {
  it('초를 밀리초로 바꾼다', () => {
    expect(parseFfprobeDuration('58.619\n')).toBe(58619)
  })

  it('읽을 수 없으면 null — 0으로 지어내지 않는다', () => {
    expect(parseFfprobeDuration('N/A')).toBeNull()
    expect(parseFfprobeDuration('')).toBeNull()
  })
})
