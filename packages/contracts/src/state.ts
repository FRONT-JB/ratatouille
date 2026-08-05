/**
 * Ratatouille 처리 상태 — technical-foundation.md 5절 `분리된 처리 상태`.
 *
 * ⛔ 이 파일의 5개 상태는 **서로 다른 객체**다.
 *    하나의 `Source 수명주기`로 합치지 않는다. 타입을 분리해 둔 이유가 그것이다.
 *
 * ```text
 * source_state:        capturing → finalizing → ready
 * upload_health:       syncing ↔ synced
 *                         └────→ interrupted / failed_retryable
 *
 * transcription_job:   queued → transcribing → completed
 *                         └──────────────────→ failed_retryable
 *
 * transcript_revision: transcript_reviewing → transcript_approved
 *                               ↑                   │
 *                               └────── edit ───────┘
 *
 * document_run:        queued → documenting → proposed
 *                         └────→ auth_required / waiting_for_model / failed_retryable
 *
 * document_state:      reviewing → current
 *                          ↑          │
 *                          └─ stale ←─┘
 * ```
 *
 * 사용자용 문구는 여기 두지 않는다. 내부 상태명과 화면 문구는 별도 매핑이다
 * (PLAN.md 순서 3 완료 조건).
 */

// ─────────────────────────── source ───────────────────────────

export const SOURCE_STATES = ['capturing', 'finalizing', 'ready'] as const
export type SourceState = (typeof SOURCE_STATES)[number]

export const UPLOAD_HEALTHS = [
  'syncing',
  'synced',
  'interrupted',
  'failed_retryable',
] as const
export type UploadHealth = (typeof UPLOAD_HEALTHS)[number]

// ──────────────────────── transcription ────────────────────────

export const TRANSCRIPTION_JOB_STATES = [
  'queued',
  'transcribing',
  'completed',
  'failed_retryable',
] as const
export type TranscriptionJobState = (typeof TRANSCRIPTION_JOB_STATES)[number]

export const TRANSCRIPT_REVISION_STATES = [
  'transcript_reviewing',
  'transcript_approved',
] as const
export type TranscriptRevisionState =
  (typeof TRANSCRIPT_REVISION_STATES)[number]

// ───────────────────────── document ─────────────────────────

export const DOCUMENT_RUN_STATES = [
  'queued',
  'documenting',
  'proposed',
  'auth_required',
  'waiting_for_model',
  'failed_retryable',
] as const
export type DocumentRunState = (typeof DOCUMENT_RUN_STATES)[number]

export const DOCUMENT_STATES = ['reviewing', 'current', 'stale'] as const
export type DocumentState = (typeof DOCUMENT_STATES)[number]

// ─────────────────────── 전이 규칙 ───────────────────────

const SOURCE_TRANSITIONS: Record<SourceState, readonly SourceState[]> = {
  capturing: ['finalizing'],
  finalizing: ['ready'],
  ready: [],
}

const UPLOAD_TRANSITIONS: Record<UploadHealth, readonly UploadHealth[]> = {
  syncing: ['synced', 'interrupted', 'failed_retryable'],
  synced: ['syncing', 'interrupted', 'failed_retryable'],
  interrupted: ['syncing'],
  failed_retryable: ['syncing'],
}

const TRANSCRIPTION_JOB_TRANSITIONS: Record<
  TranscriptionJobState,
  readonly TranscriptionJobState[]
> = {
  queued: ['transcribing', 'failed_retryable'],
  transcribing: ['completed', 'failed_retryable'],
  completed: [],
  failed_retryable: ['queued'],
}

const TRANSCRIPT_REVISION_TRANSITIONS: Record<
  TranscriptRevisionState,
  readonly TranscriptRevisionState[]
> = {
  transcript_reviewing: ['transcript_approved'],
  // 확정본을 다시 편집하는 것은 **새 revision을 여는 것**이지
  // 같은 revision을 되돌리는 것이 아니다. openNewRevision()을 쓴다.
  transcript_approved: [],
}

const DOCUMENT_RUN_TRANSITIONS: Record<
  DocumentRunState,
  readonly DocumentRunState[]
> = {
  queued: [
    'documenting',
    'auth_required',
    'waiting_for_model',
    'failed_retryable',
  ],
  documenting: [
    'proposed',
    'auth_required',
    'waiting_for_model',
    'failed_retryable',
  ],
  proposed: [],
  auth_required: ['queued'],
  waiting_for_model: ['documenting', 'failed_retryable'],
  failed_retryable: ['queued'],
}

const DOCUMENT_TRANSITIONS: Record<DocumentState, readonly DocumentState[]> = {
  reviewing: ['current'],
  current: ['stale'],
  stale: ['reviewing'],
}

/** 각 상태 머신의 전이표. 키가 곧 머신 이름이다. */
export const TRANSITIONS = {
  source: SOURCE_TRANSITIONS,
  upload: UPLOAD_TRANSITIONS,
  transcriptionJob: TRANSCRIPTION_JOB_TRANSITIONS,
  transcriptRevision: TRANSCRIPT_REVISION_TRANSITIONS,
  documentRun: DOCUMENT_RUN_TRANSITIONS,
  document: DOCUMENT_TRANSITIONS,
} as const

export type MachineName = keyof typeof TRANSITIONS

/**
 * 전이가 허용되는지 판정한다.
 *
 * 상태 값이 머신 간에 겹치므로(`queued`, `failed_retryable` 등) 반드시
 * 머신 이름을 함께 넘겨야 한다. 이것이 "서로 다른 객체"를 코드로 강제하는 방식이다.
 */
export function canTransition<M extends MachineName>(
  machine: M,
  from: keyof (typeof TRANSITIONS)[M],
  to: string
): boolean {
  const table = TRANSITIONS[machine] as Record<string, readonly string[]>
  return table[from as string]?.includes(to) ?? false
}

/** 전이를 수행한다. 허용되지 않으면 던진다. */
export function transition<M extends MachineName>(
  machine: M,
  from: keyof (typeof TRANSITIONS)[M],
  to: string
): string {
  if (!canTransition(machine, from, to)) {
    throw new InvalidTransitionError(machine, String(from), to)
  }
  return to
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string
  ) {
    super(`${machine}: '${from}' → '${to}' 전이는 허용되지 않는다`)
    this.name = 'InvalidTransitionError'
  }
}
