import { describe, expect, it } from 'vitest'
import {
  RECORDING_SCREEN_STATES,
  type RecordingInput,
  deriveScreen,
  describeScreenState,
  describeTrackAlert,
} from './screen-state'

const recording: RecordingInput = {
  phase: 'recording',
  micPermission: 'granted',
  tracks: { mic: 'live', remote: 'absent' },
  elapsedMs: 12_000,
  chunksCaptured: 2,
  chunksPersisted: 2,
  chunksUploaded: 1,
  storagePersisted: true,
  startBlocked: false,
  stopError: null,
}

describe('화면 상태 8종 — 하나의 화면 계약 안에 있다', () => {
  it('8종이 전부 정의되어 있다', () => {
    expect(RECORDING_SCREEN_STATES).toHaveLength(8)
  })

  it('각 상태에 한국어 문구가 있다', () => {
    for (const s of RECORDING_SCREEN_STATES) {
      expect(describeScreenState(s)).toMatch(/[가-힣]/)
    }
  })

  it.each([
    ['권한 요청 전', { phase: 'idle', micPermission: 'prompt' }, 'permission_prompt'],
    ['권한 거부', { phase: 'idle', micPermission: 'denied' }, 'permission_denied'],
    ['녹음 준비', { phase: 'idle', micPermission: 'granted' }, 'ready'],
    ['녹음 중', { phase: 'recording' }, 'recording'],
    ['일시정지', { phase: 'paused' }, 'paused'],
    ['저장 중', { phase: 'stopping' }, 'saving'],
  ])('%s', (_label, patch, expected) => {
    expect(deriveScreen({ ...recording, ...(patch as object) }).screenState).toBe(
      expected
    )
  })

  it('종료 실패', () => {
    expect(
      deriveScreen({ ...recording, phase: 'stopping', stopError: '업로드 실패' })
        .screenState
    ).toBe('stop_failed')
  })

  it('입력 단절', () => {
    expect(
      deriveScreen({ ...recording, tracks: { mic: 'lost', remote: 'absent' } })
        .screenState
    ).toBe('track_lost')
  })
})

describe('⛔ 마이크 단절과 탭 오디오 단절을 서로 다르게 표시한다', () => {
  // PLAN.md 순서 2 완료 조건 3.
  // 둘을 "입력 오류" 하나로 뭉치면 사용자가 무엇을 고쳐야 할지 알 수 없다.
  // 탭 공유가 끊긴 것과 마이크가 뽑힌 것은 대처가 완전히 다르다.

  it('마이크만 끊기면 마이크 경고가 뜬다', () => {
    const s = deriveScreen({ ...recording, tracks: { mic: 'lost', remote: 'live' } })
    expect(s.trackAlerts).toEqual([{ track: 'mic', kind: 'lost' }])
  })

  it('탭 오디오만 끊기면 탭 경고가 뜬다', () => {
    const s = deriveScreen({ ...recording, tracks: { mic: 'live', remote: 'lost' } })
    expect(s.trackAlerts).toEqual([{ track: 'remote', kind: 'lost' }])
  })

  it('두 경고의 문구가 서로 다르다', () => {
    const mic = describeTrackAlert({ track: 'mic', kind: 'lost' })
    const remote = describeTrackAlert({ track: 'remote', kind: 'lost' })
    expect(mic).not.toBe(remote)
    expect(mic).toMatch(/마이크/)
    expect(remote).toMatch(/탭/)
  })

  it('둘 다 끊기면 경고가 둘 다 뜬다 — 하나로 합치지 않는다', () => {
    const s = deriveScreen({ ...recording, tracks: { mic: 'lost', remote: 'lost' } })
    expect(s.trackAlerts.map((a) => a.track)).toEqual(['mic', 'remote'])
  })

  it('무음이 이어지면 끊김과 구분해서 경고한다', () => {
    // 탭 공유는 살아 있는데 소리가 안 들어오는 경우. track이 끝난 것과 다르다.
    const s = deriveScreen({ ...recording, tracks: { mic: 'live', remote: 'silent' } })
    expect(s.trackAlerts).toEqual([{ track: 'remote', kind: 'silent' }])
    expect(describeTrackAlert({ track: 'remote', kind: 'silent' })).not.toBe(
      describeTrackAlert({ track: 'remote', kind: 'lost' })
    )
  })

  it('대면 모드에서 탭 track이 없는 것은 경고가 아니다', () => {
    const s = deriveScreen({ ...recording, tracks: { mic: 'live', remote: 'absent' } })
    expect(s.trackAlerts).toEqual([])
  })

  it('정상이면 경고가 없다', () => {
    expect(
      deriveScreen({ ...recording, tracks: { mic: 'live', remote: 'live' } }).trackAlerts
    ).toEqual([])
  })
})

