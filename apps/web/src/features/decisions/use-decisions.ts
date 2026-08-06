import { useCallback, useEffect, useState } from 'react'
import type { DecisionState } from '@ratatouille/contracts'
import type { FetchLike } from '../processing/session'

/**
 * 한 회의의 결정 이력을 읽고 고친다 — GOAL 6.10.
 *
 * ⛔ **모델이 채우지 못하는 값을 사람이 채우는 자리다.** 결정자는 화자 분리를
 *    접어서 모델이 모르고, 대체 관계는 지난 회의를 아는 사람만 안다. 부르는
 *    화면이 없으면 서버의 이 경로들은 「테스트가 통과하는 죽은 코드」다.
 *
 * ⛔ **거르지 않는다.** 서버는 대체·뒤집힌 결정도 함께 낸다. 여기서 `active`만
 *    남기면 「왜 바뀌었나」를 볼 길이 사라진다 — 이 entity가 있는 이유가 그것이다.
 */

/**
 * 서버 응답 그대로.
 *
 * ⛔ 상태 필드 이름이 `decisionState`다. `status`로 줄여 받으면 문서 상태
 *    (`current`)와 같은 자리에 놓여, 화면이 다른 머신의 값을 비교하기 시작한다.
 */
export type DecisionView = {
  decisionId: string
  sourceId: string
  runId: string
  /** 결정 내용. 근거 마커(`[seg_1]`)가 문장 안에 있다 */
  what: string
  why: string | null
  who: string | null
  evidence: string[]
  decisionState: DecisionState
  decidedAt: string
  /** 이 결정이 대체한 이전 결정. ⛔ 역방향(`superseded_by`)은 저장되지 않는다(9절) */
  supersedes: string | null
}

export type DecisionDeps = { fetch?: FetchLike }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function useDecisions(sourceId: string, deps: DecisionDeps = {}) {
  const [decisions, setDecisions] = useState<DecisionView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fetchFn = deps.fetch

  const request = useCallback(
    async (url: string, init?: RequestInit): Promise<unknown> => {
      const res = await (fetchFn ?? fetch)(url, init)
      if (!res.ok) {
        /*
         * ⛔ **서버가 거절한 이유를 그대로 올린다.** 규칙 위반은 409 + `error`로
         *    온다("이미 다른 결정으로 대체된 결정입니다"). 「저장 실패」로 뭉개면
         *    사용자는 무엇이 막혔는지 알 수 없고, 같은 조작을 계속 다시 누른다.
         */
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `요청이 실패했습니다 (${res.status})`)
      }
      return await res.json()
    },
    [fetchFn]
  )

  const load = useCallback(async () => {
    try {
      const body = (await request(`/api/sources/${sourceId}/decisions`)) as {
        decisions?: DecisionView[]
      }
      setDecisions(body.decisions ?? [])
      setError(null)
    } catch (e) {
      setError(message(e))
    }
  }, [request, sourceId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  /**
   * 고치고 나서 **목록을 다시 읽는다.**
   *
   * ⛔ 응답으로 온 결정 하나만 화면에 꽂으면 안 된다. 대체는 **두 결정**을
   *    바꾸는데 응답은 대체하는 쪽 하나뿐이라, 이전 결정이 화면에서 계속
   *    「유효」로 남는다. 되돌릴 수 없는 조작에서 그건 거짓말이다.
   */
  const mutate = useCallback(
    async (url: string, init: RequestInit): Promise<boolean> => {
      setBusy(true)
      try {
        await request(url, init)
        await load()
        setError(null)
        return true
      } catch (e) {
        setError(message(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [request, load]
  )

  /** 사람이 결정자·이유를 채운다. ⛔ 빈 칸은 `null`이다 — 그런 이름의 사람이 없다 */
  const annotate = useCallback(
    (decisionId: string, patch: { who?: string | null; why?: string | null }) =>
      mutate(`/api/sources/decisions/${decisionId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        headers: { 'content-type': 'application/json' },
      }),
    [mutate]
  )

  /** 이 결정이 이전 결정을 대체한다. ⛔ **대체하는 쪽에서 건다**(9절) */
  const supersede = useCallback(
    (decisionId: string, previousId: string) =>
      mutate(`/api/sources/decisions/${decisionId}/supersede`, {
        method: 'POST',
        body: JSON.stringify({ previousId }),
        headers: { 'content-type': 'application/json' },
      }),
    [mutate]
  )

  /** 뒤집는다. 대체와 다르다 — 다른 결론이 아니라 없던 일이다 */
  const reverse = useCallback(
    (decisionId: string) =>
      mutate(`/api/sources/decisions/${decisionId}/reverse`, {
        method: 'POST',
      }),
    [mutate]
  )

  return { decisions, error, busy, annotate, supersede, reverse, reload: load }
}
