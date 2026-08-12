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
    '위 전사문에서 다음을 뽑아 **JSON만** 출력하라. 설명이나 코드펜스를 붙이지 마라.',
    '',
    '```',
    '{',
    '  "narrative": [',
    '    { "heading": "작성일자 제한", "body": "이번 달 10일 이전이면 지난달을 고를 수 있게 해야 한다는 요구가 있었으나[seg_32], 결제 시점에 과제가 따라붙어 선택을 막아두기로 했다[seg_36]." }',
    '  ],',
    '  "summary": { "text": "작성일자 제한[seg_33]과 청구 옵션[seg_41]을 검토했다." },',
    '  "decisions": [{ "what": "오픈을 3월 16일로 연기하기로 했다[seg_3]." }],',
    '  "tasks": [{ "action": "계약서를 검토한다[seg_7].", "owner": "담당자 또는 미입력", "due": "기한 또는 미입력" }]',
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
     *
     * ⛔ **근거는 문장 안에 넣게 한다.** 항목 끝에 몰아 달면 `[1][2]…[10]`이 되어
     *    어느 근거가 어느 주장을 받치는지 알 수 없다. 검수는 "이 문장이 맞나"를
     *    묻는 일이므로, 근거는 그 문장에 붙어 있어야 한다. 위치는 모델만 알 수
     *    있는 정보다 — 파생값이 아니므로 모델에게 받는 것이 맞다.
     */
    '1. 근거는 **문장 안에** `[seg_33]` 형태로 넣는다. 그 내용을 뒷받침하는 발화의 ID를 해당 문장·구절 **바로 뒤에** 붙인다.',
    '2. 전사문에 **실제로 있는 ID만** 쓴다. 없는 ID를 지어내면 결과 전체가 거부된다.',
    '3. 시각이나 인용문은 적지 마라. ID만 적으면 시스템이 전사문에서 직접 가져온다.',
    '4. 회의에서 **실제로 말하지 않은 것을 만들지 마라.** 담당자나 기한이 언급되지 않았으면 `미입력`으로 둔다. `owner`와 `due`에는 `[seg_33]` 같은 근거 마커를 넣지 마라. 근거 마커는 본문 필드에만 둔다.',
    '5. 제안과 결정을 구분하라. "그렇게 할까요?"는 결정이 아니다. 합의된 것만 `decisions`에 넣는다.',
    '6. 결정 사항이나 할 일이 없으면 빈 배열로 둔다. 억지로 채우지 마라.',
    /*
     * ⛔ 요약과 전문은 **다른 것**이다. 요약만 두면 "무슨 얘기였지"는 알아도
     *    "왜 그렇게 됐지"를 알 수 없고, 그건 전사문을 다시 읽어야만 알 수 있다.
     */
    '7. `narrative`는 회의를 **주제별로 나눠 따라 읽을 수 있게** 편 글이다. `summary`를 늘려 쓴 것이 아니라, 오간 논의와 그렇게 정해진 이유를 담는다.',
    '8. `narrative`의 각 주제는 2~5문장으로 쓴다. 전사문을 그대로 옮겨 적지 마라 — 그건 이미 있다.',
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
