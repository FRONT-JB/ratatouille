import { describe, expect, it } from 'vitest'
import {
  type DocumentProposal,
  type TranscriptSegment,
  canPromoteToProposed,
  describeViolation,
  verifyEvidence,
} from '../src/evidence.ts'
import realProposal from './fixtures/meeting-proposal.json' with { type: 'json' }
import realSegments from './fixtures/meeting-segments.json' with { type: 'json' }

const segments: TranscriptSegment[] = [
  { id: 'seg000', timestamp: '00:00:00', text: '오픈은 3월 16일로 미루죠.' },
  { id: 'seg001', timestamp: '00:00:05', text: '네, 그렇게 가시죠.' },
  { id: 'seg002', timestamp: '00:00:10', text: '계약서는 금요일까지 볼게요.' },
]

function proposalWith(over: Partial<DocumentProposal>): DocumentProposal {
  return {
    summary: { text: '요약', evidence: [] },
    decisions: [],
    tasks: [],
    evidence: [],
    ...over,
  }
}

describe('정상 케이스', () => {
  it('인용이 전부 evidence 배열에 있고 원문과 일치하면 위반이 없다', () => {
    const p = proposalWith({
      summary: { text: '요약', evidence: ['seg000'] },
      decisions: [{ what: '오픈 연기', evidence: ['seg000', 'seg001'] }],
      evidence: [
        { id: 'seg000', timestamp: '00:00:00', quote: '오픈은 3월 16일로 미루죠.' },
        { id: 'seg001', timestamp: '00:00:05', quote: '네, 그렇게 가시죠.' },
      ],
    })
    expect(verifyEvidence(p, segments)).toEqual([])
    expect(canPromoteToProposed(verifyEvidence(p, segments))).toBe(true)
  })
})

describe('결함 A — 인용됐지만 evidence 배열에 없음', () => {
  it('부분집합 규칙 위반을 잡는다', () => {
    const p = proposalWith({
      decisions: [{ what: '오픈 연기', evidence: ['seg000', 'seg001'] }],
      // seg001을 인용했는데 배열에는 seg000만 있다
      evidence: [
        { id: 'seg000', timestamp: '00:00:00', quote: '오픈은 3월 16일로 미루죠.' },
      ],
    })
    const v = verifyEvidence(p, segments)
    expect(v).toContainEqual({
      kind: 'not_in_evidence_array',
      id: 'seg001',
      citedIn: 'decisions[0]',
    })
  })

  it('위반이 있으면 proposed로 승격시키지 않는다', () => {
    const p = proposalWith({
      tasks: [{ action: '계약서 검토', evidence: ['seg002'] }],
      evidence: [],
    })
    expect(canPromoteToProposed(verifyEvidence(p, segments))).toBe(false)
  })

  it('어느 section에서 인용했는지 보고한다', () => {
    const p = proposalWith({
      summary: { text: '요약', evidence: ['seg000'] },
      tasks: [{ action: 'a', evidence: ['seg001'] }, { action: 'b', evidence: ['seg002'] }],
    })
    const v = verifyEvidence(p, segments)
    expect(v.map((x) => 'citedIn' in x && x.citedIn)).toEqual([
      'summary',
      'tasks[0]',
      'tasks[1]',
    ])
  })
})

describe('실재하지 않는 segID', () => {
  it('전사문에 없는 ID 인용을 잡는다', () => {
    const p = proposalWith({
      summary: { text: '요약', evidence: ['seg999'] },
    })
    expect(verifyEvidence(p, segments)).toContainEqual({
      kind: 'unknown_segment',
      id: 'seg999',
      citedIn: 'summary',
    })
  })

  it('없는 ID는 부분집합 위반으로 중복 보고하지 않는다', () => {
    const p = proposalWith({ summary: { text: '요약', evidence: ['seg999'] } })
    const v = verifyEvidence(p, segments)
    expect(v.filter((x) => x.kind === 'not_in_evidence_array')).toHaveLength(0)
  })
})

