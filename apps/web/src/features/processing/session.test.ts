import { describe, expect, it } from 'vitest'
import {
  type SessionSource,
  canReviewTranscript,
  fetchSession,
  findSource,
  isProcessing,
  primaryStatus,
} from './session'

const phrase = (label: string) => ({ label, detail: null, provisional: false })

const src = (over: Partial<SessionSource> = {}): SessionSource => ({
  sourceId: 'src_01',
  sourceState: 'ready',
  sourcePhrase: phrase('원본 준비됨'),
  chunkCount: 3,
  missing: {},
  captureMode: 'in_person',
  startedAt: '2026-08-06T10:00:00+09:00',
  job: null,
  revisionState: null,
  documentRunState: null,
  nextAction: null,
  ...over,
})

const job = (over: Record<string, unknown> = {}) =>
  ({
    id: 'tr_01',
    sourceId: 'src_01',
    jobState: 'completed',
    phrase: phrase('전사 완료'),
    nextAction: null,
    retryable: true,
    error: null,
    warning: null,
    audioMs: 507_000,
    elapsedMs: 35_000,
    segmentCount: 153,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

describe('⛔ 녹음 종료와 처리 완료를 혼동하지 않는다', () => {
  it('업로드 중이면 처리 중이다', () => {
    expect(isProcessing(src({ sourceState: 'capturing' }))).toBe(true)
  })

  it('검증 중이면 처리 중이다', () => {
    expect(isProcessing(src({ sourceState: 'finalizing' }))).toBe(true)
  })

  it('⛔ ready인데 전사가 아직이면 여전히 처리 중이다', () => {
    // "녹음이 끝났다"와 "처리가 끝났다"는 다른 사실이다
    expect(isProcessing(src({ sourceState: 'ready', job: null }))).toBe(true)
  })

  it('전사 중이면 처리 중이다', () => {
    expect(isProcessing(src({ job: job({ jobState: 'transcribing' }) }))).toBe(true)
  })

  it('전사가 끝나야 처리가 끝난다', () => {
    expect(isProcessing(src({ job: job() }))).toBe(false)
  })

  it('전사가 실패하면 처리 중이 아니다 — 멈춘 것이지 도는 게 아니다', () => {
    expect(isProcessing(src({ job: job({ jobState: 'failed_retryable' }) }))).toBe(false)
  })
})

describe('교정으로 넘어갈 수 있는 시점', () => {
  it('전사가 완료돼야 열린다', () => {
    expect(canReviewTranscript(src({ job: job() }))).toBe(true)
  })

  it('⛔ 전사 전에는 열리지 않는다', () => {
    expect(canReviewTranscript(src({ job: null }))).toBe(false)
  })

  it('실패한 전사로는 열리지 않는다', () => {
    expect(canReviewTranscript(src({ job: job({ jobState: 'failed_retryable' }) }))).toBe(
      false
    )
  })

  it('ready가 아니면 열리지 않는다', () => {
    expect(
      canReviewTranscript(src({ sourceState: 'finalizing', job: job() }))
    ).toBe(false)
  })
})

describe('⛔ 대표 상태가 어느 머신의 것인지 밝힌다', () => {
  it('아직 수집 중이면 source의 상태다', () => {
    const p = primaryStatus(src({ sourceState: 'capturing' }))
    expect(p.machine).toBe('source')
    expect(p.state).toBe('capturing')
  })

  it('전사가 시작됐으면 job의 상태다', () => {
    const p = primaryStatus(src({ job: job({ jobState: 'transcribing' }) }))
    expect(p.machine).toBe('transcriptionJob')
    expect(p.state).toBe('transcribing')
  })

  it('ready인데 job이 없으면 source의 상태다', () => {
    expect(primaryStatus(src({ job: null })).machine).toBe('source')
  })

  it('문구를 함께 준다 — 화면이 지어내지 않는다', () => {
    expect(primaryStatus(src()).phrase.label).toBe('원본 준비됨')
  })

  it('⛔ 확정한 뒤에는 전사 job의 상태가 아니다', () => {
    // job은 확정 후에도 영원히 `completed`다. 그것만 보면 상세 화면이
    // 계속 "전사 완료 / 전사 교정하기"를 보여준다.
    const p = primaryStatus(
      src({ job: job({ jobState: 'completed' }), revisionState: 'transcript_approved' })
    )
    expect(p.machine).toBe('transcriptRevision')
    expect(p.phrase.label).toBe('전사 확정됨')
  })

  it('정리 결과가 있으면 documentRun의 상태다', () => {
    const p = primaryStatus(
      src({
        job: job({ jobState: 'completed' }),
        revisionState: 'transcript_approved',
        documentRunState: 'proposed',
      })
    )
    expect(p.machine).toBe('documentRun')
    expect(p.phrase.label).toBe('검수 대기')
  })
})

describe('조회', () => {
  it('source를 찾는다', () => {
    const session = { sources: [src()], inProgress: [] }
    expect(findSource(session, 'src_01')?.sourceId).toBe('src_01')
  })

  it('없으면 null이다', () => {
    expect(findSource({ sources: [], inProgress: [] }, 'x')).toBeNull()
  })
})

describe('세션 불러오기', () => {
  it('서버 응답을 그대로 쓴다', async () => {
    const s = await fetchSession(
      async () =>
        new Response(JSON.stringify({ sources: [src()], inProgress: ['src_01'] }), {
          headers: { 'content-type': 'application/json' },
        })
    )
    expect(s.inProgress).toEqual(['src_01'])
  })

  it('실패를 조용히 넘기지 않는다', async () => {
    await expect(
      fetchSession(async () => new Response('nope', { status: 500 }))
    ).rejects.toThrow(/500/)
  })
})
