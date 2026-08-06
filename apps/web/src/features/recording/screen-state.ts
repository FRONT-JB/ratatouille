/**
 * 녹음 중 화면의 상태 파생 — PLAN.md 순서 2.
 *
 * 화면 계약 두 가지를 여기서 지킨다.
 *
 * 1. **마이크 단절과 탭 오디오 단절을 서로 다르게 표시한다.**
 *    "입력 오류" 하나로 뭉치면 무엇을 고쳐야 할지 알 수 없다. 탭 공유가 끊긴 것과
 *    마이크가 뽑힌 것은 대처가 완전히 다르다.
 *
 * 2. **녹음 상태와 원본 보존 상태를 분리한다.**
 *    타이머가 돌아간다고 조각이 저장된 것은 아니다. 하나로 합치면 저장이
 *    실패해도 사용자는 녹음이 잘 되고 있다고 믿는다.
 *
 * 이 모듈은 순수 함수다. 컴포넌트가 판단을 갖지 않게 해서, 8종 상태를 브라우저
 * 없이도 전부 검증할 수 있다.
 */

import type { TrackKind } from '@ratatouille/contracts'
import type { MicPermission } from './start-gate'

export const RECORDING_SCREEN_STATES = [
  'permission_prompt',
  'permission_denied',
  'ready',
  'recording',
  'paused',
  'track_lost',
  'saving',
  'stop_failed',
] as const
export type RecordingScreenState = (typeof RECORDING_SCREEN_STATES)[number]

/**
 * track 하나의 건강 상태.
 *
 * `absent`(대면 모드의 탭 track)와 `lost`(있어야 하는데 끊김)를 구분한다.
 * 합치면 대면 녹음 내내 탭 경고가 뜬다.
 */
export type TrackHealth = 'live' | 'silent' | 'lost' | 'absent'

export type TrackAlert = {
  track: TrackKind
  /** `lost`는 track이 끝난 것, `silent`는 살아 있는데 소리가 없는 것 */
  kind: 'lost' | 'silent'
}

export type RecordingPhase = 'idle' | 'recording' | 'paused' | 'stopping'

export type RecordingInput = {
  phase: RecordingPhase
  micPermission: MicPermission
  tracks: Record<'mic' | 'remote', TrackHealth>
  elapsedMs: number
  /** MediaRecorder가 만들어낸 조각 수 */
  chunksCaptured: number
  /** IndexedDB에 실제로 들어간 조각 수 */
  chunksPersisted: number
  /** 서버가 받았다고 확인한 조각 수 */
  chunksUploaded: number
  /** navigator.storage.persist() 결과 */
  storagePersisted: boolean
  /**
   * 시작 gate가 막고 있는지 (`canStartRecording`의 결과).
   *
   * ⛔ 여기서 gate 규칙을 다시 판정하지 않는다. 두 곳에서 판정하면 반드시
   *    갈라진다 — 실제로 갈라져서, 온라인 모드에 탭 track이 없는데도
   *    시작 버튼이 남아 있었다.
   */
  startBlocked: boolean
  stopError: string | null
}

type PreservationLevel = 'empty' | 'at_risk' | 'local_only' | 'safe'

export type Preservation = {
  level: PreservationLevel
  savedChunks: number
  /** 아직 로컬에도 못 쓴 조각 — 지금 브라우저가 죽으면 사라진다 */
  pendingChunks: number
  /** 로컬에는 있지만 서버에 없는 조각 */
  unuploadedChunks: number
  warning: string | null
}

export type RecordingControls = {
  canStart: boolean
  canPause: boolean
  canResume: boolean
  canStop: boolean
}

export type RecordingScreen = {
  screenState: RecordingScreenState
  trackAlerts: TrackAlert[]
  preservation: Preservation
  elapsedLabel: string
  controls: RecordingControls
}

export function deriveScreen(input: RecordingInput): RecordingScreen {
  const trackAlerts = deriveTrackAlerts(input.tracks)
  return {
    screenState: deriveScreenState(input, trackAlerts),
    trackAlerts,
    preservation: derivePreservation(input),
    elapsedLabel: formatElapsed(input.elapsedMs),
    controls: deriveControls(input),
  }
}