describe('⛔ 녹음 상태와 원본 보존 상태는 별개다', () => {
  // PLAN.md 순서 2 완료 조건 4.
  // "녹음 중"과 "원본이 안전하게 남았다"는 다른 사실이다. 타이머가 돌아간다고
  // 조각이 저장된 것은 아니다. 하나로 합치면 저장에 실패해도 사용자는
  // 녹음이 잘 되고 있다고 믿는다.

  it('두 상태가 다른 필드로 나온다', () => {
    const s = deriveScreen(recording)
    expect(s.screenState).toBe('recording')
    expect(s.preservation).toBeDefined()
    expect(s.preservation.savedChunks).toBe(2)
  })

  it('녹음 중이어도 저장이 뒤처지면 보존 상태가 그걸 드러낸다', () => {
    const s = deriveScreen({ ...recording, chunksCaptured: 10, chunksPersisted: 3 })
    expect(s.screenState).toBe('recording')
    expect(s.preservation.level).toBe('at_risk')
    expect(s.preservation.pendingChunks).toBe(7)
  })

  it('로컬에 다 저장됐지만 업로드가 남았으면 그것도 구분한다', () => {
    const s = deriveScreen({
      ...recording,
      chunksCaptured: 10,
      chunksPersisted: 10,
      chunksUploaded: 4,
    })
    expect(s.preservation.level).toBe('local_only')
    expect(s.preservation.unuploadedChunks).toBe(6)
  })

  it('전부 업로드되면 안전하다', () => {
    const s = deriveScreen({
      ...recording,
      chunksCaptured: 10,
      chunksPersisted: 10,
      chunksUploaded: 10,
    })
    expect(s.preservation.level).toBe('safe')
  })

  it('⛔ 저장소 영속 권한이 없으면 로컬 저장을 안전으로 치지 않는다', () => {
    // navigator.storage.persist()가 거부되면 브라우저가 용량 압박 시
    // IndexedDB를 통째로 버릴 수 있다. Phase 0에서 persist()를 필수로 정한 이유다.
    const s = deriveScreen({
      ...recording,
      chunksCaptured: 10,
      chunksPersisted: 10,
      chunksUploaded: 0,
      storagePersisted: false,
    })
    expect(s.preservation.level).toBe('at_risk')
    expect(s.preservation.warning).toMatch(/브라우저|삭제|보관/)
  })

  it('아직 아무것도 녹음하지 않았으면 보존 상태가 비어 있다', () => {
    const s = deriveScreen({
      ...recording,
      phase: 'idle',
      chunksCaptured: 0,
      chunksPersisted: 0,
      chunksUploaded: 0,
    })
    expect(s.preservation.level).toBe('empty')
  })
})

describe('타이머', () => {
  it('경과 시간을 분:초로 보여준다', () => {
    expect(deriveScreen({ ...recording, elapsedMs: 65_000 }).elapsedLabel).toBe('01:05')
  })

  it('한 시간을 넘으면 시:분:초로 보여준다', () => {
    expect(deriveScreen({ ...recording, elapsedMs: 3_725_000 }).elapsedLabel).toBe(
      '01:02:05'
    )
  })

  it('일시정지 중에는 시간이 멈춘 것으로 보인다', () => {
    // elapsedMs는 호출자가 멈춘 값을 준다. 여기서 지어내지 않는다.
    expect(deriveScreen({ ...recording, phase: 'paused', elapsedMs: 30_000 })
      .elapsedLabel).toBe('00:30')
  })
})

describe('조작 가능성', () => {
  it('준비 상태에서는 시작만 가능하다', () => {
    const s = deriveScreen({ ...recording, phase: 'idle' })
    expect(s.controls).toEqual({ canStart: true, canPause: false, canResume: false, canStop: false })
  })

  it('녹음 중에는 일시정지와 종료가 가능하다', () => {
    const s = deriveScreen(recording)
    expect(s.controls).toEqual({ canStart: false, canPause: true, canResume: false, canStop: true })
  })

  it('일시정지 중에는 재개와 종료가 가능하다', () => {
    const s = deriveScreen({ ...recording, phase: 'paused' })
    expect(s.controls).toEqual({ canStart: false, canPause: false, canResume: true, canStop: true })
  })

  it('저장 중에는 아무것도 누를 수 없다', () => {
    const s = deriveScreen({ ...recording, phase: 'stopping' })
    expect(Object.values(s.controls).every((v) => v === false)).toBe(true)
  })

  it('⛔ 입력이 끊겨도 종료는 가능하다 — 지금까지 녹음한 것을 살려야 한다', () => {
    const s = deriveScreen({ ...recording, tracks: { mic: 'lost', remote: 'absent' } })
    expect(s.controls.canStop).toBe(true)
  })

  it('권한이 거부되면 시작할 수 없다', () => {
    const s = deriveScreen({
      ...recording,
      phase: 'idle',
      micPermission: 'denied',
      startBlocked: true,
    })
    expect(s.controls.canStart).toBe(false)
  })

  it('⛔ gate가 막고 있으면 시작할 수 없다 — 판정을 두 번 하지 않는다', () => {
    // 온라인 모드에 탭 track이 없는 경우. 마이크 권한은 멀쩡하다.
    // 여기서 gate 규칙을 다시 짜면 두 판정이 갈라진다.
    const s = deriveScreen({
      ...recording,
      phase: 'idle',
      micPermission: 'granted',
      startBlocked: true,
    })
    expect(s.controls.canStart).toBe(false)
  })
})
