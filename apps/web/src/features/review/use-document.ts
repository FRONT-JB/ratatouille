import { useCallback, useEffect, useState } from 'react'
import type { FetchLike } from '../processing/session'
import { type DocumentView, isRunning } from './document'

/**
 * AI 정리 결과를 읽고 시작한다.
 *
 * ⛔ **이 hook은 전사가 확정된 뒤에만 마운트된다.** 확정 전에 결과를 조회하는
 *    것 자체가 계약 위반이다(review-contract 6절). 그래서 조회를 막는 조건이
 *    여기 없다 — 부모가 마운트하지 않는 것으로 막는다. 여기에 조건을 또 두면
 *    판단이 두 곳에 생기고 반드시 어긋난다.
 *
 * ⛔ **자동으로 생성하지 않는다.** 사람이 시작한다. 화면을 여는 것만으로 모델을
 *    호출하면, 결과를 볼 생각이 없던 사용자도 돈과 시간을 쓴다.
 */

const POLL_MS = 1500

export type DocumentDeps = {
  fetch?: FetchLike
  /** 진행 중일 때 다시 물어보는 간격. 테스트에서 줄인다 */
  pollMs?: number
}

const EMPTY: DocumentView = {
  runId: null,
  documentRunState: null,
  revisionId: null,
  error: null,
  violations: [],
  elapsedMs: null,
  proposal: null,
}

export function useDocument(sourceId: string, deps: DocumentDeps = {}) {
  const [view, setView] = useState<DocumentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchFn = deps.fetch
  const pollMs = deps.pollMs ?? POLL_MS

  const request = useCallback(
    async (init?: RequestInit): Promise<DocumentView> => {
      const res = await (fetchFn ?? fetch)(
        `/api/sources/${sourceId}/document`,
        init
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `요청이 실패했습니다 (${res.status})`)
      }
      const raw = (await res.json()) as Partial<DocumentView>
      // 서버는 아직 만들지 않은 경우 `{documentRunState: null, proposal: null}`만
      // 준다. 빠진 필드를 화면이 매번 방어하지 않도록 여기서 채운다.
      return { ...EMPTY, ...raw }
    },
    [sourceId, fetchFn]
  )

  const load = useCallback(async () => {
    try {
      setView(await request())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [request])

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
   * 진행 중일 때만 다시 물어본다.
   *
   * ⛔ 끝난 뒤에도 계속 물으면 화면을 열어둔 것만으로 요청이 쌓인다.
   *    30분 회의를 검수하는 동안 수천 번이 된다.
   */
  const running = isRunning(view?.documentRunState ?? null)
  useEffect(() => {
    if (!running) return
    // `load`는 sourceId·fetch가 그대로면 같은 함수다. 그래서 폴링 도중
    // interval이 다시 만들어지지 않는다.
    const timer = setInterval(() => void load(), pollMs)
    return () => clearInterval(timer)
  }, [running, pollMs, load])

  const generate = useCallback(async () => {
    try {
      setView(await request({ method: 'POST' }))
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [request])

  return { view, error, generate, reload: load }
}
