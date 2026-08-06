/**
 * 전사 job API와 세션 복구 — PLAN.md 순서 3.
 *
 * 완료 조건 두 개를 여기서 지킨다.
 *   · "브라우저를 닫았다가 다시 열면 같은 source의 **현재 상태와 다음 조작**이 표시된다"
 *   · "화면의 상태가 source와 transcription job 중 **어느 객체의 상태인지** 추적할 수 있다"
 *
 * ⛔ 그래서 DTO는 `state` 하나로 뭉치지 않고 `sourceState`·`jobState`로 나눠 낸다.
 *    합치는 순간 화면이 어느 객체 이야기인지 알 수 없게 된다.
 */

import { type StateRef, describeState, nextActionFor } from '@ratatouille/contracts'
import { Hono } from 'hono'
import { SourceNotFoundError, type SourceRepository } from '../sources/repository.ts'
import {
  SourceNotReadyError,
  type TranscriptionJob,
  type TranscriptionQueue,
} from '../transcription/queue.ts'

function jobDto(j: TranscriptionJob) {
  const ref: StateRef = { machine: 'transcriptionJob', state: j.state }
  const phrase = describeState(ref)
  return {
    id: j.id,
    sourceId: j.sourceId,
    // 어느 머신의 상태인지 이름에 박아둔다
    jobState: j.state,
    phrase: { label: phrase.label, detail: phrase.detail, provisional: phrase.provisional },
    // 재시도해도 소용없는 실패에는 재시도 조작을 주지 않는다
    nextAction: j.retryable ? nextActionFor(ref) : null,
    retryable: j.retryable,
    error: j.error,
    warning: j.warning,
    audioMs: j.audioMs,
    elapsedMs: j.elapsedMs,
    segmentCount: j.segmentCount,
  }
}

export function transcriptionRoutes(
  sources: SourceRepository,
  queue: TranscriptionQueue
): Hono {
  const app = new Hono()

  /** 전사 시작. ready가 아니면 409 — 화면 밖 경로로도 새어 들어오지 못한다. */
  app.post('/sources/:id/transcribe', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    try {
      const job = await queue.enqueue(id, { vocabulary: body?.vocabulary })
      return c.json(jobDto(job), 202)
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      if (e instanceof SourceNotReadyError) {
        return c.json({ error: e.message, sourceState: e.state }, 409)
      }
      throw e
    }
  })

  app.get('/transcriptions/:jobId', (c) => {
    const job = queue.get(c.req.param('jobId'))
    if (!job) return c.json({ error: '전사 job을 찾을 수 없다' }, 404)
    return c.json(jobDto(job))
  })

  /**
   * 세션 복구 — 브라우저가 재접속하면 여기부터 본다.
   *
   * ⛔ source 상태와 job 상태를 **각각** 낸다. 하나로 합치면
   *    "지금 뭐 하는 중이지"를 화면이 되짚을 수 없다.
   */
  app.get('/session', (c) => {
    const items = sources.list().map((s) => {
      const sourceRef: StateRef = { machine: 'source', state: s.state }
      const sourcePhrase = describeState(sourceRef)
      const job = queue.latestFor(s.id)

      return {
        sourceId: s.id,
        sourceState: s.state,
        sourcePhrase: {
          label: sourcePhrase.label,
          detail: sourcePhrase.detail,
          provisional: sourcePhrase.provisional,
        },
        chunkCount: s.chunks.length,
        // 클라이언트가 "무엇을 더 올려야 하나"를 바로 안다 —
        // 이미 올린 것을 다시 올리지 않는 근거다
        missing: s.state === 'ready' ? {} : sources.missing(s.id),
        captureMode: s.manifest?.captureMode ?? null,
        startedAt: s.manifest?.startedAt ?? null,
        job: job ? jobDto(job) : null,
        // job이 있으면 job의 다음 조작이, 없으면 source의 다음 조작이 우선한다.
        // 전사가 돌고 있는데 "전사 시작"을 권하면 중복 실행을 유도한다.
        nextAction: job
          ? job.retryable
            ? nextActionFor({ machine: 'transcriptionJob', state: job.state })
            : null
          : nextActionFor(sourceRef),
      }
    })

    return c.json({
      sources: items,
      // 아직 끝나지 않은 것만 따로 — 재접속 화면이 여기부터 보여준다
      inProgress: items
        .filter((i) => i.sourceState !== 'ready' || i.job?.jobState !== 'completed')
        .map((i) => i.sourceId),
    })
  })

  return app
}
