import { describe, expect, it } from 'vitest'
import {
  MalformedDocumentError,
  contentHash,
  detectConflict,
  parseDocument,
  patchFrontmatter,
  serializeDocument,
} from '../src/vault/document.ts'

const roundTrip = (raw: string) => serializeDocument(parseDocument(raw))

describe('frontmatter 파싱', () => {
  it('frontmatter와 본문을 분리한다', () => {
    const d = parseDocument('---\nid: src_01H\n---\n본문입니다.\n')
    expect(d.frontmatter).toEqual({ id: 'src_01H' })
    expect(d.body).toBe('본문입니다.\n')
  })

  it('frontmatter가 없으면 전체를 본문으로 본다', () => {
    const d = parseDocument('# 그냥 마크다운\n')
    expect(d.frontmatter).toEqual({})
    expect(d.body).toBe('# 그냥 마크다운\n')
  })

  it('빈 frontmatter를 허용한다', () => {
    expect(parseDocument('---\n\n---\n본문').frontmatter).toEqual({})
  })

  it('CRLF 줄바꿈을 처리한다', () => {
    const d = parseDocument('---\r\nid: x\r\n---\r\n본문')
    expect(d.frontmatter).toEqual({ id: 'x' })
  })

  it('본문 안의 --- 는 frontmatter 구분자로 오해하지 않는다', () => {
    const d = parseDocument('---\nid: x\n---\n본문\n\n---\n\n다음 절\n')
    expect(d.frontmatter).toEqual({ id: 'x' })
    expect(d.body).toContain('다음 절')
  })

  it('깨진 YAML은 던진다 — 조용히 날리지 않는다', () => {
    expect(() => parseDocument('---\nid: [unclosed\n---\n본문')).toThrow(
      MalformedDocumentError
    )
  })

  it('배열 frontmatter를 거부한다', () => {
    expect(() => parseDocument('---\n- a\n- b\n---\n본문')).toThrow(
      MalformedDocumentError
    )
  })
})

describe('⛔ 앱이 모르는 필드를 보존한다 — 가장 중요한 계약', () => {
  it('모르는 스칼라 필드가 살아남는다', () => {
    const raw = '---\nid: src_01H\nmy_custom_tag: 중요\n---\n본문\n'
    expect(roundTrip(raw)).toContain('my_custom_tag: 중요')
  })

  it('모르는 중첩 객체가 살아남는다', () => {
    const raw =
      '---\nid: x\nobsidian:\n  cssclass: wide\n  aliases:\n    - 별칭1\n    - 별칭2\n---\n본문\n'
    const out = roundTrip(raw)
    expect(out).toContain('cssclass: wide')
    expect(out).toContain('별칭1')
    expect(out).toContain('별칭2')
  })

  it('알려진 필드를 고쳐도 모르는 필드는 그대로다', () => {
    const { frontmatter, body } = parseDocument(
      '---\nid: x\nstatus: ready\nuser_note: 손으로 쓴 메모\n---\n본문\n'
    )
    const patched = patchFrontmatter(frontmatter, { status: 'current' })
    const out = serializeDocument({ frontmatter: patched, body })
    expect(out).toContain('status: current')
    expect(out).toContain('user_note: 손으로 쓴 메모')
  })

  it('본문의 Markdown 구조가 그대로 보존된다', () => {
    const body = [
      '# 회의 요약',
      '',
      '- 항목 1',
      '- 항목 2',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '> 인용문',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
    ].join('\n')
    const raw = `---\nid: x\n---\n${body}`
    expect(parseDocument(roundTrip(raw)).body).toBe(body)
  })

  it('한국어와 이모지가 깨지지 않는다', () => {
    const raw = '---\ntitle: 결제 모듈 회의 🎙️\n---\n한국어 본문 — 대시와 따옴표 "인용"\n'
    const out = roundTrip(raw)
    expect(out).toContain('결제 모듈 회의 🎙️')
    expect(out).toContain('대시와 따옴표 "인용"')
  })

  it('round-trip을 두 번 해도 안정적이다', () => {
    const raw = '---\nid: x\nnested:\n  a: 1\n  b: [1, 2]\n---\n본문\n'
    const once = roundTrip(raw)
    expect(roundTrip(once)).toBe(once)
  })
})

describe('patchFrontmatter', () => {
  it('undefined를 주면 키를 삭제한다', () => {
    expect(patchFrontmatter({ a: 1, b: 2 }, { b: undefined })).toEqual({ a: 1 })
  })

  it('키를 넘기지 않으면 손대지 않는다', () => {
    expect(patchFrontmatter({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 })
  })

  it('원본을 변경하지 않는다', () => {
    const src = { a: 1 }
    patchFrontmatter(src, { a: 2 })
    expect(src).toEqual({ a: 1 })
  })
})

describe('serializeDocument', () => {
  it('frontmatter가 비면 --- 블록을 쓰지 않는다', () => {
    expect(serializeDocument({ frontmatter: {}, body: '본문' })).toBe('본문')
  })

  it('긴 한국어 줄을 접지 않는다 — diff가 지저분해진다', () => {
    const long = '가'.repeat(200)
    const out = serializeDocument({ frontmatter: { t: long }, body: '' })
    const line = out.split('\n').find((l) => l.startsWith('t:'))
    expect(line).toContain(long)
  })
})

describe('contentHash', () => {
  it('같은 내용이면 같은 hash', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
  })

  it('한 글자만 달라도 hash가 바뀐다', () => {
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
  })

  it('frontmatter만 바뀌어도 감지한다', () => {
    const a = '---\nid: x\n---\n본문'
    const b = '---\nid: y\n---\n본문'
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it('본문만 바뀌어도 감지한다', () => {
    const a = '---\nid: x\n---\n본문1'
    const b = '---\nid: x\n---\n본문2'
    expect(contentHash(a)).not.toBe(contentHash(b))
  })
})

describe('detectConflict', () => {
  it('hash가 같으면 충돌이 아니다', () => {
    expect(detectConflict({ baseHash: 'h1', currentHash: 'h1' })).toBe(false)
  })

  it('hash가 다르면 충돌이다 — 그 사이 누군가 고쳤다', () => {
    expect(detectConflict({ baseHash: 'h1', currentHash: 'h2' })).toBe(true)
  })

  it('파일이 사라졌으면 충돌로 보지 않는다 — 새로 만든다', () => {
    expect(detectConflict({ baseHash: 'h1', currentHash: null })).toBe(false)
  })
})
