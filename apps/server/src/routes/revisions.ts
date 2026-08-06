/**
 * 전사 교정 API.
 *
 * ⛔ 교정본은 raw transcript와 **다른 객체다.** 화면이 어느 쪽을 보고 있는지
 *    구분할 수 있도록 상태 이름에 `revision`을 박아 내보낸다.
 */

import { RuleViolationError } from '@ratatouille/contracts'
import { Hono } from 'hono'
import {
  RevisionLockedError,
  RevisionNotFoundError,
  type RevisionStore,
  UnknownSegmentError,
  toRevisionDto,
} from '../revisions/store.ts'
import type { RunArtifactStore } from '../runs/store.ts'
import { SourceNotFoundError, type SourceRepository } from '../sources/repository.ts'
import type { TranscriptionQueue } from '../transcription/queue.ts'

type RawTranscript = {
  segments?: { id: string; startMs: number; endMs: number; text: string }[]
}

export function revisionRoutes(
  sources: SourceRepository,
  queue: TranscriptionQueue,
  revisions: RevisionStore,
  runs: RunArtifactStore
): Hono {
  const app = new Hono()

  /**
   * 완료된 전사에서 교정본을 연다(이미 있으면 그대로).
   *
   * ⚠️ 여기서 열지 않으면 화면이 "전사는 끝났는데 고칠 것이 없다"는 상태에
   *    빠진다. 열기는 멱등하다.
   */
  async function ensure(sourceId: string) {
    const existing = revisions.current(sourceId)
    if (existing) return existing

    // source가 없으면 404. 있는지 확인하는 책임은 저장소가 진다.
    sources.get(sourceId)

    const job = queue.latestFor(sourceId)
    if (!job || job.state !== 'completed') return null

    const raw = (await runs.readRawTranscript(job.id)) as RawTranscript | null
    if (!raw?.segments?.length) return null

    return revisions.open({ sourceId, jobId: job.id, segments: raw.segments })
  }

  app.get('/:id/revision', async (c) => {
    try {
      const rev = await ensure(c.req.param('id'))
      if (!rev) {
        return c.json(
          { error: '아직 전사가 끝나지 않아 교정할 내용이 없습니다.' },
          404
        )
      }
      return c.json(toRevisionDto(rev))
    } catch (e) {
      return fail(c, e)
    }
  })

  app.patch('/:id/revision', async (c) => {
    try {
      await ensure(c.req.param('id'))
      const body = (await c.req.json()) as {
        segments?: { id?: string; text?: string }[]
      }
      const patches = (body.segments ?? [])
        // ⛔ startMs·endMs가 와도 **무시한다.** evidence가 timestamp로 원문을
        //    가리키므로, 화면이 보낸 값으로 시간축을 바꾸면 인용이 깨진다.
        .filter((s): s is { id: string; text: string } =>
          typeof s.id === 'string' && typeof s.text === 'string'
        )
        .map((s) => ({ id: s.id, text: s.text }))

      const rev = await revisions.edit(c.req.param('id'), patches)
      return c.json(toRevisionDto(rev))
    } catch (e) {
      return fail(c, e)
    }
  })

  app.post('/:id/revision/approve', async (c) => {
    try {
      const opened = await ensure(c.req.param('id'))
      if (!opened) {
        return c.json({ error: '확정할 교정본이 없습니다.' }, 404)
      }
      return c.json(toRevisionDto(await revisions.approve(c.req.param('id'))))
    } catch (e) {
      return fail(c, e)
    }
  })

  app.post('/:id/revision/reopen', async (c) => {
    try {
      // ⛔ 먼저 연다. 안 그러면 "아직 확정 안 했다"(409)여야 할 상황이
      //    "교정본이 없다"(404)로 나가서, 화면이 원인을 잘못 짚는다.
      const opened = await ensure(c.req.param('id'))
      if (!opened) {
        return c.json({ error: '다시 열 교정본이 없습니다.' }, 404)
      }
      return c.json(toRevisionDto(await revisions.reopen(c.req.param('id'))))
    } catch (e) {
      return fail(c, e)
    }
  })

  return app
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fail(c: any, e: unknown) {
  if (e instanceof SourceNotFoundError || e instanceof RevisionNotFoundError) {
    return c.json({ error: e.message }, 404)
  }
  // 확정본을 고치려는 시도는 서버 잘못이 아니라 요청 충돌이다
  if (e instanceof RevisionLockedError) return c.json({ error: e.message }, 409)
  if (e instanceof RuleViolationError) {
    return c.json({ error: e.message, rule: e.rule }, 409)
  }
  if (e instanceof UnknownSegmentError) return c.json({ error: e.message }, 400)
  throw e
}