describe('evidence 배열 자체의 정확도', () => {
  it('timestamp 불일치를 잡는다', () => {
    const p = proposalWith({
      evidence: [
        { id: 'seg000', timestamp: '99:99:99', quote: '오픈은 3월 16일로 미루죠.' },
      ],
    })
    expect(verifyEvidence(p, segments)).toContainEqual({
      kind: 'timestamp_mismatch',
      id: 'seg000',
      claimed: '99:99:99',
      actual: '00:00:00',
    })
  })

  it('quote가 원문과 다르면 잡는다 — 근거는 원문 그대로여야 한다', () => {
    const p = proposalWith({
      evidence: [
        // 모델이 교정해서 인용하면 대조가 불가능해진다
        { id: 'seg000', timestamp: '00:00:00', quote: '오픈은 3월 16일로 연기합니다.' },
      ],
    })
    expect(verifyEvidence(p, segments).map((v) => v.kind)).toContain(
      'quote_mismatch'
    )
  })

  it('앞뒤 공백 차이는 위반이 아니다', () => {
    const p = proposalWith({
      evidence: [
        { id: 'seg000', timestamp: '00:00:00', quote: '  오픈은 3월 16일로 미루죠.  ' },
      ],
    })
    expect(verifyEvidence(p, segments)).toEqual([])
  })

  it('중복 ID를 잡는다', () => {
    const e = { id: 'seg000', timestamp: '00:00:00', quote: '오픈은 3월 16일로 미루죠.' }
    const p = proposalWith({ evidence: [e, e] })
    expect(verifyEvidence(p, segments)).toContainEqual({
      kind: 'duplicate_evidence_id',
      id: 'seg000',
    })
  })
})

describe('회귀 fixture — Phase 0 실측에서 나온 실제 Hermes 출력', () => {
  const segs = realSegments as TranscriptSegment[]
  const proposal = realProposal as unknown as DocumentProposal

  it('전사문 154 세그먼트를 담고 있다', () => {
    expect(segs).toHaveLength(154)
  })

  it('결함 A가 실제로 검출된다 — 인용 41개 중 32개 누락', () => {
    const v = verifyEvidence(proposal, segs)
    const missing = v.filter((x) => x.kind === 'not_in_evidence_array')
    expect(missing).toHaveLength(32)
  })

  it('환각은 없다 — 실재하지 않는 segID·timestamp·quote 위반 0건', () => {
    const v = verifyEvidence(proposal, segs)
    expect(v.filter((x) => x.kind === 'unknown_segment')).toHaveLength(0)
    expect(v.filter((x) => x.kind === 'timestamp_mismatch')).toHaveLength(0)
    expect(v.filter((x) => x.kind === 'quote_mismatch')).toHaveLength(0)
  })

  it('이 출력은 proposed로 승격되지 못한다', () => {
    expect(canPromoteToProposed(verifyEvidence(proposal, segs))).toBe(false)
  })

  it('위반을 사람이 읽을 수 있는 문장으로 설명한다', () => {
    const v = verifyEvidence(proposal, segs)
    expect(describeViolation(v[0]!)).toMatch(/링크가 깨진다/)
  })
})

describe('describeViolation — 모든 위반 유형을 설명한다', () => {
  it('unknown_segment', () => {
    expect(
      describeViolation({
        kind: 'unknown_segment',
        id: 'seg999',
        citedIn: 'summary',
      })
    ).toMatch(/전사문에 없는 segID/)
  })

  it('not_in_evidence_array', () => {
    expect(
      describeViolation({
        kind: 'not_in_evidence_array',
        id: 'seg001',
        citedIn: 'tasks[0]',
      })
    ).toMatch(/링크가 깨진다/)
  })

  it('timestamp_mismatch', () => {
    expect(
      describeViolation({
        kind: 'timestamp_mismatch',
        id: 'seg000',
        claimed: '00:00:01',
        actual: '00:00:00',
      })
    ).toMatch(/timestamp 불일치/)
  })

  it('quote_mismatch', () => {
    expect(
      describeViolation({
        kind: 'quote_mismatch',
        id: 'seg000',
        claimed: 'a',
        actual: 'b',
      })
    ).toMatch(/원문 그대로여야 한다/)
  })

  it('duplicate_evidence_id', () => {
    expect(
      describeViolation({ kind: 'duplicate_evidence_id', id: 'seg000' })
    ).toMatch(/중복 ID/)
  })
})

describe('경계 조건', () => {
  it('빈 제안은 위반이 없다 — 결과가 없는 회의도 정상이다', () => {
    expect(verifyEvidence(proposalWith({}), segments)).toEqual([])
  })

  it('같은 segID를 여러 section이 인용해도 한 번만 보고한다', () => {
    const p = proposalWith({
      summary: { text: '요약', evidence: ['seg000'] },
      decisions: [{ what: 'd', evidence: ['seg000'] }],
      tasks: [{ action: 't', evidence: ['seg000'] }],
    })
    const v = verifyEvidence(p, segments)
    expect(v.filter((x) => x.kind === 'not_in_evidence_array')).toHaveLength(1)
  })

  it('evidence 배열에만 있고 아무도 인용하지 않은 항목은 위반이 아니다', () => {
    const p = proposalWith({
      evidence: [
        { id: 'seg002', timestamp: '00:00:10', quote: '계약서는 금요일까지 볼게요.' },
      ],
    })
    expect(verifyEvidence(p, segments)).toEqual([])
  })
})
