/**
 * 확정 문서 → vault Markdown — PLAN.md 순서 5, technical-foundation 9절.
 *
 * ⛔ **vault가 원본이다.** 여기까지 오지 않으면 회의록은 앱 안에만 있고,
 *    앱을 지우면 사라진다. Obsidian으로 열어 읽고 고칠 수 있어야 한다.
 *
 * ⛔ **앱이 모르는 필드를 보존한다**(9절). 사람이 frontmatter에 태그를 붙였는데
 *    다시 확정할 때 지워지면, 그 사람은 다시는 이 앱을 안 쓴다.
 */

import { describe, expect, it } from 'vitest'
import type { DocumentProposal } from '@ratatouille/contracts'
import {
  meetingNotePath,
  renderMeetingNote,
} from '../src/documents/markdown.ts'

const PROPOSAL: DocumentProposal = {
  narrative: [
    { heading: '오픈 일정', body: '연기하기로 했다[seg_0]. 날짜도 정했다[seg_1].' },
  ],
  summary: { text: '오픈을 미뤘다[seg_0].', evidence: ['seg_0'] },
  decisions: [{ what: '3월 16일로 연기[seg_1].', evidence: ['seg_1'] }],
  tasks: [
    {
      action: '고객사에 공지한다[seg_1].',
      owner: '이한결',
      due: '3월 2일',
      evidence: ['seg_1'],
    },
  ],
  evidence: [
    { id: 'seg_0', timestamp: '00:00:00', quote: '오픈을 연기합니다.' },
    { id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' },
  ],
}

const META = {
  sourceId: 'src_01',
  revisionId: 'rev_1',
  runId: 'doc_1',
  sourceHash: 'sha256:abc',
  title: '08/06 11:02',
  startedAt: '2026-08-06T11:02:00+09:00',
}

const render = (over: Partial<DocumentProposal> = {}) =>
  renderMeetingNote({ ...META, proposal: { ...PROPOSAL, ...over } })

describe('파일 위치', () => {
  it('회의록은 notes에 둔다', () => {
    expect(meetingNotePath('src_01')).toBe('notes/src_01.md')
  })

  it('⛔ 파일명이 source id다 — 제목은 바뀌어도 id는 안 바뀐다', () => {
    // 사람이 제목을 고쳤다고 새 파일이 생기면 이력이 갈라진다.
    expect(meetingNotePath('src_01')).toContain('src_01')
  })
})

describe('frontmatter', () => {
  const { frontmatter } = render()

  it('무엇으로 만들었는지 ID로 남긴다', () => {
    expect(frontmatter).toMatchObject({
      source_id: 'src_01',
      transcript_revision_id: 'rev_1',
      documentation_run_id: 'doc_1',
      source_hash: 'sha256:abc',
    })
  })

  it('⛔ 오디오나 전사 본문을 복사하지 않는다 — 참조만 한다', () => {
    expect(JSON.stringify(frontmatter)).not.toContain('오픈을 연기합니다')
  })

  it('문서 상태를 적는다', () => {
    expect(frontmatter.status).toBe('current')
  })
})

describe('본문', () => {
  const { body } = render()

  it('네 결과가 모두 있다', () => {
    for (const h of ['## 회의 내용', '## 요약', '## 결정 사항', '## Action Item']) {
      expect(body).toContain(h)
    }
  })

  it('회의 내용의 주제가 소제목이 된다', () => {
    expect(body).toContain('### 오픈 일정')
  })

  it('⛔ 근거 마커가 Markdown 각주가 된다 — 원본에서도 근거를 따라갈 수 있다', () => {
    // `[seg_0]`을 그대로 두면 Obsidian에서 깨진 링크처럼 보인다.
    expect(body).not.toContain('[seg_0]')
    expect(body).toContain('[^1]')
    expect(body).toContain('[^1]: `00:00:00` 오픈을 연기합니다.')
  })

  it('⛔ 각주 번호가 화면과 같다 — evidence 배열 순서', () => {
    expect(body).toContain('연기하기로 했다[^1]')
    expect(body).toContain('날짜도 정했다[^2]')
  })

  it('Action Item에 담당자와 기한이 붙는다', () => {
    expect(body).toContain('이한결')
    expect(body).toContain('3월 2일')
  })

  it('예전 데이터의 담당자·기한에 섞인 본문용 근거 마커를 출력하지 않는다', () => {
    const { body } = render({
      tasks: [
        {
          action: '확인한다[seg_0].',
          owner: '이한결[seg_53]',
          due: '내일[seg_61]',
          evidence: ['seg_0'],
        },
      ],
    })
    expect(body).toContain('담당 이한결 · 기한 내일')
    expect(body).not.toContain('이한결[seg_53]')
    expect(body).not.toContain('내일[seg_61]')
  })

  it('⛔ 없는 담당자를 지어내지 않는다', () => {
    const { body } = render({
      tasks: [{ action: '확인한다[seg_0].', owner: null, due: null, evidence: ['seg_0'] }],
    })
    expect(body).toContain('미입력')
  })

  it('⛔ 비어 있는 것을 감추지 않는다 — 회의에 없었다는 사실도 기록이다', () => {
    const { body } = render({ decisions: [], tasks: [] })
    expect(body).toContain('## 결정 사항')
    expect(body).toMatch(/결정 사항[\s\S]*?없습니다/)
  })

  it('회의 내용이 없는 예전 결과도 렌더된다', () => {
    expect(() => render({ narrative: [] })).not.toThrow()
  })
})

describe('⛔ 사람이 쓴 것을 지우지 않는다 — 9절', () => {
  it('앱이 모르는 frontmatter 필드가 살아남는다', () => {
    const { frontmatter } = renderMeetingNote({
      ...META,
      proposal: PROPOSAL,
      existing: { tags: ['결제', '중요'], my_note: '다시 볼 것' },
    })
    expect(frontmatter.tags).toEqual(['결제', '중요'])
    expect(frontmatter.my_note).toBe('다시 볼 것')
  })

  it('⛔ 앱이 소유한 필드는 앱 값이 이긴다', () => {
    // 참조 ID가 사람 손에서 바뀌면 어느 실행에서 나왔는지 못 찾는다.
    const { frontmatter } = renderMeetingNote({
      ...META,
      proposal: PROPOSAL,
      existing: { source_id: '엉뚱한값' },
    })
    expect(frontmatter.source_id).toBe('src_01')
  })
})
