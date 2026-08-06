import { useCallback, useEffect, useState } from 'react'
import { ProcessingStatus } from './processing-status'
import {
  type FetchLike,
  type NextAction,
  type Session,
  type SessionSource,
  fetchSession,
  findSource,
  isProcessing,
} from './session'

/**
 * 페이지 B 로딩 상태 — PLAN.md 순서 3.
 *
 * ⛔ **녹음 source와 업로드 source가 같은 화면을 쓴다.** 어느 경로로 왔든
 *    처리 중 표시는 하나여야 한다.
 *
 * ⛔ **하나의 route 안에서 상태가 전환된다.** 전사가 끝나면 페이지를 옮기는
 *    것이 아니라 이 화면이 교정 UI로 바뀐다 (Phase 5에서 채운다).
 */
export function ProcessingPage({
  meetingId,
  deps,
}: {
  meetingId: string
  deps?: { fetch?: FetchLike; pollMs?: number }
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchFn = deps?.fetch
  const pollMs = deps?.pollMs ?? 1500

  const load = useCallback(async () => {
    try {
      setSession(await fetchSession(fetchFn))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [fetchFn])

  // 첫 조회는 즉시, 그 뒤는 폴링이 맡는다.
  // effect 본문에서 바로 setState를 부르면 렌더가 연쇄로 돈다 —
  // 마이크로태스크로 한 틱 미룬다.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const source = session ? findSource(session, meetingId) : null
  const busy = source ? isProcessing(source) : false

  // 처리 중일 때만 폴링한다. 끝났으면 조용히 있는다.
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => void load(), pollMs)
    return () => clearInterval(id)
  }, [busy, pollMs, load])

  const onAction = useCallback(
    async (action: NextAction) => {
      if (!source) return
      if (action.kind === 'start_transcription' || action.kind === 'retry_transcription') {
        await (fetchFn ?? fetch)(`/api/sources/${source.sourceId}/transcribe`, {
          method: 'POST',
        })
        await load()
      }
    },
    [source, fetchFn, load]
  )

  if (error) {
    return (
      <Shell>
        <p className='text-state-danger text-sm' role='alert'>
          {error}
        </p>
      </Shell>
    )
  }

  if (!session) {
    return (
      <Shell>
        <p className='text-muted-foreground text-sm'>불러오는 중…</p>
      </Shell>
    )
  }

  if (!source) {
    return (
      <Shell>
        <p className='text-muted-foreground text-sm' data-testid='source-missing'>
          {meetingId} 회의를 찾을 수 없습니다.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <ProcessingStatus source={source} onAction={(a) => void onAction(a)} />
      <TranscriptReviewSlot source={source} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 sm:p-10'>
      <header className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>회의</h1>
      </header>
      {children}
    </div>
  )
}

/**
 * 전사 교정이 들어올 자리.
 *
 * ⚠️ Phase 5에서 채운다. 지금은 **비어 있다는 사실을 명시**한다 —
 *    빈 화면을 두면 구현된 것으로 오해한다.
 */
function TranscriptReviewSlot({ source }: { source: SessionSource }) {
  if (source.job?.jobState !== 'completed') return null

  return (
    <section
      className='border-border bg-muted/40 rounded-lg border p-4'
      data-testid='transcript-review-slot'
    >
      <h2 className='mb-1 text-sm font-medium'>전사 교정</h2>
      <p className='text-muted-foreground text-sm'>
        세그먼트 {source.job.segmentCount}개가 준비되었습니다. 교정 화면은 Phase 5에서
        구현합니다.
      </p>
    </section>
  )
}
