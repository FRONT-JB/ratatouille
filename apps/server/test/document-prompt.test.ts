import { describe, expect, it } from 'vitest'
import {
  buildDocumentPrompt,
  extractJson,
  segmentLine,
} from '../src/documents/prompt.ts'

const segs = [
  { id: 'seg_0', timestamp: '00:00:00', text: '결제 모듈 오픈을 연기합니다.' },
  { id: 'seg_1', timestamp: '00:00:04', text: '3월 16일로 하죠.' },
]

describe('⛔ 세그먼트 ID와 시각을 본문에 박는다', () => {
  // Phase 0 실측: `[segNNN HH:MM:SS]` 형식으로 주면 22/22 정확히 인용했다.
  // 이게 없으면 모델이 근거를 가리킬 수단이 아예 없다.

  it('한 줄에 id·시각·발화가 함께 있다', () => {
    expect(segmentLine(segs[0]!)).toBe('[seg_0 00:00:00] 결제 모듈 오픈을 연기합니다.')
  })

  it('전사문의 모든 세그먼트가 프롬프트에 들어간다', () => {
    const p = buildDocumentPrompt({ segments: segs })
    expect(p).toContain('[seg_0 00:00:00]')
    expect(p).toContain('[seg_1 00:00:04]')
  })
})

describe('⛔ 실측에서 실제로 문제가 됐던 지점을 명시한다', () => {
  const p = buildDocumentPrompt({ segments: segs })

  it('⛔ 시각과 인용문을 요구하지 않는다 — 서버가 채운다', () => {
    // 실측에서 모델이 준 시각·인용문이 전부 틀렸다. 파생값을 모델에게 받으면
    // 틀릴 수 있고, 실제로 틀렸다. 이제 id만 받는다.
    expect(p).toMatch(/ID만/)
    expect(p).toMatch(/시각이나 인용문은 적지 마라/)
  })

  it('⛔ 근거를 문장 안에 넣으라고 한다 — 항목 끝에 몰면 무엇을 받치는지 모른다', () => {
    expect(p).toMatch(/문장 안에/)
    expect(p).toContain('[seg_33]')
    expect(p).toMatch(/바로 뒤에/)
  })

  it('없는 ID를 지어내면 거부된다고 못박는다 — 남은 유일한 위험이다', () => {
    expect(p).toMatch(/실제로 있는 ID만/)
  })

  it('없는 담당자·기한을 지어내지 말라고 한다', () => {
    expect(p).toContain('미입력')
  })

  it('제안을 결정으로 승격하지 말라고 한다 — 1차 실측에서 실제로 발생', () => {
    expect(p).toMatch(/제안.*결정|결정.*아니다/)
  })

  it('빈 결과를 허용한다 — 억지로 채우면 없는 결정이 생긴다', () => {
    expect(p).toMatch(/빈 배열|없으면/)
  })
})

describe('맥락', () => {
  it('제목과 참석자가 있으면 넣는다', () => {
    const p = buildDocumentPrompt({
      segments: segs,
      context: { title: '결제 모듈 회의', participants: ['한결', '지영'] },
    })
    expect(p).toContain('결제 모듈 회의')
    expect(p).toContain('한결, 지영')
  })

  it('⛔ 없으면 넣지 않는다 — 빈 값을 모델이 채우게 두지 않는다', () => {
    const p = buildDocumentPrompt({ segments: segs, context: { title: null } })
    expect(p).not.toContain('회의 제목:')
    expect(p).not.toContain('참석자:')
  })
})

describe('⛔ 모델 출력에서 JSON 꺼내기', () => {
  // 실측: 지시해도 코드펜스와 설명을 붙인다. JSON.parse 하나만 걸면
  // 정상 결과가 파싱 실패로 버려진다.

  const obj = { summary: { text: 'x', evidence: [] } }

  it('순수 JSON', () => {
    expect(extractJson(JSON.stringify(obj))).toEqual(obj)
  })

  it('앞뒤 공백', () => {
    expect(extractJson(`\n  ${JSON.stringify(obj)}  \n`)).toEqual(obj)
  })

  it('코드펜스로 감싼 경우', () => {
    expect(extractJson('```json\n' + JSON.stringify(obj) + '\n```')).toEqual(obj)
  })

  it('언어 표시 없는 코드펜스', () => {
    expect(extractJson('```\n' + JSON.stringify(obj) + '\n```')).toEqual(obj)
  })

  it('설명이 앞뒤로 붙은 경우', () => {
    expect(
      extractJson(`알겠습니다. 결과는 다음과 같습니다.\n${JSON.stringify(obj)}\n도움이 되었길 바랍니다.`)
    ).toEqual(obj)
  })

  it('⛔ JSON이 없으면 던진다 — 빈 결과를 성공으로 치지 않는다', () => {
    expect(() => extractJson('죄송합니다, 처리할 수 없습니다.')).toThrow(/JSON/)
  })

  it('무엇을 받았는지 오류에 남긴다 — 원인을 못 찾으면 고칠 수 없다', () => {
    expect(() => extractJson('이상한 응답입니다')).toThrow(/이상한 응답입니다/)
  })
})
