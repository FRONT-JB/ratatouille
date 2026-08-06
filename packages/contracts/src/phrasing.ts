/**
 * 내부 상태 → 사용자 문구 매핑 — PLAN.md 순서 3.
 *
 * 완료 조건: "화면의 상태가 source와 transcription job 중 **어느 객체의 상태인지
 * 추적할 수 있고**, 사용자용 문구가 내부 상태와 **명시적으로 매핑**된다."
 *
 * ⛔ 그래서 문구는 **머신 이름 없이 부를 수 없다.** `queued`는 transcription_job과
 *    document_run 양쪽에 있고, `failed_retryable`은 세 머신에 있다. 상태 이름만으로
 *    문구를 찾으면 "전사 대기"와 "정리 대기"가 같은 말이 된다.
 *
 * ⛔ **확정되지 않은 문구는 확정된 것처럼 두지 않는다.** 그럴듯한 한국어로 적어두면
 *    다음 사람이 이미 정해진 문구로 읽고 그대로 출시한다. `provisional: true`로
 *    표시해서 화면이 시각적으로 구분할 수 있게 한다.
 */

import type {
  DocumentRunState,
  DocumentState,
  MachineName,
  SourceState,
  TranscriptRevisionState,
  TranscriptionJobState,
  UploadHealth,
} from './state.ts'

/** 미확정 문구임을 화면에 드러내는 표시 */
export const PHRASE_PLACEHOLDER = '(문구 미확정)'

/**
 * ⛔ 머신 이름은 `state.ts`의 `MachineName`을 **그대로** 쓴다.
 *    문구 테이블만 다른 이름(`transcription_job` 등)을 쓰면, 같은 머신을
 *    가리키는 이름이 두 개가 되어 반드시 어긋난다. 실제로 어긋나서
 *    `transition()` 호출이 런타임에 깨졌다.
 */
export type StateRef =
  | { machine: 'source'; state: SourceState }
  | { machine: 'upload'; state: UploadHealth }
  | { machine: 'transcriptionJob'; state: TranscriptionJobState }
  | { machine: 'transcriptRevision'; state: TranscriptRevisionState }
  | { machine: 'documentRun'; state: DocumentRunState }
  | { machine: 'document'; state: DocumentState }

export type Phrase = {
  machine: MachineName
  state: string
  label: string
  /** 한 줄 보조 설명. 없으면 null */
  detail: string | null
  /**
   * 문구가 아직 확정되지 않았다.
   *
   * `technical-foundation`이 상태 이름만 정하고 사용자 문구는 정하지 않은
   * 항목이다. 화면은 이걸 시각적으로 구분해야 하고, 확정 전에 출시하면 안 된다.
   */
  provisional: boolean
}

type Entry = { label: string; detail?: string; provisional?: boolean }

/**
 * 매핑 테이블.
 *
 * 머신별로 나눠 둔다. 한 객체에 몰아넣으면 `queued`가 서로를 덮는다.
 */
const TABLE: {
  // 머신이 하나라도 빠지면 타입 오류가 난다
  [M in MachineName]: Record<string, Entry>
} = {
  source: {
    capturing: { label: '녹음 중' },
    finalizing: {
      label: '원본 확인 중',
      detail: '조각이 모두 도착했는지 확인하고 있습니다.',
    },
    ready: { label: '원본 준비됨', detail: '전사를 시작할 수 있습니다.' },
  },

  upload: {
    syncing: { label: '업로드 중' },
    synced: { label: '업로드 완료' },
    interrupted: {
      label: '업로드 중단됨',
      detail: '녹음은 이 브라우저에 남아 있습니다.',
    },
    failed_retryable: {
      label: '업로드 실패 — 다시 시도할 수 있습니다',
      detail: '녹음은 이 브라우저에 남아 있습니다.',
    },
  },

  transcriptionJob: {
    queued: { label: '전사 대기 중' },
    transcribing: { label: '전사 중' },
    completed: { label: '전사 완료' },
    failed_retryable: { label: '전사 실패 — 다시 시도할 수 있습니다' },
  },

  transcriptRevision: {
    transcript_reviewing: { label: '전사 교정 중' },
    transcript_approved: { label: '전사 확정됨' },
  },

  documentRun: {
    queued: { label: '정리 대기 중' },
    documenting: { label: '정리 중' },
    proposed: { label: '검수 대기' },
    // 아래 둘은 technical-foundation이 상태 이름만 정했다. 문구 미확정.
    auth_required: {
      label: '로그인이 필요합니다',
      detail: '모델 인증이 만료되었을 수 있습니다.',
      provisional: true,
    },
    waiting_for_model: {
      label: '모델 응답을 기다리는 중',
      provisional: true,
    },
    failed_retryable: { label: '정리 실패 — 다시 시도할 수 있습니다' },
  },

  document: {
    reviewing: { label: '검수 중' },
    current: { label: '확정본' },
    stale: {
      label: '전사가 바뀌어 오래된 문서',
      detail: '전사를 다시 확정했으므로 이 문서는 최신이 아닙니다.',
    },
  },
}

