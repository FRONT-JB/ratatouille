/**
 * AI 정리 API.
 *
 * ⛔ **확정 전에는 생성 자체가 안 된다.** 규칙 2가 큐 진입점에서 막고,
 *    여기서는 그 거절을 409로 옮길 뿐이다. 판단을 두 곳에서 하지 않는다.
 */

import {
  REVIEW_SECTIONS,
  type ReviewBlocker,
  type ReviewSection,
  RuleViolationError,
  type RubricVerdict,
  SECTION_REVIEW_STATES,
  type SectionReviewState,
  describeViolation,
} from '@ratatouille/contracts'
import { Hono } from 'hono'
import {
  type DocumentQueue,
  type DocumentRun,
  DocumentRunNotFoundError,
} from '../documents/queue.ts'
import { SourceNotFoundError } from '../sources/repository.ts'

function toDto(run: DocumentRun, blockers: ReviewBlocker[] = []) {
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
    /*
     * ⛔ 검수 상태와 문서 상태를 **따로** 낸다. run은 "모델이 만들었나",
     *    document는 "사람이 확정했나" — 다른 머신이다.
     */
    review: run.review,
    documentState: run.documentState,
    /** 무엇이 확정을 막고 있나. 막기만 하고 이유를 안 주면 못 끝낸다 */
    blockers,
  }
}

export function documentRoutes(documents: DocumentQueue): Hono {
  const app = new Hono()

  app.post('/:id/document', async (c) => {
    /*
     * ⛔ **누가 시켰는지 남긴다.** 내가 시작하지 않은 실행이 여러 번 생겼는데
     *    화면을 열어두는 것으로도, 테스트 전체를 돌려도 재현되지 않아 출처를
     *    못 밝혔다. 모델 호출은 시간과 돈을 쓰므로 추측으로 넘기지 않는다.
     */
    console.log(
      `[document] POST ${c.req.param('id')}` +
        ` referer=${c.req.header('referer') ?? '-'}` +
        ` ua=${(c.req.header('user-agent') ?? '-').slice(0, 60)}`
    )
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
    return c.json(toDto(run, documents.blockers(run.id)))
  })

  /**
   * section 하나의 검수 상태를 바꾼다.
   *
   * ⛔ **run id를 받는다.** source id로 받으면 「지금 최신」에 적용되는데,
   *    검수 도중에 다시 정리하면 엉뚱한 결과에 「확인함」이 붙는다.
   */
  app.patch('/:id/document/review', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      runId?: string
      section?: ReviewSection
      state?: SectionReviewState
      rubric?: Record<string, RubricVerdict>
    } | null

    if (!body?.runId || !body.section) {
      return c.json({ error: 'runId와 section이 필요합니다.' }, 400)
    }
    if (!REVIEW_SECTIONS.includes(body.section)) {
      return c.json({ error: `알 수 없는 section: ${body.section}` }, 400)
    }
    if (body.state && !SECTION_REVIEW_STATES.includes(body.state)) {
      return c.json({ error: `알 수 없는 검수 상태: ${body.state}` }, 400)
    }

    try {
      const run = await documents.review(body.runId, body.section, {
        state: body.state,
        rubric: body.rubric,
      })
      return c.json(toDto(run, documents.blockers(run.id)))
    } catch (e) {
      if (e instanceof DocumentRunNotFoundError) {
        return c.json({ error: e.message }, 404)
      }
      if (e instanceof RuleViolationError) {
        return c.json({ error: e.message, rule: e.rule }, 409)
      }
      throw e
    }
  })

  /** 검수를 마치고 확정한다. 규칙 7이 큐에서 강제한다 */
  app.post('/:id/document/current', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { runId?: string } | null
    if (!body?.runId) return c.json({ error: 'runId가 필요합니다.' }, 400)

    try {
      const run = await documents.promote(body.runId)
      return c.json(toDto(run, documents.blockers(run.id)))
    } catch (e) {
      if (e instanceof DocumentRunNotFoundError) {
        return c.json({ error: e.message }, 404)
      }
      if (e instanceof RuleViolationError) {
        return c.json({ error: e.message, rule: e.rule }, 409)
      }
      throw e
    }
  })

  return app
}
