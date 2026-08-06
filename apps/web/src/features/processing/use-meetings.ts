import { useCallback, useEffect, useState } from 'react'
import { type FetchLike, type SessionSource, fetchSession, isProcessing } from './session'

/**
 * 사이드바에 띄울 회의 목록.
 *
 * ⛔ **아직 교정하지 않은 회의도 보여준다.** 진입 시점에 무엇이 있고 무엇이
 *    덜 끝났는지 화면에서 알 수 없으면, 사용자는 URL을 외우고 있어야 한다.
 *    실제로 전사가 끝난 회의 2건이 있는데 사이드바는 "아직 회의가 없습니다"였다.
 *
 * 진행 중인 것이 있을 때만 폴링한다. 다 끝났으면 조용히 있는다.
 */

export type MeetingListItem = {
  sourceId: string
  /** 사이드바에 보일 이름. id는 사람이 읽을 수 없다 */
  label: string
  /** 지금 무엇을 기다리는지 한 단어 */
  badge: string
}

/** 사이드바에 걸 짧은 상태말. 긴 문구는 페이지 B가 보여준다. */
export function badgeFor(s: SessionSource): string {
  if (s.sourceState !== 'ready') return '수집 중'
  if (!s.job) return '전사 전'
  switch (s.job.jobState) {
    case 'queued':
      return '대기'
    case 'transcribing':
      return '전사 중'
    case 'failed_retryable':
      return '실패'
    case 'completed':
      // ⚠️ 교정·정리는 아직 없다. 전사까지가 끝이라는 뜻으로 읽히면 안 되므로
      //    "교정 전"으로 둔다 — 다음에 할 일이 남았다는 표시다.
      return '교정 전'
  }
}

/** 시각을 사람이 읽는 이름으로. id(`src_msgszcix`)는 못 읽는다. */
export function labelFor(s: SessionSource): string {
  if (!s.startedAt) return s.sourceId
  const d = new Date(s.startedAt)
  if (Number.isNaN(d.getTime())) return s.sourceId
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function toMeetingItems(sources: SessionSource[]): MeetingListItem[] {
  return (
    sources
      .map((s) => ({
        sourceId: s.sourceId,
        label: labelFor(s),
        badge: badgeFor(s),
      }))
      // 최근 것이 위로
      .reverse()
  )
}

export function useMeetings(deps: { fetch?: FetchLike; pollMs?: number } = {}) {
  const [items, setItems] = useState<MeetingListItem[]>([])
  const [busy, setBusy] = useState(false)
  const fetchFn = deps.fetch
  const pollMs = deps.pollMs ?? 5000

  const load = useCallback(async () => {
    try {
      const session = await fetchSession(fetchFn)
      setItems(toMeetingItems(session.sources))
      setBusy(session.sources.some(isProcessing))
    } catch {
      // 사이드바는 조용히 실패한다. 목록을 못 불러왔다고 앱 전체를 막지 않는다.
      // 실제 오류는 페이지 B가 보여준다.
    }
  }, [fetchFn])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => void load(), pollMs)
    return () => clearInterval(id)
  }, [busy, pollMs, load])

  return { items, reload: load }
}
