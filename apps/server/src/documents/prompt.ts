/**
 * AI 정리 프롬프트 조립.
 *
 * ⛔ **모델에 넘기는 것은 확정된 교정본이다.** raw transcript가 아니다.
 *    사람이 고친 문장으로 정리해야 고유명사·숫자 오류가 결과까지 번지지 않는다.
 *
 * ⛔ **세그먼트 id와 timestamp를 본문에 박아 넣는다.** 모델이 근거를 가리킬
 *    유일한 수단이다. Phase 0 실측에서 `[segNNN HH:MM:SS]` 형식으로 주면
 *    22/22 정확하게 인용했다.
 *
 * ⚠️ 프롬프트로 evidence 배열 누락(결함 A)을 **고칠 수 없다.** 실측에서
 *    1차 44%, 2차 78%가 누락됐고 전사가 길수록 악화했다. 프롬프트는 빈도를
 *    줄일 뿐이고, 강제는 서버의 `verifyEvidence`가 한다.
 */

export type PromptSegment = {
  id: string
  timestamp: string
  text: string
}

/** 세그먼트 한 줄. 이 형식이 곧 모델이 인용할 키다. */
export function segmentLine(s: PromptSegment): string {
  return `[${s.id} ${s.timestamp}] ${s.text}`
}

export type PromptInput = {
  segments: readonly PromptSegment[]
  /** 회의 제목·참석자 등. 없으면 넣지 않는다 — 빈 값을 모델이 채우게 두지 않는다 */
  context?: { title?: string | null; participants?: string[] }
}

export function buildDocumentPrompt(input: PromptInput): string {
  const body = input.segments.map(segmentLine).join('\n')

  const context: string[] = []
  if (input.context?.title) context.push(`회의 제목: ${input.context.title}`)
  if (input.context?.participants?.length) {
    context.push(`참석자: ${input.context.participants.join(', ')}`)
  }

  return [
    '아래는 한국어 회의 전사문이다. 각 줄은 `[세그먼트ID 시각] 발화` 형식이다.',
    '',
    ...(context.length ? [...context, ''] : []),
    '전사문:',
    body,
    '',
    '위 전사문에서 다음 네 가지를 뽑아 **JSON만** 출력하라. 설명이나 코드펜스를 붙이지 마라.',
    '',
    '```',
    '{',
    '  "summary": { "text": "회의 내용 요약", "evidence": ["seg_0", "seg_1"] },',
    '  "decisions": [{ "what": "결정된 사항", "evidence": ["seg_3"] }],',
    '  "tasks": [{ "action": "할 일", "owner": "담당자 또는 미입력", "due": "기한 또는 미입력", "evidence": ["seg_7"] }]',
    '}',
    '```',
    '',
    '규칙:',
    /*
     * ⛔ **evidence 배열을 모델에게 요구하지 않는다.** 예전에는 id·시각·인용문을
     *    모두 받았고, 실측에서 그 셋이 전부 틀렸다(누락 44~78%, timestamp 불일치,
     *    인용문 교정). 시각과 인용문은 **서버가 id로부터 만들 수 있는 파생값**이다.
     *    파생값을 모델에게 받으면 틀릴 수 있고, 실제로 틀렸다.
     *    이제 모델은 **어느 세그먼트가 근거인가(id)만** 말한다.
     */
    '1. `evidence`에는 근거가 되는 세그먼트 ID만 적는다. 시각과 인용문은 적지 마라 — 시스템이 전사문에서 직접 가져온다.',
    '2. 전사문에 **실제로 있는 ID만** 쓴다. 없는 ID를 지어내면 결과 전체가 거부된다.',
    '3. 회의에서 **실제로 말하지 않은 것을 만들지 마라.** 담당자나 기한이 언급되지 않았으면 `미입력`으로 둔다.',
    '4. 제안과 결정을 구분하라. "그렇게 할까요?"는 결정이 아니다. 합의된 것만 `decisions`에 넣는다.',
    '5. 결정 사항이나 할 일이 없으면 빈 배열로 둔다. 억지로 채우지 마라.',
  ].join('\n')
}

/**
 * 모델 출력에서 JSON을 꺼낸다.
 *
 * ⛔ 모델은 지시해도 코드펜스나 설명을 붙인다. 실측에서 실제로 그랬다.
 *    `JSON.parse` 하나만 걸어두면 정상 결과가 파싱 실패로 버려진다.
 */
export function extractJson(stdout: string): unknown {
  const text = stdout.trim()

  // 1) 그대로 파싱되면 그것이 답이다
  try {
    return JSON.parse(text)
  } catch {
    // 아래로
  }

  // 2) 코드펜스 안쪽
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // 아래로
    }
  }

  // 3) 가장 바깥 중괄호 구간
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      // 아래로
    }
  }

  throw new Error(
    `모델 출력에서 JSON을 찾지 못했습니다. 앞부분: ${text.slice(0, 200)}`
  )
}
