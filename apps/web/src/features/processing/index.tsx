import { useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { describeState } from '@ratatouille/contracts'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/layout/page-header-slot'
import { ReviewPage } from '../review'
import { DeleteMeeting } from './delete-meeting'
import { ProcessingStatus } from './processing-status'
import { labelFor } from './use-meetings'
import {
  type FetchLike,
  type NextAction,
  type Session,
  type SessionSource,
  fetchSession,
  findSource,
  isProcessing,
  stageOf,
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

  /*
   * ⛔ **전사가 끝나면 처리 화면이 검수 화면으로 바뀐다.** 둘을 같이 쌓지
   *    않는다 — 「받은 조각 612개」는 검수할 때 아무 도움이 안 되는데도
   *    화면 맨 위에서 가장 큰 자리를 차지하고 있었다.
   */
  const reviewing = source.job?.jobState === 'completed'

  return (
    <Shell title={labelFor(source)} source={source}>
      {reviewing ? (
        /*
          ⛔ 처리 수치는 여기 두지 않는다. 「받은 조각 612개」는 결과를 읽는
             동안에는 방해고, 전사가 이상할 때만 본다 — 그래서 **전사 원문
             패널 안**으로 옮겼다. 볼 이유가 생기는 자리에 있어야 한다.
        */
        <ReviewPage
          sourceId={source.sourceId}
          deps={{ fetch: fetchFn }}
          facts={factsOf(source)}
        />
      ) : (
        <ProcessingStatus source={source} onAction={(a) => void onAction(a)} />
      )}

      {/*
        ⛔ 삭제는 **맨 아래에, 조용하게** 둔다. 되돌릴 수 없는 조작을 주요
           동작 옆에 두면 오클릭이 난다. 그래도 숨기지는 않는다 — 실제로
           「수집 중」에서 멈춘 회의를 화면에서 치울 방법이 없었다.
      */}
      <div className='flex justify-end'>
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

/**
 * 화면 껍데기.
 *
 * ⛔ **제목은 어느 회의인지 말해야 한다.** 「회의」는 아무것도 말하지 않는다.
 *    사이드바는 `08/06 11:02`라고 부르는데 본문 제목만 「회의」였다.
 *
 * ⛔ **상태말은 여기 한 번만 나온다.** 예전에는 처리 상태·전사 확정 여부·
 *    AI 정리 상태가 각자 자기 자리에서 같은 말을 반복했다.
 */
function Shell({
  title,
  source,
  children,
}: {
  title?: string
  source?: SessionSource
  children: React.ReactNode
}) {
  const phrase = source ? describeState(stageOf(source)) : null

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-3 pb-10 sm:px-10 sm:pb-16'>
      {/*
        ⚠️ 위쪽 여백은 `pt-3`만 준다. 제목이 상단 바로 올라가면서 본문 첫 줄
           위의 큰 여백이 상단 바 높이와 겹쳐 빈 띠처럼 보였다.

        ⛔ 제목을 본문에 큰 글씨로 두지 않는다. 상단 바가 이미 비어 있고,
           회의 이름은 «지금 어디에 있나»를 알려주는 이정표라 거기가 제자리다.
           본문 맨 위를 제목이 차지하면 정작 읽을 내용이 아래로 밀린다.
      */}
      <PageHeader>
        <nav
          className='flex min-w-0 items-center gap-2 text-sm'
          aria-label='현재 위치'
        >
          <span className='text-muted-foreground shrink-0'>회의</span>
          <ChevronRight className='text-muted-foreground size-3.5 shrink-0' aria-hidden />
          <h1 className='truncate font-medium'>{title ?? '회의'}</h1>
          {phrase && (
            <Badge
              variant='secondary'
              className={
                // ⛔ 확정되지 않은 문구는 확정된 것처럼 두지 않는다
                phrase.provisional ? 'underline decoration-dotted underline-offset-4' : ''
              }
              data-testid='stage-phrase'
              title={phrase.detail ?? undefined}
            >
              {phrase.label}
            </Badge>
          )}
        </nav>
      </PageHeader>
      {children}
    </div>
  )
}


/**
 * 처리 수치 — 조각 수, 세그먼트 수, 전사 소요.
 *
 * ⛔ **접었다 펴는 토글로 두지 않는다.** 한 줄짜리 사실 세 개다. 토글은
 *    누를 값어치가 있는 분량에만 쓴다.
 */
function factsOf(s: SessionSource): string {
  const parts = [`조각 ${s.chunkCount}개`]
  if (s.job?.segmentCount != null) parts.push(`세그먼트 ${s.job.segmentCount}개`)
  if (s.job?.elapsedMs != null) {
    parts.push(`전사 ${(s.job.elapsedMs / 1000).toFixed(1)}초`)
  }
  return parts.join(' · ')
}
