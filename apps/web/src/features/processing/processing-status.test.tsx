import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ProcessingStatus } from './processing-status'
import type { SessionSource } from './session'

const phrase = (label: string, over = {}) => ({
  label,
  detail: null,
  provisional: false,
  ...over,
})

const src = (over: Partial<SessionSource> = {}): SessionSource => ({
  sourceId: 'src_01',
  sourceState: 'ready',
  sourcePhrase: phrase('원본 준비됨'),
  chunkCount: 3,
  missing: {},
  captureMode: 'in_person',
  startedAt: null,
  job: null,
  revisionState: null,
  documentRunState: null,
  nextAction: null,
  ...over,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const job = (over: Record<string, unknown> = {}): any => ({
  id: 'tr_01',
  sourceId: 'src_01',
  jobState: 'completed',
  phrase: phrase('전사 완료'),
  nextAction: null,
  retryable: true,
  error: null,
  warning: null,
  audioMs: null,
  elapsedMs: null,
  segmentCount: null,
  ...over,
})

const panel = (c: Element) => c.querySelector('[data-testid=processing-status]')!

describe('⛔ 어느 객체의 상태인지 화면에 드러난다', () => {
  it('수집 중이면 source의 상태다', async () => {
    const s = await render(
      <ProcessingStatus source={src({ sourceState: 'capturing', sourcePhrase: phrase('녹음 중') })} />
    )
    expect(panel(s.container).getAttribute('data-machine')).toBe('source')
    expect(panel(s.container).getAttribute('data-state')).toBe('capturing')
  })

  it('전사 중이면 job의 상태다', async () => {
    const s = await render(
      <ProcessingStatus
        source={src({ job: job({ jobState: 'transcribing', phrase: phrase('전사 중') }) })}
      />
    )
    expect(panel(s.container).getAttribute('data-machine')).toBe('transcriptionJob')
    expect(panel(s.container).getAttribute('data-state')).toBe('transcribing')
  })
})

describe('⛔ 미확정 문구를 확정된 것처럼 보여주지 않는다', () => {
  it('표시가 붙는다', async () => {
    // ⚠️ 문구는 이제 계약 표에서 온다. 그래서 미확정 문구를 **주입**할 수 없고,
    //    실제로 미확정인 상태를 써야 한다 — `documentRun.waiting_for_model`이
    //    그렇다(technical-foundation이 상태 이름만 정했다).
    const s = await render(
      <ProcessingStatus
        source={src({
          job: job({ jobState: 'completed' }),
          revisionState: 'transcript_approved',
          documentRunState: 'waiting_for_model',
        })}
      />
    )
    await expect.element(s.getByTestId('provisional-phrase')).toBeInTheDocument()
  })

  it('확정된 문구에는 표시가 없다', async () => {
    const s = await render(<ProcessingStatus source={src()} />)
    expect(s.container.querySelector('[data-testid=provisional-phrase]')).toBeNull()
  })
})

describe('⛔ 업로드 중과 ready를 구분해 보여준다', () => {
  it('아직 안 올라온 조각을 따로 알려준다', async () => {
    const s = await render(
      <ProcessingStatus
        source={src({
          sourceState: 'finalizing',
          sourcePhrase: phrase('원본 확인 중'),
          chunkCount: 1,
          missing: { mic: [1, 2] },
        })}
      />
    )
    await expect.element(s.getByTestId('missing-chunks')).toHaveTextContent('mic 2개')
  })

  it('ready면 빠진 조각 표시가 없다', async () => {
    const s = await render(<ProcessingStatus source={src()} />)
    expect(s.container.querySelector('[data-testid=missing-chunks]')).toBeNull()
  })

  it('받은 조각 수를 보여준다', async () => {
    const s = await render(<ProcessingStatus source={src({ chunkCount: 7 })} />)
    await expect.element(s.getByTestId('chunk-count')).toHaveTextContent('7개')
  })
})

describe('다음 조작', () => {
  it('버튼으로 나온다', async () => {
    const onAction = vi.fn()
    const s = await render(
      <ProcessingStatus
        source={src({ nextAction: { kind: 'start_transcription', label: '전사 시작' } })}
        onAction={onAction}
      />
    )
    await userEvent.click(s.getByRole('button', { name: '전사 시작' }))
    expect(onAction).toHaveBeenCalledWith({
      kind: 'start_transcription',
      label: '전사 시작',
    })
  })

  it('할 게 없으면 버튼이 없다', async () => {
    const s = await render(
      <ProcessingStatus source={src({ job: job({ jobState: 'transcribing' }) })} />
    )
    expect(s.container.querySelector('button')).toBeNull()
  })

  it('⛔ 재시도해도 소용없는 실패에는 버튼이 없다', async () => {
    // 서버가 nextAction을 null로 준다. 화면이 임의로 만들어내면 안 된다.
    const s = await render(
      <ProcessingStatus
        source={src({
          job: job({ jobState: 'failed_retryable', retryable: false, error: '조각이 없다' }),
          nextAction: null,
        })}
      />
    )
    expect(s.container.querySelector('button')).toBeNull()
  })
})

describe('실패 표시', () => {
  it('오류를 alert로 읽어준다', async () => {
    const s = await render(
      <ProcessingStatus
        source={src({
          job: job({ jobState: 'failed_retryable', error: '전사 실행에 실패했다' }),
        })}
      />
    )
    await expect
      .element(s.getByRole('alert'))
      .toHaveTextContent('전사 실행에 실패했다')
  })

  it('경고는 실패와 구분해 보여준다', async () => {
    const s = await render(
      <ProcessingStatus source={src({ job: job({ warning: 'Metal이 안 붙었을 수 있다' }) })} />
    )
    await expect.element(s.getByText(/Metal/)).toBeInTheDocument()
    // 경고는 alert가 아니다 — 실패가 아니라 참고 사항이다
    expect(s.container.querySelector('[role=alert]')).toBeNull()
  })
})

describe('⛔ 녹음과 업로드가 같은 컴포넌트를 쓴다', () => {
  it('두 경로의 source가 같은 구조로 렌더된다', async () => {
    const recorded = await render(
      <ProcessingStatus source={src({ captureMode: 'in_person' })} />
    )
    const uploaded = await render(<ProcessingStatus source={src({ captureMode: null })} />)

    expect(panel(recorded.container).getAttribute('data-machine')).toBe(
      panel(uploaded.container).getAttribute('data-machine')
    )
  })
})

describe('변화를 스크린리더가 따라온다', () => {
  it('aria-live가 걸려 있다', async () => {
    const s = await render(<ProcessingStatus source={src()} />)
    expect(panel(s.container).getAttribute('aria-live')).toBe('polite')
  })
})
