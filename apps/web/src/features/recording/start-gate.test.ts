import { describe, expect, it } from 'vitest'
import {
  type StartSelection,
  buildManifest,
  canStartRecording,
  describeBlocker,
} from './start-gate'

const base: StartSelection = {
  captureMode: 'in_person',
  micDeviceId: 'mic-1',
  micDeviceLabel: 'MacBook Pro 마이크',
  micPermission: 'granted',
  remoteTrackSelected: false,
  remoteTrackLabel: null,
}

const online: StartSelection = {
  ...base,
  captureMode: 'online',
  remoteTrackSelected: true,
  remoteTrackLabel: 'Chrome 탭 — Google Meet',
}

describe('⛔ 탭 track 없이 온라인 모드를 시작할 수 없다', () => {
  // PLAN.md 순서 2 완료 조건 1.
  // 탭 오디오 없이 시작하면 상대방 목소리가 통째로 빠진 녹음이 남는다.
  // 그 사실은 전사가 끝난 뒤에야 드러나므로 시작 시점에 막아야 한다.

  it('온라인 모드인데 탭 track이 없으면 시작할 수 없다', () => {
    const r = canStartRecording({ ...online, remoteTrackSelected: false })
    expect(r.canStart).toBe(false)
    expect(r.blockers).toContain('online_requires_remote')
  })

  it('막는 이유를 한국어로 설명한다', () => {
    expect(describeBlocker('online_requires_remote')).toMatch(
      /탭|상대방|목소리/
    )
  })

  it('탭 track을 고르면 시작할 수 있다', () => {
    expect(canStartRecording(online).canStart).toBe(true)
  })

  it('대면 모드는 탭 track이 없어도 된다', () => {
    expect(canStartRecording(base).canStart).toBe(true)
  })
})

describe('권한과 장치', () => {
  it('마이크 권한을 아직 안 물었으면 시작할 수 없다', () => {
    const r = canStartRecording({ ...base, micPermission: 'prompt' })
    expect(r.canStart).toBe(false)
    expect(r.blockers).toContain('mic_permission_missing')
  })

  it('마이크 권한이 거부되면 시작할 수 없다', () => {
    const r = canStartRecording({ ...base, micPermission: 'denied' })
    expect(r.blockers).toContain('mic_permission_denied')
  })

  it('권한은 있는데 장치를 고르지 않았으면 시작할 수 없다', () => {
    const r = canStartRecording({ ...base, micDeviceId: null })
    expect(r.blockers).toContain('mic_device_missing')
  })

  it('⛔ 권한이 없을 때는 장치 선택을 요구하지 않는다 — 파생된 문제다', () => {
    // 권한이 없으면 장치 목록을 열거할 수 없다. 이때 "마이크를 선택하세요"를
    // 띄우면 지금 할 수 없는 일을 하라고 요구하는 셈이다.
    const r = canStartRecording({
      ...base,
      micPermission: 'prompt',
      micDeviceId: null,
    })
    expect(r.blockers).toEqual(['mic_permission_missing'])
  })

  it('독립된 이유는 한꺼번에 알려준다 — 하나 고치면 다음 게 나오는 식이 아니다', () => {
    const r = canStartRecording({
      captureMode: 'online',
      micDeviceId: null,
      micDeviceLabel: null,
      micPermission: 'denied',
      remoteTrackSelected: false,
      remoteTrackLabel: null,
    })
    // 권한 거부 + 탭 track 없음. 장치 선택은 권한에서 파생되므로 빠진다.
    expect(r.blockers).toEqual(['mic_permission_denied', 'online_requires_remote'])
  })

  it('모든 blocker에 한국어 설명이 있다', () => {
    const all = [
      'online_requires_remote',
      'mic_permission_missing',
      'mic_permission_denied',
      'mic_device_missing',
    ] as const
    for (const b of all) {
      expect(describeBlocker(b)).toMatch(/[가-힣]/)
    }
  })
})

describe('manifest 생성 — PLAN.md 순서 2 완료 조건 2', () => {
  // "시작된 녹음의 manifest에 입력 모드, 장치, 선택한 track과 시작 시각이 남는다"

  it('입력 모드가 남는다', () => {
    expect(buildManifest(online, { sourceId: 's1', startedAt: 'T' }).captureMode).toBe(
      'online'
    )
  })

  it('장치 라벨이 남는다', () => {
    const m = buildManifest(base, { sourceId: 's1', startedAt: 'T' })
    expect(m.devices.mic).toBe('MacBook Pro 마이크')
  })

  it('선택한 track이 남는다', () => {
    expect(buildManifest(online, { sourceId: 's1', startedAt: 'T' }).tracks).toEqual([
      'mic',
      'remote',
    ])
    expect(buildManifest(base, { sourceId: 's1', startedAt: 'T' }).tracks).toEqual([
      'mic',
    ])
  })

  it('시작 시각이 남는다', () => {
    const m = buildManifest(base, {
      sourceId: 's1',
      startedAt: '2026-08-06T10:00:00+09:00',
    })
    expect(m.startedAt).toBe('2026-08-06T10:00:00+09:00')
  })

  it('탭 track 라벨도 남긴다 — 어느 탭이었는지 나중에 알 수 있어야 한다', () => {
    const m = buildManifest(online, { sourceId: 's1', startedAt: 'T' })
    expect(m.devices.remote).toBe('Chrome 탭 — Google Meet')
  })

  it('Phase 0에서 확정한 조각 길이 5초를 쓴다', () => {
    expect(buildManifest(base, { sourceId: 's1', startedAt: 'T' }).chunkDurationMs).toBe(
      5000
    )
  })

  it('시작 시점에는 조각 수를 모른다 — 종료 시 채운다', () => {
    const m = buildManifest(base, { sourceId: 's1', startedAt: 'T' })
    expect(m.expectedChunks).toEqual({})
  })

  it('⛔ 시작할 수 없는 선택으로는 manifest를 만들지 않는다', () => {
    expect(() =>
      buildManifest(
        { ...online, remoteTrackSelected: false },
        { sourceId: 's1', startedAt: 'T' }
      )
    ).toThrow(/시작할 수 없/)
  })
})
