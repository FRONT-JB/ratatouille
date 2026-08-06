/**
 * 회의가 지금 어느 단계인가 — 여러 머신을 가로지르는 판단.
 *
 * ⛔ **이 판단은 여기 한 곳에만 있다.** 실제로 서버와 사이드바가 각자 판단했고,
 *    사이드바는 전사 job만 보다가 **확정된 회의에도 「교정 전」을 띄웠다.**
 *    서버는 `transcript_approved`를 보내고 있었는데도 그랬다.
 *
 * 각 머신 안의 전이는 `state.ts`가, 객체 사이의 선행 조건은 `rules.ts`가 본다.
 * 여기는 "그래서 사용자가 지금 뭘 해야 하나"만 답한다.
 */

import { describe, expect, it } from 'vitest'
import { meetingStage, nextActionForMeeting } from '../src/stage.ts'
import type { MeetingStates } from '../src/stage.ts'

const at = (over: Partial<MeetingStates> = {}): MeetingStates => ({
  sourceState: 'ready',
  jobState: 'completed',
  jobRetryable: true,
  revisionState: 'transcript_approved',
  documentRunState: null,
  ...over,
})

describe('단계 판정', () => {
  it('녹음 중이면 source 단계다', () => {
    expect(meetingStage(at({ sourceState: 'capturing' }))).toEqual({
      machine: 'source',
      state: 'capturing',
    })
  })

  it('전사가 아직 없으면 source가 ready인 단계다 — 다음은 전사 시작', () => {
    expect(meetingStage(at({ jobState: null, revisionState: null }))).toEqual({
      machine: 'source',
      state: 'ready',
    })
  })

  it('전사 중이면 job 단계다', () => {
    expect(
      meetingStage(at({ jobState: 'transcribing', revisionState: null }))
    ).toEqual({ machine: 'transcriptionJob', state: 'transcribing' })
  })

  it('교정 중이면 revision 단계다', () => {
    expect(meetingStage(at({ revisionState: 'transcript_reviewing' }))).toEqual({
      machine: 'transcriptRevision',
      state: 'transcript_reviewing',
    })
  })

  it('⛔ 확정했으면 더 이상 전사 job 단계가 아니다 — 사이드바 결함의 원인', () => {
    // job은 여전히 `completed`다. 그것만 보면 영원히 "교정 전"이다.
    const stage = meetingStage(at({ jobState: 'completed' }))
    expect(stage.machine).not.toBe('transcriptionJob')
    expect(stage).toEqual({
      machine: 'transcriptRevision',
      state: 'transcript_approved',
    })
  })

  it('정리가 돌기 시작하면 documentRun 단계다', () => {
    expect(meetingStage(at({ documentRunState: 'documenting' }))).toEqual({
      machine: 'documentRun',
      state: 'documenting',
    })
  })

  it('정리가 끝났으면 검수 단계다', () => {
    expect(meetingStage(at({ documentRunState: 'proposed' }))).toEqual({
      machine: 'documentRun',
      state: 'proposed',
    })
  })
})

describe('⛔ 없는 필드가 상태 이름 자리에 앉지 않는다', () => {
  // 이 값들은 HTTP로 건너온다. 서버가 아직 그 필드를 안 보내는 판본이면
  // `undefined`가 오고, `=== null`만 보면 그것이 그대로 상태가 되어
  // `describeState`가 "'undefined' 상태가 없다"로 터진다. 실제로 터졌다.
  const partial = { sourceState: 'ready', jobState: 'completed' } as MeetingStates

  it('교정·정리 상태가 아예 없어도 살아 있는 단계를 낸다', () => {
    expect(meetingStage(partial)).toEqual({
      machine: 'transcriptionJob',
      state: 'completed',
    })
  })

  it('빈 객체를 줘도 터지지 않는다', () => {
    expect(meetingStage({} as MeetingStates).machine).toBe('source')
  })
})

describe('다음 조작', () => {
  it('녹음 중에는 할 게 없다 — 없는 버튼을 지어내지 않는다', () => {
    expect(nextActionForMeeting(at({ sourceState: 'capturing' }))).toBeNull()
  })

  it('원본이 준비되면 전사 시작', () => {
    expect(nextActionForMeeting(at({ jobState: null, revisionState: null }))?.kind).toBe(
      'start_transcription'
    )
  })

  it('전사가 끝나면 교정하기', () => {
    expect(
      nextActionForMeeting(at({ revisionState: 'transcript_reviewing' }))?.kind
    ).toBe('open_transcript_review')
  })

  it('⛔ 확정한 뒤에는 「전사 교정하기」가 아니라 「AI 정리 시작」이다', () => {
    expect(nextActionForMeeting(at())).toEqual({
      kind: 'start_documentation',
      label: 'AI 정리 시작',
    })
  })

  it('정리가 끝나면 검수하기', () => {
    expect(nextActionForMeeting(at({ documentRunState: 'proposed' }))?.kind).toBe(
      'open_document_review'
    )
  })

  it('정리가 도는 중에는 할 게 없다', () => {
    expect(nextActionForMeeting(at({ documentRunState: 'documenting' }))).toBeNull()
  })

  it('⛔ 정리 실패의 재시도는 전사 재시도와 다른 조작이다', () => {
    // 두 조작을 같은 kind로 두면 화면이 엉뚱한 것을 다시 돌린다.
    expect(
      nextActionForMeeting(at({ documentRunState: 'failed_retryable' }))?.kind
    ).toBe('retry_documentation')
  })

  it('재시도해도 소용없는 전사 실패에는 조작을 주지 않는다', () => {
    expect(
      nextActionForMeeting(
        at({ jobState: 'failed_retryable', jobRetryable: false, revisionState: null })
      )
    ).toBeNull()
  })
})
