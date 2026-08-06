/**
 * 파일 업로드 source — PLAN.md 순서 3.
 *
 * ⛔ **녹음과 같은 수집 경로를 탄다.** 파일을 조각으로 잘라 같은 chunk API로
 *    올린다. 별도 업로드 endpoint를 만들면 멱등 수신·재개 질의·hash 검증·
 *    ready 판정을 전부 두 번 구현하게 되고, 둘 중 하나는 반드시 뒤처진다.
 *
 * ⛔ **업로드가 끝난 것과 서버 검증까지 끝난 `ready`는 다르다** (완료 조건 2).
 *    마지막 조각을 보냈다고 ready가 아니다. finalize가 조각 수·hash·순번을
 *    확인해야 ready가 된다.
 */

import type { RecordingManifest } from '@ratatouille/contracts'

/** 조각 크기. 5초 녹음 조각(약 80KB)보다 크지만 재전송 단위로 적당하다. */
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024

export const ACCEPTED_AUDIO = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/x-m4a',
]

export type UploadPhase =
  | 'idle'
  | 'uploading'
  | 'verifying'
  | 'ready'
  | 'rejected'
  | 'failed'

export type UploadState = {
  phase: UploadPhase
  sourceId: string | null
  /** 0~1. 업로드만의 진행률이다 — 검증 진행률이 아니다 */
  progress: number
  sentChunks: number
  totalChunks: number
  error: string | null
  /** 서버 검증이 거부한 이유. 한국어 문구다 */
  violations: string[]
}

export const INITIAL_UPLOAD: UploadState = {
  phase: 'idle',
  sourceId: null,
  progress: 0,
  sentChunks: 0,
  totalChunks: 0,
  error: null,
  violations: [],
}

export function isAcceptedAudio(file: { type: string; name: string }): boolean {
  if (ACCEPTED_AUDIO.includes(file.type)) return true
  // 브라우저가 type을 못 채우는 경우가 있다. 확장자로 한 번 더 본다.
  return /\.(mp3|m4a|wav|webm|ogg|flac|mp4|aac)$/i.test(file.name)
}

export function chunkCountFor(size: number, chunkBytes = UPLOAD_CHUNK_BYTES): number {
  return Math.max(1, Math.ceil(size / chunkBytes))
}

/**
 * 업로드 source의 manifest.
 *
 * 녹음이 아니므로 장치·일시정지가 없다. `captureMode`는 `in_person`으로 둔다 —
 * ⚠️ 화자 분리(`-di`)는 스테레오 2track 녹음에만 의미가 있고, 업로드된 파일이
 *    그런 구조라는 보장이 없다. 잘못 켜면 없는 화자를 만들어낸다.
 */
export function buildUploadManifest(input: {
  sourceId: string
  fileName: string
  startedAt: string
}): RecordingManifest {
  return {
    sourceId: input.sourceId,
    captureMode: 'in_person',
    startedAt: input.startedAt,
    devices: { mic: `업로드: ${input.fileName}` },
    tracks: ['mic'],
    expectedChunks: {},
    pauses: [],
    // 업로드 조각은 시간 단위가 아니라 바이트 단위로 자른다.
    // 0이 아닌 값을 넣으면 시간 계산이 틀린다.
    chunkDurationMs: 0,
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type UploadDeps = {
  fetch?: FetchLike
  baseUrl?: string
  chunkBytes?: number
  newSourceId?: () => string
  now?: () => number
  onProgress?: (s: UploadState) => void
}

/**
 * 파일 하나를 올리고 서버 검증까지 마친다.
 *
 * 단계마다 상태를 알린다 — 업로드 진행률 / 서버 검증 / ready 도달이
 * 화면에서 각각 다르게 보여야 한다 (완료 조건 2).
 */
export async function uploadFile(
  file: File,
  deps: UploadDeps = {}
): Promise<UploadState> {
  const fetchFn = deps.fetch ?? ((u, i) => fetch(u, i))
  const baseUrl = deps.baseUrl ?? ''
  const chunkBytes = deps.chunkBytes ?? UPLOAD_CHUNK_BYTES
  const now = deps.now ?? (() => Date.now())

  let state: UploadState = { ...INITIAL_UPLOAD }
  const emit = (patch: Partial<UploadState>) => {
    state = { ...state, ...patch }
    deps.onProgress?.(state)
    return state
  }

  if (!isAcceptedAudio(file)) {
    return emit({
      phase: 'rejected',
      error: `오디오 파일이 아닙니다: ${file.name}`,
    })
  }
  if (file.size === 0) {
    return emit({ phase: 'rejected', error: '빈 파일은 올릴 수 없습니다.' })
  }

  const sourceId = deps.newSourceId?.() ?? `up_${now().toString(36)}`
  const total = chunkCountFor(file.size, chunkBytes)
  emit({ phase: 'uploading', sourceId, totalChunks: total, progress: 0 })

  const manifest = buildUploadManifest({
    sourceId,
    fileName: file.name,
    startedAt: new Date(now()).toISOString(),
  })

  try {
    const created = await fetchFn(`${baseUrl}/api/sources`, {
      method: 'POST',
      body: JSON.stringify(manifest),
      headers: { 'content-type': 'application/json' },
    })
    if (!created.ok) {
      return emit({ phase: 'failed', error: `source를 열지 못했습니다 (HTTP ${created.status})` })
    }

    for (let seq = 0; seq < total; seq++) {
      const slice = file.slice(seq * chunkBytes, (seq + 1) * chunkBytes)
      const res = await fetchFn(
        `${baseUrl}/api/sources/${sourceId}/chunks/mic/${seq}`,
        { method: 'PUT', body: slice }
      )
      if (!res.ok) {
        return emit({
          phase: 'failed',
          error: `조각 ${seq} 업로드에 실패했습니다 (HTTP ${res.status})`,
        })
      }
      emit({ sentChunks: seq + 1, progress: (seq + 1) / total })
    }

    // ⛔ 여기서 끝이 아니다. 서버가 검증해야 ready다.
    emit({ phase: 'verifying' })

    const fin = await fetchFn(`${baseUrl}/api/sources/${sourceId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ expectedChunks: { mic: total } }),
      headers: { 'content-type': 'application/json' },
    })
    const body = (await fin.json()) as {
      sourceState?: string
      violations?: Array<{ message: string }>
    }

    if (body.sourceState !== 'ready') {
      return emit({
        phase: 'failed',
        error: '서버 검증을 통과하지 못했습니다.',
        violations: (body.violations ?? []).map((v) => v.message),
      })
    }

    return emit({ phase: 'ready', progress: 1 })
  } catch (e) {
    return emit({
      phase: 'failed',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
