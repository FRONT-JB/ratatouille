/**
 * 확정 문서 → vault Markdown — technical-foundation 9절.
 *
 * ⛔ **vault가 원본이다.** 여기까지 오지 않으면 회의록은 앱 안에만 있고,
 *    앱을 지우면 사라진다. Obsidian으로 열어 읽고 고칠 수 있어야 한다.
 *
 * ⛔ **오디오나 전사 본문을 복사하지 않는다.** frontmatter는 ID와 hash로만
 *    참조한다. 본문을 복사하면 원본이 둘이 되고, 둘은 반드시 갈라진다.
 */

import {
  type DocumentProposal,
  UNSET_LABEL,
  footnoteNumbers,
  normalizeTaskMetadata,
  toMarkdownFootnotes,
} from '@ratatouille/contracts'
import type { Frontmatter } from '../vault/document.ts'

/**
 * 회의록 파일 위치.
 *
 * ⛔ **파일명은 source id다.** 제목으로 지으면 사람이 제목을 고칠 때마다
 *    새 파일이 생겨 이력이 갈라진다. id는 안 바뀐다(9절 «immutable ID가
 *    identity다»).
 */
export function meetingNotePath(sourceId: string): string {
  return `notes/${sourceId}.md`
}

/**
 * ⛔ **앱이 소유한 frontmatter 키.** 이 목록에 없는 것은 사람 것이므로
 *    건드리지 않는다(9절 «앱이 모르는 필드를 보존한다»). 사람이 붙인 태그가
 *    다시 확정할 때 지워지면, 그 사람은 다시는 이 앱을 안 쓴다.
 */
const OWNED = [
  'source_id',
  'transcript_revision_id',
  'documentation_run_id',
  'source_hash',
  'title',
  'started_at',
  'status',
] as const

export type MeetingNoteInput = {
  sourceId: string
  revisionId: string
  runId: string
  sourceHash: string
  title: string
  startedAt: string | null
  proposal: DocumentProposal
  /** 디스크에 이미 있던 frontmatter. 사람이 쓴 것을 살린다 */
  existing?: Frontmatter
}

export function renderMeetingNote(input: MeetingNoteInput): {
  frontmatter: Frontmatter
  body: string
} {
  const numbers = footnoteNumbers(input.proposal.evidence)

  return {
    frontmatter: {
      // 사람 것이 먼저 깔리고, 앱이 소유한 키만 덮는다
      ...input.existing,
      source_id: input.sourceId,
      transcript_revision_id: input.revisionId,
      documentation_run_id: input.runId,
      source_hash: input.sourceHash,
      title: input.title,
      started_at: input.startedAt,
      status: 'current',
    },
    body: renderBody(input.proposal, numbers),
  }
}

/** 앱이 소유한 키인가. 충돌 처리에서 쓴다 */
export function isOwnedKey(key: string): boolean {
  return (OWNED as readonly string[]).includes(key)
}

function renderBody(
  p: DocumentProposal,
  numbers: Map<string, number>
): string {
  const out: string[] = []

  const narrative = p.narrative ?? []
  if (narrative.length > 0) {
    out.push('## 회의 내용', '')
    for (const n of narrative) {
      out.push(`### ${n.heading}`, '', footnoted(n.body, numbers), '')
    }
  }

  out.push('## 요약', '', footnoted(p.summary.text, numbers), '')

  out.push('## 결정 사항', '')
  if (p.decisions.length === 0) {
    // ⛔ 비어 있음을 감추지 않는다. 「결정이 없었다」도 회의의 기록이다.
    out.push('결정된 사항이 없습니다.', '')
  } else {
    p.decisions.forEach((d, i) =>
      out.push(`${i + 1}. ${footnoted(d.what, numbers)}`)
    )
    out.push('')
  }

  out.push('## Action Item', '')
  if (p.tasks.length === 0) {
    out.push('할 일이 없습니다.', '')
  } else {
    for (const t of p.tasks) {
      /*
       * ⛔ 담당자·기한이 비어 있는 것을 감추지 않는다. 화자 분리를 접었으므로
       *    "제가 하겠습니다"는 누구인지 알 수 없다 — 사람이 채울 자리다.
       */
      const owner = normalizeTaskMetadata(t.owner)
      const due = normalizeTaskMetadata(t.due)
      out.push(
        `- [ ] ${footnoted(t.action, numbers)}`,
        `      담당 ${owner ?? UNSET_LABEL} · 기한 ${due ?? UNSET_LABEL}`
      )
    }
    out.push('')
  }

  /*
   * 원문 근거는 **Markdown 각주**로 낸다. `[seg_0]`을 그대로 두면 Obsidian에서
   * 깨진 링크처럼 보이고, 번호를 새로 매기면 화면과 어긋난다.
   */
  if (p.evidence.length > 0) {
    out.push('## 원문 근거', '')
    p.evidence.forEach((e, i) =>
      out.push(`[^${i + 1}]: \`${e.timestamp}\` ${e.quote}`)
    )
    out.push('')
  }

  return out.join('\n').trimEnd() + '\n'
}

/*
 * 마커 → 각주 변환은 계약이 갖는다(`toMarkdownFootnotes`). 여기·결정 파일·화면이
 * 각자 「번호는 evidence 순서」와 「모르면 지운다」를 구현하고 있었다.
 */
const footnoted = toMarkdownFootnotes
