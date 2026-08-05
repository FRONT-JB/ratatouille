import { describe, expect, it } from 'vitest'
import {
  InvalidTransitionError,
  canTransition,
  transition,
} from '../src/state.ts'

/**
 * technical-foundation.md 5절 `분리된 처리 상태`의 전이 규칙.
 *
 * 핵심은 개별 전이보다 **머신이 서로 섞이지 않는다**는 점이다.
 * `queued`와 `failed_retryable`는 여러 머신에 등장하므로, 머신 이름 없이
 * 상태만으로 판정하면 조용히 잘못된 전이가 통과한다.
 */
describe('source_state', () => {
  it('capturing → finalizing → ready 순서를 따른다', () => {
    expect(canTransition('source', 'capturing', 'finalizing')).toBe(true)
    expect(canTransition('source', 'finalizing', 'ready')).toBe(true)
  })

  it('capturing에서 ready로 건너뛸 수 없다', () => {
    expect(canTransition('source', 'capturing', 'ready')).toBe(false)
  })

  it('ready는 종착 상태다', () => {
    expect(canTransition('source', 'ready', 'capturing')).toBe(false)
    expect(canTransition('source', 'ready', 'finalizing')).toBe(false)
  })
})

describe('upload_health', () => {
  it('syncing과 synced를 오갈 수 있다', () => {
    expect(canTransition('upload', 'syncing', 'synced')).toBe(true)
    expect(canTransition('upload', 'synced', 'syncing')).toBe(true)
  })

  it('interrupted·failed_retryable에서 syncing으로 복귀한다', () => {
    expect(canTransition('upload', 'interrupted', 'syncing')).toBe(true)
    expect(canTransition('upload', 'failed_retryable', 'syncing')).toBe(true)
  })

  it('interrupted에서 synced로 바로 갈 수 없다 — 재동기화를 거쳐야 한다', () => {
    expect(canTransition('upload', 'interrupted', 'synced')).toBe(false)
  })
})

describe('transcription_job', () => {
  it('queued → transcribing → completed', () => {
    expect(canTransition('transcriptionJob', 'queued', 'transcribing')).toBe(
      true
    )
    expect(
      canTransition('transcriptionJob', 'transcribing', 'completed')
    ).toBe(true)
  })

  it('failed_retryable에서 queued로 재시도한다', () => {
    expect(
      canTransition('transcriptionJob', 'failed_retryable', 'queued')
    ).toBe(true)
  })

  it('completed는 되돌릴 수 없다', () => {
    expect(canTransition('transcriptionJob', 'completed', 'queued')).toBe(false)
    expect(canTransition('transcriptionJob', 'completed', 'transcribing')).toBe(
      false
    )
  })
})

describe('transcript_revision', () => {
  it('transcript_reviewing → transcript_approved', () => {
    expect(
      canTransition(
        'transcriptRevision',
        'transcript_reviewing',
        'transcript_approved'
      )
    ).toBe(true)
  })

  it('확정된 revision을 같은 객체에서 되돌릴 수 없다 — 새 revision을 열어야 한다', () => {
    expect(
      canTransition(
        'transcriptRevision',
        'transcript_approved',
        'transcript_reviewing'
      )
    ).toBe(false)
  })
})

describe('document_run', () => {
  it('queued → documenting → proposed', () => {
    expect(canTransition('documentRun', 'queued', 'documenting')).toBe(true)
    expect(canTransition('documentRun', 'documenting', 'proposed')).toBe(true)
  })

  it('모델 경계 장애 3종이 documenting에서 갈라진다', () => {
    for (const s of [
      'auth_required',
      'waiting_for_model',
      'failed_retryable',
    ]) {
      expect(canTransition('documentRun', 'documenting', s)).toBe(true)
    }
  })

  it('auth_required는 재인증 후 queued로 돌아간다', () => {
    expect(canTransition('documentRun', 'auth_required', 'queued')).toBe(true)
  })

  it('auth_required에서 proposed로 건너뛸 수 없다', () => {
    expect(canTransition('documentRun', 'auth_required', 'proposed')).toBe(
      false
    )
  })
})

describe('document_state', () => {
  it('reviewing → current → stale → reviewing 순환', () => {
    expect(canTransition('document', 'reviewing', 'current')).toBe(true)
    expect(canTransition('document', 'current', 'stale')).toBe(true)
    expect(canTransition('document', 'stale', 'reviewing')).toBe(true)
  })

  it('stale에서 current로 바로 갈 수 없다 — 재검수를 거쳐야 한다', () => {
    expect(canTransition('document', 'stale', 'current')).toBe(false)
  })
})

describe('머신 분리', () => {
  it('같은 이름의 상태가 머신을 넘나들지 않는다', () => {
    // transcription_job의 queued → transcribing 은 유효하지만
    // document_run에는 transcribing이라는 상태가 없다
    expect(canTransition('transcriptionJob', 'queued', 'transcribing')).toBe(
      true
    )
    expect(canTransition('documentRun', 'queued', 'transcribing')).toBe(false)
  })

  it('document_run의 documenting은 transcription_job에 없다', () => {
    expect(canTransition('documentRun', 'queued', 'documenting')).toBe(true)
    expect(canTransition('transcriptionJob', 'queued', 'documenting')).toBe(
      false
    )
  })

  it('source의 ready는 transcription_job의 completed와 다른 개념이다', () => {
    expect(canTransition('source', 'finalizing', 'ready')).toBe(true)
    expect(canTransition('transcriptionJob', 'transcribing', 'ready')).toBe(
      false
    )
  })
})

describe('transition()', () => {
  it('허용된 전이는 대상 상태를 돌려준다', () => {
    expect(transition('source', 'capturing', 'finalizing')).toBe('finalizing')
  })

  it('허용되지 않은 전이는 머신·from·to를 담아 던진다', () => {
    expect(() => transition('source', 'capturing', 'ready')).toThrow(
      InvalidTransitionError
    )
    try {
      transition('source', 'capturing', 'ready')
    } catch (e) {
      const err = e as InvalidTransitionError
      expect(err.machine).toBe('source')
      expect(err.from).toBe('capturing')
      expect(err.to).toBe('ready')
    }
  })

  it('알 수 없는 상태를 거부한다', () => {
    expect(() => transition('source', 'capturing', 'nonsense')).toThrow(
      InvalidTransitionError
    )
  })
})
