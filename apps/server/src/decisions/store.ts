/**
 * 결정 사항 저장 — GOAL 6.10, technical-foundation 9절.
 *
 * ⛔ **vault가 원본이다.** 결정이 앱 안에만 있으면 앱을 지울 때 같이 사라진다.
 *    회의록과 같은 규칙으로 Markdown 파일 하나에 담는다.
 *
 * ⛔ **대체해도 이전 기록을 지우지 않는다.** 파일은 남고 상태만 바뀐다.
 *    바뀐 결론만 남기면 "왜 바뀌었나"가 사라진다.
 */

import {
  type Decision,
  type DecisionState,
  type EvidenceEntry,
  RuleViolationError,
  reverseDecision,
  splitCitations,
  supersedeDecision,
} from '@ratatouille/contracts'
import type { Frontmatter } from '../vault/document.ts'
import type { VaultStore } from '../vault/store.ts'

/**
 * 결정 파일 위치.
 *
 * ⛔ **경로는 id에서 파생할 뿐 identity가 아니다**(9절). 사람이 Obsidian에서
 *    파일을 옮기거나 이름을 바꿔도 frontmatter의 `decision_id`가 그 결정이다.
 */
export function decisionPath(id: string): string {
  return `decisions/${id}.md`
}

/**
 * ⛔ **앱이 소유한 frontmatter 키.** 이 목록에 없는 것은 사람 것이므로
 *    건드리지 않는다(9절). 사람이 붙인 태그가 다시 쓸 때 사라지면 안 된다.
 *
 * ⛔ `superseded_by`가 여기 없는 것은 실수가 아니다. 대체 관계는 새 결정 쪽의
 *    `supersedes` **한 방향만** 저장한다. 양쪽에 적으면 반드시 갈라진다.
 */
const OWNED = [
  'decision_id',
  'source_id',
  'documentation_run_id',
  'status',
  'decided_at',
  'what',
  'evidence',
  'supersedes',
  'who',
  'why',
] as const

export class DecisionNotFoundError extends Error {
  constructor(readonly decisionId: string) {
    super(`결정 ${decisionId}를 찾을 수 없습니다.`)
    this.name = 'DecisionNotFoundError'
  }
}

export class DecisionStore {
  constructor(private readonly vault: VaultStore) {}

  /**
   * 결정을 쓴다. 이미 있으면 앱이 소유한 키만 덮는다.
   *
   * `entries`는 근거 각주의 본문(timestamp·인용문)이다. 회의록과 달리 결정
   * 파일은 홀로 읽히므로, 각주 정의가 없으면 근거를 확인할 길이 없다.
   */
  async put(decision: Decision, entries: readonly EvidenceEntry[] = []): Promise<void> {
    const relPath = decisionPath(decision.id)
    const existing = await this.vault.read(relPath)
    await this.vault.write(relPath, {
      frontmatter: { ...existing?.frontmatter, ...toFrontmatter(decision) },
      body: renderBody(decision, entries),
    })
  }

  async get(id: string): Promise<Decision | null> {
    const doc = await this.vault.read(decisionPath(id))
    return doc ? fromFrontmatter(doc.frontmatter, id) : null
  }