export function describeState(ref: StateRef): Phrase {
  const machineTable = TABLE[ref.machine]
  if (!machineTable) {
    throw new Error(`알 수 없는 상태 머신: ${ref.machine}`)
  }
  const entry = machineTable[ref.state]
  if (!entry) {
    // 조용히 빈 문구를 내면 화면에 아무것도 안 나오고 아무도 모른다
    throw new Error(
      `${ref.machine} 머신에 '${ref.state}' 상태가 없다. 다른 머신의 상태를 넘긴 것은 아닌지 확인한다.`
    )
  }
  return {
    machine: ref.machine,
    state: ref.state,
    label: entry.label,
    detail: entry.detail ?? null,
    provisional: entry.provisional ?? false,
  }
}

export function isPlaceholderPhrase(p: Phrase): boolean {
  return p.provisional
}

export type NextActionKind =
  | 'resume_upload'
  | 'retry_upload'
  | 'start_transcription'
  | 'retry_transcription'
  | 'open_transcript_review'
  | 'start_documentation'
  // ⛔ 전사 재시도와 **다른** 조작이다. 같은 kind로 두면 화면이 엉뚱한 것을
  //    다시 돌린다. 실제로 documentRun의 재시도가 `retry_transcription`이었다.
  | 'retry_documentation'
  | 'open_document_review'

export type NextAction = { kind: NextActionKind; label: string }

/**
 * 이 상태에서 사용자가 할 수 있는 다음 조작.
 *
 * PLAN.md 순서 3: "브라우저를 닫았다가 다시 열면 같은 source의 현재 상태와
 * **다음 조작**이 표시된다." 상태만 보여주고 조작을 안 주면, 사용자는 멈춘
 * 화면 앞에서 무엇을 해야 할지 모른다.
 *
 * 기다리는 것 말고 할 게 없으면 `null`이다 — 없는 버튼을 지어내지 않는다.
 */
export function nextActionFor(ref: StateRef): NextAction | null {
  switch (ref.machine) {
    case 'source':
      // ⛔ ready 이전 source는 전사 job을 만들지 못한다 (5절)
      return ref.state === 'ready'
        ? { kind: 'start_transcription', label: '전사 시작' }
        : null

    case 'upload':
      if (ref.state === 'interrupted') {
        return { kind: 'resume_upload', label: '업로드 이어서 하기' }
      }
      if (ref.state === 'failed_retryable') {
        return { kind: 'retry_upload', label: '업로드 다시 시도' }
      }
      return null

    case 'transcriptionJob':
      if (ref.state === 'failed_retryable') {
        return { kind: 'retry_transcription', label: '전사 다시 시도' }
      }
      if (ref.state === 'completed') {
        return { kind: 'open_transcript_review', label: '전사 교정하기' }
      }
      return null

    case 'transcriptRevision':
      // ⛔ 확정한 뒤의 다음 조작은 「전사 교정하기」가 아니라 「AI 정리 시작」이다.
      //    전사 job만 보면 이 구분이 사라지고, 확정된 회의가 영영 "교정 전"이 된다.
      return ref.state === 'transcript_approved'
        ? { kind: 'start_documentation', label: 'AI 정리 시작' }
        : { kind: 'open_transcript_review', label: '전사 교정하기' }

    case 'documentRun':
      if (ref.state === 'proposed') {
        return { kind: 'open_document_review', label: '검수하기' }
      }
      if (ref.state === 'failed_retryable') {
        return { kind: 'retry_documentation', label: '정리 다시 시도' }
      }
      if (ref.state === 'auth_required') {
        return { kind: 'retry_documentation', label: '다시 시도' }
      }
      return null

    default:
      return null
  }
}
