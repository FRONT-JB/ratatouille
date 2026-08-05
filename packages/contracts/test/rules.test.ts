import { describe, expect, it } from 'vitest'
import {
  RuleViolationError,
  assertCanCreateDegradedDraft,
  assertCanCreateDocumentRun,
  assertCanCreateTranscriptionJob,
  assertCanOverwriteCurrent,
  assertImmutable,
  openNewRevision,
} from '../src/rules.ts'

describe('규칙 1 — ready 이전 source는 전사 job을 만들지 않는다', () => {
  it('ready면 통과한다', () => {
    expect(() => assertCanCreateTranscriptionJob('ready')).not.toThrow()
  })

  it('capturing·finalizing이면 거부한다', () => {
    expect(() => assertCanCreateTranscriptionJob('capturing')).toThrow(
      RuleViolationError
    )
    expect(() => assertCanCreateTranscriptionJob('finalizing')).toThrow(
      RuleViolationError
    )
  })
})

describe('규칙 2 — document run은 ready + transcript_approved일 때만', () => {
  it('두 조건이 모두 충족되면 통과한다', () => {
    expect(() =>
      assertCanCreateDocumentRun({
        sourceState: 'ready',
        currentRevisionState: 'transcript_approved',
      })
    ).not.toThrow()
  })

  it('전사가 확정되지 않았으면 거부한다 — AI 결과 생성 gate', () => {
    expect(() =>
      assertCanCreateDocumentRun({
        sourceState: 'ready',
        currentRevisionState: 'transcript_reviewing',
      })
    ).toThrow(/transcript_approved/)
  })

  it('source가 ready가 아니면 거부한다', () => {
    expect(() =>
      assertCanCreateDocumentRun({
        sourceState: 'finalizing',
        currentRevisionState: 'transcript_approved',
      })
    ).toThrow(/ready/)
  })
})

describe('규칙 3 — 재편집은 새 revision을 열고 기존 문서를 stale로 만든다', () => {
  it('current 문서만 stale이 된다', () => {
    const r = openNewRevision({
      currentRevisionState: 'transcript_approved',
      documents: ['current', 'reviewing', 'stale'],
    })
    expect(r.newRevisionState).toBe('transcript_reviewing')
    expect(r.documents).toEqual(['stale', 'reviewing', 'stale'])
  })

  it('reviewing 중이던 문서는 건드리지 않는다', () => {
    const r = openNewRevision({
      currentRevisionState: 'transcript_approved',
      documents: ['reviewing'],
    })
    expect(r.documents).toEqual(['reviewing'])
  })

  it('이미 편집 가능한 revision에는 새 revision을 열지 않는다', () => {
    expect(() =>
      openNewRevision({
        currentRevisionState: 'transcript_reviewing',
        documents: [],
      })
    ).toThrow(RuleViolationError)
  })
})

describe('규칙 4 — raw audio·source hash·raw transcript는 불변', () => {
  it('처음 쓰는 것은 허용한다', () => {
    expect(() => assertImmutable('sourceHash', null, 'sha256:abc')).not.toThrow()
    expect(() =>
      assertImmutable('rawTranscript', undefined, 'text')
    ).not.toThrow()
  })

  it('같은 값을 다시 쓰는 것은 허용한다 — 멱등', () => {
    expect(() =>
      assertImmutable('sourceHash', 'sha256:abc', 'sha256:abc')
    ).not.toThrow()
  })

  it('다른 값으로 덮어쓰면 거부한다', () => {
    expect(() =>
      assertImmutable('sourceHash', 'sha256:abc', 'sha256:def')
    ).toThrow(RuleViolationError)
    expect(() => assertImmutable('rawAudio', 'a.webm', 'b.webm')).toThrow(
      /불변/
    )
  })
})

describe('규칙 5 — degraded_draft는 명시적 요청에만', () => {
  it('사용자가 요청하면 허용한다', () => {
    expect(() => assertCanCreateDegradedDraft(true)).not.toThrow()
  })

  it('자동 fallback을 거부한다', () => {
    expect(() => assertCanCreateDegradedDraft(false)).toThrow(
      /자동 fallback이 아니다/
    )
  })
})

describe('규칙 6 — source hash가 일치해야 final Markdown을 덮는다', () => {
  it('hash가 같으면 통과한다', () => {
    expect(() =>
      assertCanOverwriteCurrent({
        reviewedSourceHash: 'sha256:abc',
        currentSourceHash: 'sha256:abc',
      })
    ).not.toThrow()
  })

  it('hash가 다르면 거부한다 — 조용한 덮어쓰기 방지', () => {
    expect(() =>
      assertCanOverwriteCurrent({
        reviewedSourceHash: 'sha256:abc',
        currentSourceHash: 'sha256:xyz',
      })
    ).toThrow(RuleViolationError)
  })
})
