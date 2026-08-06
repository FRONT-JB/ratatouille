/**
 * AI 정리 API.
 *
 * ⛔ **확정 전에는 생성 자체가 안 된다.** 규칙 2가 큐 진입점에서 막고,
 *    여기서는 그 거절을 409로 옮길 뿐이다. 판단을 두 곳에서 하지 않는다.
 */

import { RuleViolationError, describeViolation } from '@ratatouille/contracts'
import { Hono } from 'hono'
import type { DocumentQueue, DocumentRun } from '../documents/queue.ts'
import { SourceNotFoundError } from '../sources/repository.ts'

function toDto(run: DocumentRun) {
  return {
    runId: run.id,
    sourceId: run.sourceId,
    revisionId: run.revisionId,
    // 어느 머신의 상태인지 이름에 박아둔다
    documentRunState: run.state,
    error: run.error,
    /** 사람이 읽는 말로 옮긴 위반. 화면이 그대로 보여준다 */
    violations: run.violations.map((v) => ({
      kind: v.kind,
      message: describeViolation(v),
    })),
    elapsedMs: run.elapsedMs,
    createdAt: run.createdAt,
    proposal: run.proposal,
  }
}

export function documentRoutes(documents: DocumentQueue): Hono {
  const app = new Hono()

  app.post('/:id/document', async (c) => {
    try {
      return c.json(toDto(await documents.enqueue(c.req.param('id'))))
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      if (e instanceof RuleViolationError) {
        return c.json({ error: e.message, rule: e.rule }, 409)
      }
      throw e
    }
  })

  app.get('/:id/document', (c) => {
    const run = documents.latestFor(c.req.param('id'))
    if (!run) {
      // 없는 것은 오류가 아니다 — 아직 안 만들었을 뿐이다.
      return c.json({ documentRunState: null, proposal: null })
    }
    return c.json(toDto(run))
  })

  return app
}
