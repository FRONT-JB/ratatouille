/**
 * 결정 사항 API — GOAL 6.10.
 *
 * ⛔ **모델이 채우지 못하는 것을 사람이 채우는 자리다.** 결정자는 화자 분리를
 *    접었으므로 모델이 모르고, 대체 관계는 지난 회의를 아는 사람만 안다.
 *    이 경로가 없으면 저장소가 부를 사람 없는 코드가 된다.
 */

import { type Decision, RuleViolationError } from '@ratatouille/contracts'
import { type Context, Hono } from 'hono'
import { type DecisionStore, DecisionNotFoundError } from '../decisions/store.ts'

function toDto(d: Decision) {
  return {
    decisionId: d.id,
    sourceId: d.sourceId,
    runId: d.runId,
    what: d.what,
    why: d.why,
    who: d.who,
    evidence: d.evidence,
    /*
     * ⛔ 이름에 `decision`을 박는다. `status`만 두면 문서 상태(`current`)와
     *    같은 자리에 놓여, 화면이 다른 머신의 값을 비교하기 시작한다.
     */
    decisionState: d.state,
    decidedAt: d.decidedAt,
    supersedes: d.supersedes,
  }
}

export function decisionRoutes(decisions: DecisionStore): Hono {
  const app = new Hono()

  /**
   * 한 회의의 결정.
   *
   * ⛔ 대체·뒤집힌 것도 함께 낸다. 거르는 것은 화면의 판단이고, 여기서
   *    감추면 "왜 바뀌었나"를 볼 길이 없다.
   */
  app.get('/:id/decisions', async (c) => {
    const all = await decisions.listFor(c.req.param('id'))
    return c.json({ decisions: all.map(toDto) })
  })

  /** 사람이 결정자와 이유를 채운다 */
  app.patch('/decisions/:decisionId', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      who?: string | null
      why?: string | null
    } | null
    if (!body || (!('who' in body) && !('why' in body))) {
      return c.json({ error: 'who 또는 why가 필요합니다.' }, 400)
    }

    return withDecisionErrors(c, async () =>
      c.json(toDto(await decisions.annotate(c.req.param('decisionId'), body)))
    )
  })

  /**
   * 이 결정이 다른 결정을 대체한다.
   *
   * ⛔ **대체하는 쪽에서 건다.** 이전 결정에 「대체됨」을 적는 형태로 두면
   *    관계가 양쪽에 살고 반드시 갈라진다(9절).
   */
  app.post('/decisions/:decisionId/supersede', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { previousId?: string } | null
    if (!body?.previousId) return c.json({ error: 'previousId가 필요합니다.' }, 400)

    const id = c.req.param('decisionId')
    return withDecisionErrors(c, async () => {
      await decisions.supersede(body.previousId!, id)
      return c.json(toDto((await decisions.get(id))!))
    })
  })

  /** 결정을 뒤집는다. 대체와 다르다 — 다른 결론이 아니라 없던 일이다 */
  app.post('/decisions/:decisionId/reverse', async (c) =>
    withDecisionErrors(c, async () =>
      c.json(toDto(await decisions.reverse(c.req.param('decisionId'))))
    )
  )

  return app
}

/**
 * 결정 API의 오류를 상태 코드로 옮긴다.
 *
 * ⛔ **여기서 규칙을 판정하지 않는다.** 「이미 대체된 결정」인지는 계약이 알고,
 *    라우트는 그 거절을 409로 옮길 뿐이다. 두 곳에서 판정하면 갈라진다.
 */
async function withDecisionErrors(
  c: Context,
  run: () => Promise<Response>
): Promise<Response> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof DecisionNotFoundError) return c.json({ error: e.message }, 404)
    if (e instanceof RuleViolationError) {
      return c.json({ error: e.message, rule: e.rule }, 409)
    }
    throw e
  }
}