  /**
   * 한 회의에서 나온 결정.
   *
   * ⛔ 대체되거나 뒤집힌 것도 **그대로 돌려준다.** 걸러내는 것은 부르는 쪽의
   *    판단이고, 여기서 감추면 "지난달에 뭘 정했더라"에 답할 수 없다.
   */
  async listFor(sourceId: string): Promise<Decision[]> {
    const out: Decision[] = []
    for (const relPath of await this.vault.listMarkdown('decisions')) {
      const doc = await this.vault.read(relPath)
      if (!doc) continue
      const id = doc.frontmatter.decision_id
      if (typeof id !== 'string') continue
      const decision = fromFrontmatter(doc.frontmatter, id)
      if (decision.sourceId === sourceId) out.push(decision)
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * 새 결정이 이전 결정을 대체한다.
   *
   * ⛔ 규칙은 계약이 판정한다(`supersedeDecision`). 여기서 따로 if를 쓰면
   *    같은 규칙이 두 곳에 생기고 반드시 갈라진다.
   */
  async supersede(previousId: string, replacementId: string): Promise<void> {
    const [previous, replacement] = await Promise.all([
      this.require(previousId),
      this.require(replacementId),
    ])
    const [after, next] = supersedeDecision(previous, replacement)
    await this.patch(after)
    await this.patch(next)
  }

  async reverse(id: string): Promise<Decision> {
    const next = reverseDecision(await this.require(id))
    await this.patch(next)
    return next
  }

  /**
   * 사람이 결정자와 이유를 채운다.
   *
   * ⛔ **모델에게 받지 않는 값이다.** 화자 분리를 접었으므로 「그렇게 하죠」의
   *    주인은 사람만 안다. 이유도 따로 물으면 회의에 없던 근거를 지어낸다.
   */
  async annotate(
    id: string,
    patch: { who?: string | null; why?: string | null }
  ): Promise<Decision> {
    const decision = await this.require(id)
    if (decision.state !== 'active') {
      /*
       * ⛔ 지나간 기록이 소리 없이 흔들리면 "그때 무엇이 유효했나"를 다시
       *    읽을 수 없다. 고칠 것이 있으면 새 결정으로 정정한다.
       */
      throw new RuleViolationError(
        'decision-not-active',
        '대체되거나 뒤집힌 결정은 고칠 수 없습니다. 새 결정으로 정정해 주세요.'
      )
    }
    const next: Decision = {
      ...decision,
      who: 'who' in patch ? blankToNull(patch.who) : decision.who,
      why: 'why' in patch ? blankToNull(patch.why) : decision.why,
    }
    await this.patch(next)
    return next
  }

  private async require(id: string): Promise<Decision> {
    const decision = await this.get(id)
    if (!decision) throw new DecisionNotFoundError(id)
    return decision
  }

  /** 본문은 그대로 두고 frontmatter만 갱신한다 */
  private async patch(decision: Decision): Promise<void> {
    const relPath = decisionPath(decision.id)
    const existing = await this.vault.read(relPath)
    if (!existing) throw new DecisionNotFoundError(decision.id)
    await this.vault.write(relPath, {
      frontmatter: { ...existing.frontmatter, ...toFrontmatter(decision) },
      body: existing.body,
    })
  }
}

/** 앱이 소유한 키인가. 충돌 처리에서 쓴다 */
export function isOwnedDecisionKey(key: string): boolean {
  return (OWNED as readonly string[]).includes(key)
}

function toFrontmatter(d: Decision): Frontmatter {
  return {
    decision_id: d.id,
    source_id: d.sourceId,
    documentation_run_id: d.runId,
    status: d.state,
    decided_at: d.decidedAt,
    /*
     * ⛔ **frontmatter의 `what`이 원형이다.** 본문은 각주 번호로 렌더된 사람용
     *    형태라 `[seg_1]` 마커가 남지 않는다 — 본문에서 되읽으면 근거 연결이
     *    끊긴다. 본문은 이것에서 파생한 것이지 그 반대가 아니다.
     */
    what: d.what,
    evidence: d.evidence,
    supersedes: d.supersedes,
    /*
     * ⛔ 결정자와 이유는 frontmatter에 둔다. 본문에 섞으면 사람이 채울 때마다
     *    본문을 다시 렌더해야 하고, 그러면 사람이 본문에 덧붙인 메모가 날아간다.
     */
    who: d.who,
    why: d.why,
  }
}

function fromFrontmatter(f: Frontmatter, fallbackId: string): Decision {
  return {
    id: str(f.decision_id) ?? fallbackId,
    sourceId: str(f.source_id) ?? '',
    runId: str(f.documentation_run_id) ?? '',
    what: str(f.what) ?? '',
    why: str(f.why),
    who: str(f.who),
    evidence: Array.isArray(f.evidence) ? f.evidence.filter(isString) : [],
    state: decisionState(f.status),
    decidedAt: str(f.decided_at) ?? '',
    supersedes: str(f.supersedes),
  }
}

function decisionState(v: unknown): DecisionState {
  return v === 'superseded' || v === 'reversed' ? v : 'active'
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function blankToNull(v: string | null | undefined): string | null {
  return v?.trim() ? v.trim() : null
}

/**
 * ⛔ **근거 마커를 Markdown 각주로 바꾼다.** `[seg_1]`을 그대로 두면 Obsidian에서
 *    깨진 링크처럼 보인다. 정의를 못 만드는 id는 마커를 **지우기만** 한다 —
 *    없는 각주를 가리키면 근거가 있다고 거짓말하는 셈이다.
 */
function renderBody(d: Decision, entries: readonly EvidenceEntry[]): string {
  const known = new Map(entries.map((e) => [e.id, e]))
  const numbers = new Map<string, number>()
  const used: EvidenceEntry[] = []
  for (const id of d.evidence) {
    const entry = known.get(id)
    if (!entry || numbers.has(id)) continue
    numbers.set(id, used.length + 1)
    used.push(entry)
  }

  const out = [
    footnoted(d.what, numbers),
    '',
  ]
  if (used.length > 0) {
    out.push('## 원문 근거', '')
    used.forEach((e, i) => out.push(`[^${i + 1}]: \`${e.timestamp}\` ${e.quote}`))
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

function footnoted(text: string, numbers: Map<string, number>): string {
  return splitCitations(text)
    .map((part) => {
      if (part.kind === 'text') return part.text
      const n = numbers.get(part.id)
      return n === undefined ? '' : `[^${n}]`
    })
    .join('')
}
