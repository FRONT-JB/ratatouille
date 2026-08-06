import { useCallback, useEffect, useRef, useState } from 'react'
import type { FetchLike } from '../processing/session'
import type { RevisionView, SaveState } from './revision'

/**
 * 전사 교정본을 읽고 쓴다.
 *
 * ⛔ **교정 내용을 잃지 않는 것이 최우선이다.** 사용자가 30분 회의를 손보고
 *    있는데 저장이 조용히 실패하면, 그 사실을 나중에 알아도 되돌릴 수 없다.
 *    저장 상태를 항상 화면에 내보내고, 실패는 숨기지 않는다.
 *
 * ⛔ 타이핑마다 요청을 보내지 않는다. 대신 **입력이 멈추면** 보낸다.
 *    30분 전사는 세그먼트가 수백 개다.
 */

const SAVE_DELAY_MS = 600

export type RevisionDeps = {
  fetch?: FetchLike
  /** 저장을 미루는 시간. 테스트에서 줄인다 */
  saveDelayMs?: number
}

export function useRevision(sourceId: string, deps: RevisionDeps = {}) {
  const [data, setData] = useState<RevisionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const fetchFn = deps.fetch
  const delay = deps.saveDelayMs ?? SAVE_DELAY_MS

  /** 아직 서버로 못 보낸 편집. id → 텍스트 */
  const pending = useRef(new Map<string, string>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const request = useCallback(
    async (path: string, init?: RequestInit): Promise<RevisionView> => {
      const res = await (fetchFn ?? fetch)(`/api/sources/${sourceId}${path}`, init)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `요청이 실패했습니다 (${res.status})`)
      }
      return (await res.json()) as RevisionView
    },
    [sourceId, fetchFn]
  )

  const load = useCallback(async () => {
    try {
      setData(await request('/revision'))
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

  /** 밀린 편집을 보낸다. 성공하면 서버가 준 것으로 화면을 맞춘다. */
  const flush = useCallback(async () => {
    if (pending.current.size === 0) return
    const batch = [...pending.current].map(([id, text]) => ({ id, text }))
    // ⛔ 요청 전에 비운다. 보내는 동안 들어온 편집은 **다음 묶음**이 되어야
    //    한다. 응답 후에 비우면 그 사이 편집이 통째로 사라진다.
    pending.current.clear()
    setSave({ kind: 'saving' })
    try {
      setData(
        await request('/revision', {
          method: 'PATCH',
          body: JSON.stringify({ segments: batch }),
          headers: { 'content-type': 'application/json' },
        })
      )
      setSave({ kind: 'saved' })
    } catch (e) {
      // ⛔ 실패한 편집을 되돌려 놓는다. 버리면 사용자가 고친 문장이 사라진다.
      //    단 그 사이 들어온 더 최신 편집은 덮지 않는다.
      for (const { id, text } of batch) {
        if (!pending.current.has(id)) pending.current.set(id, text)
      }
      setSave({
        kind: 'failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [request])

  const editSegment = useCallback(
    (id: string, text: string) => {
      pending.current.set(id, text)
      // 화면은 즉시 반영한다. 서버 왕복을 기다리면 타이핑이 끊긴다.
      setData((prev) =>
        prev
          ? {
              ...prev,
              segments: prev.segments.map((s) =>
                s.id === id ? { ...s, text, edited: text !== s.original } : s
              ),
            }
          : prev
      )
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [flush, delay]
  )

  // ⛔ 화면을 떠날 때 밀린 편집을 보낸다. 안 그러면 마지막 몇 글자가 사라진다.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void flush()
    }
  }, [flush])

  const act = useCallback(
    async (path: string) => {
      // 확정 전에 밀린 편집을 먼저 보낸다. 순서가 바뀌면 **확정 직전에 고친
      // 문장이 확정본에 안 들어간다.**
      if (timer.current) clearTimeout(timer.current)
      await flush()
      try {
        setData(await request(path, { method: 'POST' }))
        setError(null)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [flush, request]
  )

  return {
    data,
    error,
    save,
    editSegment,
    approve: useCallback(() => act('/revision/approve'), [act]),
    reopen: useCallback(() => act('/revision/reopen'), [act]),
    reload: load,
    /** 테스트와 「지금 저장」 버튼에서 쓴다 */
    flush,
  }
}
