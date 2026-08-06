/**
 * 사람이 결과를 고친다 — `review-contract.md`, PLAN.md 순서 5.
 *
 * ⛔ **고칠 수 없는 검수는 반쪽이다.** 「수정 필요」로 표시하면 확정이 막히는데,
 *    고칠 방법이 없으면 그 회의는 영원히 확정되지 않는다. Phase 0 결함 B
 *    (제안을 결정으로 승격)의 유일한 시정은 **그 항목을 지우는 것**이다.
 *
 * ⛔ **사람의 편집도 근거를 지어낼 수 없다.** 모델에 강제한 부분집합 규칙
 *    (결함 A)이 사람 손에서 뚫리면 규칙이 있는 이유가 사라진다 — 화면의 각주는
 *    사람이 썼든 모델이 썼든 똑같이 죽는다.
 *
 * ⛔ **AI는 사람의 편집을 덮지 않는다.** 편집은 그 run의 결과에만 쌓이고,
 *    다시 정리하면 새 run이 생긴다. 이전 run의 편집은 그대로 남는다.
 */

import { citedIdsIn } from './citation.ts'
import type { DocumentProposal } from './evidence.ts'
import type { ReviewSection } from './review.ts'
import { RuleViolationError } from './rules.ts'

/**
 * 한 번의 편집.
 *
 * ⛔ **`evidence`는 여기 없다.** 원문 근거는 전사문에서 온 사실이고, 사람이
 *    고치는 순간 근거가 아니게 된다. 근거가 틀렸으면 고칠 것은 그것을 인용한
 *    문장이다.
 */
export type ProposalEdit =
  | { section: 'summary'; kind: 'text'; text: string }
  | { section: 'summary'; kind: 'narrative'; index: number; body: string }
  | { section: 'decisions'; kind: 'text'; index: number; text: string }
  | { section: 'decisions'; kind: 'remove'; index: number }
  | { section: 'tasks'; kind: 'text'; index: number; text: string }
  | { section: 'tasks'; kind: 'owner'; index: number; value: string | null }
  | { section: 'tasks'; kind: 'due'; index: number; value: string | null }
  | { section: 'tasks'; kind: 'remove'; index: number }

/** 이 편집으로 「고침」이 되는 section */
export function editedSection(edit: ProposalEdit): ReviewSection {
  return edit.section
}

/** 사람이 고칠 수 있는 section. 원문 근거는 빠져 있다 */
const EDITABLE: readonly string[] = ['summary', 'decisions', 'tasks']

/**
 * 편집을 적용한 **새** 제안을 돌려준다.
 *
 * ⛔ 받은 것을 고치지 않는다. 원본을 제자리에서 바꾸면 "AI가 뭐라고 했었나"를
 *    되짚을 수 없다.
 */
