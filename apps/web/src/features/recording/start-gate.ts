/**
 * 녹음 시작 gate — PLAN.md 순서 2.
 *
 * ⛔ 화면 계약: "**탭 track 없이 온라인 모드를 시작하려 하면 녹음이 시작되지 않고
 *    경고가 표시된다.**"
 *
 * 이 판정을 컴포넌트 안에 두지 않는 이유: 시작 버튼을 비활성화하는 것만으로는
 * 부족하다. 단축키·복원된 세션·프로그램적 호출 등 다른 경로로도 시작될 수 있다.
 * `buildManifest`가 같은 판정을 다시 확인해서, gate를 우회한 시작은 manifest
 * 생성 단계에서 실패한다.
 */

import type { CaptureMode, RecordingManifest, TrackKind } from '@ratatouille/contracts'

/** Phase 0.2 실측으로 확정 */
export const CHUNK_DURATION_MS = 5000

export type MicPermission = 'granted' | 'denied' | 'prompt'

export type StartSelection = {
  captureMode: CaptureMode
  micDeviceId: string | null
  micDeviceLabel: string | null
  micPermission: MicPermission
  /** 온라인 모드에서 사용자가 탭 오디오 공유를 실제로 허용했는지 */
  remoteTrackSelected: boolean
  remoteTrackLabel: string | null
}

export type StartBlocker =
  | 'online_requires_remote'
  | 'mic_permission_missing'
  | 'mic_permission_denied'
  | 'mic_device_missing'

export type StartGateResult = {
  canStart: boolean
  /** 막는 이유 **전부**. 하나씩 알려주면 사용자가 여러 번 되돌아온다. */
  blockers: StartBlocker[]
}

export function canStartRecording(sel: StartSelection): StartGateResult {
  const blockers: StartBlocker[] = []

  if (sel.micPermission === 'denied') blockers.push('mic_permission_denied')
  else if (sel.micPermission === 'prompt') blockers.push('mic_permission_missing')

  // 권한이 없으면 장치 목록 자체를 열거할 수 없다. 이때 "마이크를 선택하세요"를
  // 함께 띄우면 지금 할 수 없는 일을 하라고 요구하는 셈이다.
  // 독립된 문제만 한꺼번에 보여준다 — 파생된 것은 원인이 풀리면 사라진다.
  if (sel.micPermission === 'granted' && !sel.micDeviceId) {
    blockers.push('mic_device_missing')
  }

  // 온라인 회의에서 탭 오디오가 없으면 상대방 목소리가 통째로 빠진다.
  // 그 사실은 전사가 끝난 뒤에야 드러나므로 여기서 막는다.
  if (sel.captureMode === 'online' && !sel.remoteTrackSelected) {
    blockers.push('online_requires_remote')
  }

  return { canStart: blockers.length === 0, blockers }
}

export function describeBlocker(b: StartBlocker): string {
  switch (b) {
    case 'online_requires_remote':
      return '온라인 모드는 탭 오디오가 필요합니다. 지금 시작하면 상대방 목소리가 녹음되지 않습니다.'
    case 'mic_permission_missing':
      return '마이크 권한을 아직 요청하지 않았습니다.'
    case 'mic_permission_denied':
      return '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.'
    case 'mic_device_missing':
      return '사용할 마이크를 선택해 주세요.'
  }
}

/**
 * manifest를 만든다 — **시작 시점에** 기록한다.
 *
 * `expectedChunks`는 비워둔다. 몇 조각이 나올지는 종료 시점에야 알 수 있고,
 * 미리 추정치를 넣으면 그 값이 검증 기준으로 쓰여 멀쩡한 녹음을 불완전으로
 * 판정한다.
 */
export function buildManifest(
  sel: StartSelection,
  meta: { sourceId: string; startedAt: string }
): RecordingManifest {
  const gate = canStartRecording(sel)
  if (!gate.canStart) {
    throw new Error(
      `시작할 수 없는 선택으로 manifest를 만들 수 없다: ${gate.blockers.join(', ')}`
    )
  }

  const tracks: TrackKind[] = sel.remoteTrackSelected ? ['mic', 'remote'] : ['mic']
  const devices: Partial<Record<TrackKind, string>> = {}
  if (sel.micDeviceLabel) devices.mic = sel.micDeviceLabel
  if (sel.remoteTrackLabel) devices.remote = sel.remoteTrackLabel

  return {
    sourceId: meta.sourceId,
    captureMode: sel.captureMode,
    startedAt: meta.startedAt,
    devices,
    tracks,
    expectedChunks: {},
    pauses: [],
    chunkDurationMs: CHUNK_DURATION_MS,
  }
}
