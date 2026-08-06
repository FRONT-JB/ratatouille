import { useCallback, useEffect, useState } from 'react'
import { DeleteMeeting } from './delete-meeting'
import { ProcessingStatus } from './processing-status'
import { TranscriptPreview } from './transcript-preview'
import { labelFor } from './use-meetings'
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
  onDeleted,
}: {
  meetingId: string
  deps?: { fetch?: FetchLike; pollMs?: number }
  /**
   * 회의가 삭제됐을 때. route가 목록으로 되돌린다.
   *
   * ⚠️ 이 컴포넌트가 직접 `useNavigate`를 부르지 않는 이유: router 없이도
   *    렌더할 수 있어야 테스트가 화면 계약을 검증할 수 있다.
   */
  onDeleted?: (sourceId: string) => void
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
      <TranscriptReviewSlot source={source} fetchFn={fetchFn} />
      {/*
        ⛔ 삭제는 **맨 아래에, 조용하게** 둔다. 되돌릴 수 없는 조작을 주요
           동작 옆에 두면 오클릭이 난다. 그래도 숨기지는 않는다 — 실제로
           「수집 중」에서 멈춘 회의를 화면에서 치울 방법이 없었다.
      */}
      <div className='border-border mt-4 flex justify-end border-t pt-4'>
        <DeleteMeeting
          sourceId={source.sourceId}
          label={labelFor(source)}
          fetchFn={fetchFn}
          onDeleted={onDeleted}
        />
      </div>
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
 * 전사가 끝나면 원문을 보여준다.
 *
 * ⚠️ 읽기 전용이다. 교정 UI(Phase 5)는 아직 없다. 원문을 아예 안 보여주면
 *    사용자가 "제대로 녹음됐나"를 화면에서 확인할 방법이 없다 — 실제로
 *    파형이 안 움직였을 때 녹음 성공 여부를 판단할 수 없었다.
 */
function TranscriptReviewSlot({
  source,
  fetchFn,
}: {
  source: SessionSource
  fetchFn?: FetchLike
}) {
  if (source.job?.jobState !== 'completed') return null
  return <TranscriptPreview jobId={source.job.id} fetchFn={fetchFn} />
}
