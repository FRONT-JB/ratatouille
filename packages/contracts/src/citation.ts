/**
 * 본문 안 근거 마커 — `작성일자 제한[seg_33]을 검토했다.`
 *
 * ⛔ **형식은 여기 한 곳에만 있다.** 서버는 프롬프트로 이 형식을 요구하고
 *    마커를 뽑아 `evidence` 배열을 만들며, 화면은 같은 형식을 잘라 각주 번호로
 *    그린다. 두 곳이 각자 정규식을 들고 있으면 반드시 어긋나고, 어긋나면
 *    근거가 조용히 사라진다.
 *
 * 왜 문장 안인가: 항목 끝에 근거를 모아 달면 `[1][2][3]…[10]`이 되어 어느
 * 번호가 어느 주장을 받치는지 알 수 없다. 검수는 "이 문장이 맞나"를 묻는
 * 일이므로, 근거는 그 문장에 붙어 있어야 한다.
 */

/** ⛔ `[웃음]` 같은 전사 표기를 근거로 오해하지 않도록 ID 모양을 못박는다 */
const MARKER = /\[(seg_\d+)\]/g

export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; id: string }

/** 본문에 인용된 세그먼트 ID를 **나온 순서대로**, 중복 없이 */
export function citedIdsIn(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(MARKER)) {
    const id = m[1]!
    if (!seen.has(id)) seen.add(id)
  }
  return [...seen]
}

/** 각주를 그리기 위해 글과 마커로 자른다. 빈 조각은 만들지 않는다. */
export function splitCitations(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(MARKER)) {
    const at = m.index
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) })
    parts.push({ kind: 'cite', id: m[1]! })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/**
 * 각주 번호표 — 세그먼트 ID → 번호.
 *
 * ⛔ **번호는 `evidence` 배열의 순서다.** 그 배열은 서버가 인용된 순서대로
 *    (요약 → 결정 → Action Item) 채운다. 부르는 쪽이 각자 번호를 매기면
 *    본문 각주와 「원문 근거」란의 번호가 어긋나고, 어긋나면 각주가 무의미하다.
 *
 * ⛔ **여기 한 곳에만 둔다.** 화면·회의록·결정 파일이 각각 같은 한 줄을 들고
 *    있었다. 셋이 같은 규칙을 따로 구현하면 한 곳만 고쳐지는 날이 온다.
 */
export function footnoteNumbers(
  evidence: readonly { id: string }[]
): Map<string, number> {
  return new Map(evidence.map((e, i) => [e.id, i + 1]))
}

/**
 * 본문의 근거 마커를 **Markdown 각주**(`[^1]`)로 바꾼다.
 *
 * ⛔ **번호표에 없는 id는 마커를 지우기만 한다.** 정의 없는 각주를 남기면
 *    Obsidian에서 빈 링크가 되고, 그건 근거가 있다고 거짓말하는 것이다.
 *
 * 화면은 이 함수를 쓰지 않는다 — 거기서는 각주가 문자열이 아니라 눌리는
 * 컴포넌트다. 공유하는 것은 **번호와 「모르면 지운다」 규칙**이지 렌더가 아니다.
 */
export function toMarkdownFootnotes(
  text: string,
  numbers: ReadonlyMap<string, number>
): string {
  return splitCitations(text)
    .map((part) => {
      if (part.kind === 'text') return part.text
      const n = numbers.get(part.id)
      return n === undefined ? '' : `[^${n}]`
    })
    .join('')
}

/**
 * 마커를 뗀 본문.
 *
 * 각주를 그릴 수 없는 곳(vault Markdown, 검색 색인)에서 쓴다.
 * ⛔ 마커 앞 공백까지 같이 뗀다 — 안 그러면 `검토했다 .`가 된다.
 */
export function stripCitations(text: string): string {
  return text.replace(/[ \t]*\[seg_\d+\]/g, '')
}