export function applyEdit(
  proposal: DocumentProposal,
  edit: ProposalEdit,
  /**
   * 인용해도 되는 세그먼트 ID.
   *
   * ⛔ **없으면 「이미 인용된 것」으로 좁힌다.** 그건 안전하지만 좁다 —
   *    사람이 전사문을 읽다가 더 나은 발언을 찾아도 가리킬 수 없다.
   *    서버는 전사문 전체를 넘긴다. 계약은 전사문을 모르므로 받아야 한다.
   */
  allowedIds?: ReadonlySet<string>
): DocumentProposal {
  if (!EDITABLE.includes(edit.section)) {
    throw new RuleViolationError(
      'edit-section-not-editable',
      '원문 근거는 전사문에서 온 사실이라 고칠 수 없습니다. 근거가 틀렸다면 그것을 인용한 문장을 고쳐 주세요.'
    )
  }

  const known = allowedIds ?? new Set(proposal.evidence.map((e) => e.id))

  switch (edit.kind) {
    case 'text': {
      if (edit.section === 'summary') {
        const text = checkedText(edit.text, proposal.summary.text, known)
        return {
          ...proposal,
          summary: { text, evidence: citedIdsIn(text) },
        }
      }
      if (edit.section === 'decisions') {
        const cur = at(proposal.decisions, edit.index)
        const text = checkedText(edit.text, cur.what, known)
        return {
          ...proposal,
          decisions: replaced(proposal.decisions, edit.index, {
            ...cur,
            what: text,
            evidence: citedIdsIn(text),
          }),
        }
      }
      const cur = at(proposal.tasks, edit.index)
      const text = checkedText(edit.text, cur.action, known)
      return {
        ...proposal,
        tasks: replaced(proposal.tasks, edit.index, {
          ...cur,
          action: text,
          evidence: citedIdsIn(text),
        }),
      }
    }

    case 'narrative': {
      const list = proposal.narrative ?? []
      const cur = at(list, edit.index)
      const body = checkedText(edit.body, cur.body, known)
      return { ...proposal, narrative: replaced(list, edit.index, { ...cur, body }) }
    }

    case 'owner':
    case 'due': {
      const cur = at(proposal.tasks, edit.index)
      /*
       * ⛔ 빈 값은 `null`이다. `'미입력'`으로 저장하면 그런 이름의 담당자와
       *    구분되지 않고, "담당자가 정해졌는가"를 코드가 물을 수 없게 된다.
       */
      const value = edit.value?.trim() ? edit.value.trim() : null
      return {
        ...proposal,
        tasks: replaced(proposal.tasks, edit.index, { ...cur, [edit.kind]: value }),
      }
    }

    case 'remove': {
      if (edit.section === 'decisions') {
        at(proposal.decisions, edit.index) // 범위 검사
        return { ...proposal, decisions: without(proposal.decisions, edit.index) }
      }
      at(proposal.tasks, edit.index)
      return { ...proposal, tasks: without(proposal.tasks, edit.index) }
    }
  }
}

/**
 * 고쳐 쓴 글이 규칙을 지키는가.
 *
 * ⛔ **인용 검사가 여기 있는 이유**: 사람이 각주 번호를 옮겨 붙이다 없는
 *    세그먼트를 가리키면, 화면에서는 눌리지 않는 각주가 되고 vault에서는
 *    빈 링크가 된다. 그건 근거가 있다고 거짓말하는 것이다.
 */
function checkedText(
  next: string,
  before: string,
  known: ReadonlySet<string>
): string {
  const text = next.trim()
  if (text.length === 0) {
    throw new RuleViolationError(
      'edit-empty-text',
      '내용을 비울 수 없습니다. 지우려면 항목 삭제를 쓰세요.'
    )
  }

  const cites = citedIdsIn(text)
  const unknown = cites.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw new RuleViolationError(
      'edit-cites-unknown-evidence',
      `전사문에 없는 발언을 인용했습니다: ${unknown.join(', ')}`
    )
  }

  /*
   * ⛔ 근거가 있던 문장에서 근거를 전부 떼면, 남는 것은 회의록이 아니라 메모다.
   *    원래 근거가 없던 문장(이 필드가 생기기 전의 결과)까지 막지는 않는다.
   */
  if (cites.length === 0 && citedIdsIn(before).length > 0) {
    throw new RuleViolationError(
      'edit-drops-evidence',
      '근거 표시를 모두 지울 수 없습니다. 근거가 틀렸다면 다른 발언으로 옮겨 주세요.'
    )
  }

  return text
}

function at<T>(list: readonly T[], index: number): T {
  const item = list[index]
  if (item === undefined) {
    throw new RuleViolationError(
      'edit-index-out-of-range',
      '고치려는 항목이 없습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'
    )
  }
  return item
}

function replaced<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((x, i) => (i === index ? item : x))
}

/**
 * ⛔ **`evidence` 배열은 건드리지 않는다.** 각주 번호는 그 배열의 순서다.
 *    지운 항목이 인용하던 근거까지 같이 빼면, 남은 항목의 각주가 전부 다른
 *    발언을 가리키게 된다.
 */
function without<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}