function deriveTrackAlerts(tracks: RecordingInput['tracks']): TrackAlert[] {
  const out: TrackAlert[] = []
  // 순서를 고정한다 — 경고가 매 렌더마다 자리를 바꾸면 읽기 어렵다
  for (const track of ['mic', 'remote'] as const) {
    const health = tracks[track]
    if (health === 'lost') out.push({ track, kind: 'lost' })
    else if (health === 'silent') out.push({ track, kind: 'silent' })
  }
  return out
}

function deriveScreenState(
  input: RecordingInput,
  alerts: TrackAlert[]
): RecordingScreenState {
  if (input.stopError) return 'stop_failed'
  if (input.phase === 'stopping') return 'saving'
  if (input.phase === 'idle') {
    if (input.micPermission === 'denied') return 'permission_denied'
    if (input.micPermission === 'prompt') return 'permission_prompt'
    return 'ready'
  }
  // 녹음이 도는 중에 입력이 끊긴 것은 그 자체로 화면 상태다.
  // 사용자가 즉시 알아채야 하므로 녹음 중 표시에 묻히면 안 된다.
  if (alerts.length > 0) return 'track_lost'
  return input.phase === 'paused' ? 'paused' : 'recording'
}

function derivePreservation(input: RecordingInput): Preservation {
  const pendingChunks = Math.max(0, input.chunksCaptured - input.chunksPersisted)
  const unuploadedChunks = Math.max(0, input.chunksPersisted - input.chunksUploaded)

  if (input.chunksCaptured === 0) {
    return {
      level: 'empty',
      savedChunks: 0,
      pendingChunks: 0,
      unuploadedChunks: 0,
      warning: null,
    }
  }

  const base = { savedChunks: input.chunksPersisted, pendingChunks, unuploadedChunks }

  if (pendingChunks > 0) {
    return {
      ...base,
      level: 'at_risk',
      warning: `${pendingChunks}개 조각이 아직 저장되지 않았습니다.`,
    }
  }

  // persist() 없이 IndexedDB에만 있는 것은 안전하지 않다. 브라우저가
  // 용량 압박을 받으면 통째로 버릴 수 있다 (Phase 0에서 persist()를 필수로 정한 이유).
  if (!input.storagePersisted && unuploadedChunks > 0) {
    return {
      ...base,
      level: 'at_risk',
      warning:
        '저장소 보관 권한이 없어 브라우저가 녹음을 삭제할 수 있습니다. 업로드가 끝날 때까지 탭을 닫지 마세요.',
    }
  }

  if (unuploadedChunks > 0) {
    return {
      ...base,
      level: 'local_only',
      warning: `${unuploadedChunks}개 조각이 이 브라우저에만 있습니다.`,
    }
  }

  return { ...base, level: 'safe', warning: null }
}

function deriveControls(input: RecordingInput): RecordingControls {
  if (input.phase === 'stopping' || input.stopError) {
    return { canStart: false, canPause: false, canResume: false, canStop: false }
  }
  if (input.phase === 'idle') {
    return {
      canStart: !input.startBlocked,
      canPause: false,
      canResume: false,
      canStop: false,
    }
  }
  return {
    canStart: false,
    canPause: input.phase === 'recording',
    canResume: input.phase === 'paused',
    // 입력이 끊겨도 종료는 열어둔다. 지금까지 녹음한 것을 살려야 한다.
    canStop: true,
  }
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function describeScreenState(s: RecordingScreenState): string {
  switch (s) {
    case 'permission_prompt':
      return '마이크 권한이 필요합니다'
    case 'permission_denied':
      return '마이크 권한이 거부되었습니다'
    case 'ready':
      return '녹음 준비됨'
    case 'recording':
      return '녹음 중'
    case 'paused':
      return '일시정지'
    case 'track_lost':
      return '입력이 끊겼습니다'
    case 'saving':
      return '저장 중'
    case 'stop_failed':
      return '종료하지 못했습니다'
  }
}

export function describeTrackAlert(a: TrackAlert): string {
  if (a.track === 'mic') {
    return a.kind === 'lost'
      ? '마이크 입력이 끊겼습니다. 장치 연결을 확인해 주세요.'
      : '마이크에서 소리가 들어오지 않습니다. 음소거 상태인지 확인해 주세요.'
  }
  return a.kind === 'lost'
    ? '탭 오디오 공유가 중단되었습니다. 상대방 목소리가 녹음되지 않습니다.'
    : '탭 오디오에 소리가 없습니다. 공유한 탭이 맞는지 확인해 주세요.'
}
