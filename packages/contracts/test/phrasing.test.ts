import { describe, expect, it } from 'vitest'
import {
  SOURCE_STATES,
  TRANSCRIPTION_JOB_STATES,
  UPLOAD_HEALTHS,
} from '../src/state.ts'
import {
  PHRASE_PLACEHOLDER,
  type StateRef,
  describeState,
  isPlaceholderPhrase,
  nextActionFor,
} from '../src/phrasing.ts'

describe('⛔ 어느 객체의 상태인지 추적할 수 있다', () => {
  // PLAN.md 순서 3 완료 조건 1.
  // technical-foundation 5절: 다섯 상태 머신을 하나로 합치지 않는다.
  // 문구 매핑도 머신 이름 없이는 부를 수 없어야 한다.

  it('머신 이름 없이 문구를 얻을 수 없다 — 타입이 막는다', () => {
    // @ts-expect-error 머신 이름이 필수다
    expect(() => describeState({ state: 'queued' })).toThrow()
  })

  it('결과가 어느 머신의 상태인지 밝힌다', () => {
    const p = describeState({ machine: 'transcriptionJob', state: 'queued' })
    expect(p.machine).toBe('transcriptionJob')
    expect(p.state).toBe('queued')
  })

  it('⛔ 같은 이름의 상태가 머신마다 다른 문구를 갖는다', () => {
    // `queued`는 transcription_job에도 document_run에도 있다.
    // 하나로 합치면 "전사 대기"와 "정리 대기"를 구분할 수 없다.
    const t = describeState({ machine: 'transcriptionJob', state: 'queued' })
    const d = describeState({ machine: 'documentRun', state: 'queued' })
    expect(t.label).not.toBe(d.label)
  })

  it('⛔ failed_retryable도 머신마다 다르다', () => {
    const up = describeState({ machine: 'upload', state: 'failed_retryable' })
    const tr = describeState({
      machine: 'transcriptionJob',
      state: 'failed_retryable',
    })
    expect(up.label).not.toBe(tr.label)
  })

  it('알 수 없는 조합은 던진다 — 조용히 빈 문구를 내지 않는다', () => {
    // 타입이 먼저 막지만, 런타임에도 막아야 한다. 서버 응답처럼 타입 밖에서
    // 들어온 값은 컴파일러가 걸러주지 않는다.
    const smuggled = { machine: 'source', state: 'transcribing' } as unknown as StateRef
    expect(() => describeState(smuggled)).toThrow(/source/)
  })
})

describe('모든 상태에 문구가 있다', () => {
  it.each(SOURCE_STATES)('source.%s', (state) => {
    expect(describeState({ machine: 'source', state }).label).toMatch(/[가-힣]/)
  })

  it.each(UPLOAD_HEALTHS)('upload.%s', (state) => {
    expect(describeState({ machine: 'upload', state }).label).toMatch(/[가-힣]/)
  })

  it.each(TRANSCRIPTION_JOB_STATES)('transcriptionJob.%s', (state) => {
    expect(describeState({ machine: 'transcriptionJob', state }).label).toMatch(
      /[가-힣]/
    )
  })
})

describe('⛔ 확정되지 않은 문구를 확정된 것처럼 쓰지 않는다', () => {
  // 화면 계약: "최종 문구는 미확정이므로 placeholder를 명시적으로 표시하고
  // 임의로 확정하지 않는다."
  //
  // placeholder를 그냥 그럴듯한 한국어로 적어두면, 다음 사람이 이미 정해진
  // 문구로 읽고 그대로 출시한다. 기계가 읽을 수 있는 표시가 필요하다.

  it('미확정 문구는 표시가 붙는다', () => {
    const p = describeState({ machine: 'documentRun', state: 'waiting_for_model' })
    expect(p.provisional).toBe(true)
  })

  it('미확정 문구를 판별할 수 있다', () => {
    const p = describeState({ machine: 'documentRun', state: 'waiting_for_model' })
    expect(isPlaceholderPhrase(p)).toBe(true)
  })

  it('확정된 문구는 표시가 없다', () => {
    const p = describeState({ machine: 'transcriptionJob', state: 'transcribing' })
    expect(p.provisional).toBe(false)
    expect(isPlaceholderPhrase(p)).toBe(false)
  })

  it('placeholder 표시 문자열이 노출된다 — 화면이 시각적으로 구분할 수 있게', () => {
    expect(PHRASE_PLACEHOLDER).toBeTruthy()
  })
})

describe('다음 조작 — 재접속 시 무엇을 할 수 있는지', () => {
  // PLAN.md 순서 3 완료 조건 3:
  // "브라우저를 닫았다가 다시 열면 같은 source의 현재 상태와 **다음 조작**이 표시된다"

  it('업로드가 끊겼으면 재개를 제안한다', () => {
    const a = nextActionFor({ machine: 'upload', state: 'interrupted' })
    expect(a?.kind).toBe('resume_upload')
    expect(a?.label).toMatch(/[가-힣]/)
  })

  it('전사가 실패했으면 재시도를 제안한다', () => {
    expect(
      nextActionFor({ machine: 'transcriptionJob', state: 'failed_retryable' })?.kind
    ).toBe('retry_transcription')
  })

  it('전사가 끝났으면 교정으로 넘어간다', () => {
    expect(
      nextActionFor({ machine: 'transcriptionJob', state: 'completed' })?.kind
    ).toBe('open_transcript_review')
  })

  it('source가 ready면 전사를 시작할 수 있다', () => {
    expect(nextActionFor({ machine: 'source', state: 'ready' })?.kind).toBe(
      'start_transcription'
    )
  })

  it('⛔ ready 이전 source에는 전사 시작 조작이 없다', () => {
    // technical-foundation 5절: ready 이전 source는 job을 만들지 못한다.
    expect(nextActionFor({ machine: 'source', state: 'capturing' })?.kind).not.toBe(
      'start_transcription'
    )
  })

  it('진행 중일 때는 기다리는 것 말고 할 게 없다', () => {
    expect(nextActionFor({ machine: 'transcriptionJob', state: 'transcribing' })).toBeNull()
  })
})

describe('⛔ source 상태와 job 상태가 섞이지 않는다', () => {
  // PLAN.md 순서 3: "source의 finalizing·ready와 job의 queued·transcribing·
  // completed·failed_retryable이 섞이지 않는다"

  it('두 머신의 상태 집합이 겹치지 않는다', () => {
    const overlap = SOURCE_STATES.filter((s) =>
      (TRANSCRIPTION_JOB_STATES as readonly string[]).includes(s)
    )
    expect(overlap).toEqual([])
  })

  it('같은 화면에 둘을 함께 보여줘도 각각의 머신이 붙어 나온다', () => {
    const refs: StateRef[] = [
      { machine: 'source', state: 'ready' },
      { machine: 'transcriptionJob', state: 'transcribing' },
    ]
    const described = refs.map(describeState)
    expect(described.map((d) => d.machine)).toEqual(['source', 'transcriptionJob'])
    expect(new Set(described.map((d) => d.label)).size).toBe(2)
  })
})
