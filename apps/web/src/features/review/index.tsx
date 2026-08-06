import { useEffect, useState } from 'react'
import { Lock, PanelRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FetchLike } from '../processing/session'
import { useAudioController } from './audio-controller'
import { AudioPlayer } from './audio-player'
import { DocumentResult } from './document-result'
import { type RevisionView, type SaveState, editedCount, isLocked } from './revision'
import { TranscriptEditor } from './transcript-editor'
import { useRevision } from './use-revision'

/**
 * 페이지 B — 결과와 전사 교정 (PLAN.md 순서 4).
 *
 * 화면 계약:
 *   `Sidebar + 회의 상세`, 상세 내부는 **넓은 왼쪽 결과 영역 + 좁은 오른쪽 전사 교정 영역**.
 *   ⛔ Sidebar 옆에 두 번째 회의 목록 열을 만들지 않는다.
 *
 * ⛔ **전사를 확정하기 전에는 AI 결과를 생성하지도 표시하지도 않는다.**
 *    왼쪽은 잠금 상태로 남는다. 이건 취향이 아니라 review-contract 6절이다 —
 *    확정되지 않은 전사에서 나온 결정·Action Item은 근거가 없다.
 */
export function ReviewPage({
  sourceId,
  deps,
}: {
  sourceId: string
  deps?: { fetch?: FetchLike; saveDelayMs?: number; pollMs?: number }
}) {
  const rev = useRevision(sourceId, deps)
  const { controller, audioRef, bind } = useAudioController()
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  if (rev.error && !rev.data) {
    return (
      <p className='text-state-danger text-sm' role='alert'>
        {rev.error}
      </p>
    )
  }
  if (!rev.data) {
    return <p className='text-muted-foreground text-sm'>교정본을 불러오는 중…</p>
  }

  const locked = isLocked(rev.data.revisionState)
  const changed = editedCount(rev.data.segments)

  /*
   * ⛔ **근거를 누르면 전사가 열린다.** 각주는 인용문 한 줄만 보여준다.
   *    "정말 그렇게 말했나"를 판단하려면 앞뒤 맥락이 필요하고, 그건 전사문에만
   *    있다. 재생만 하고 화면을 안 열면 사용자가 직접 찾아야 한다.
   */
  const seekFromEvidence = (ms: number) => {
    controller.seek(ms)
    if (locked) setTranscriptOpen(true)
  }

  const panel = (
    <TranscriptPanel
      rev={rev}
      locked={locked}
      changed={changed}
      currentMs={controller.currentMs}
      onSeek={controller.seek}
    />
  )

  /*
   * ⛔ **화면 구조가 지금 할 일을 따라간다.**
   *    확정 전에는 교정이 주 작업이라 좌우로 나눈다.
   *    확정 뒤에는 검수가 주 작업이므로 결과가 전체 폭을 쓰고, 전사는 근거를
   *    확인할 때만 옆에서 나온다. 확정 뒤에도 절반을 전사에 내주면, 정작
   *    읽어야 할 결과가 좁은 칸에 갇힌다.
   */
  if (!locked) {
    return (
      <div
        className='grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
        data-testid='review-layout'
      >
        <div className='flex min-w-0 flex-col gap-4'>
          <AudioPlayer
            sourceId={sourceId}
            controller={controller}
            audioRef={audioRef}
            bind={bind}
          />
          <AiResultSlot
            locked={locked}
            sourceId={sourceId}
            revision={rev.data}
            onSeek={seekFromEvidence}
            deps={deps}
          />
        </div>
        <div className='flex max-h-[70vh] min-w-0 flex-col gap-3'>{panel}</div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4' data-testid='review-layout'>
      <AudioPlayer
        sourceId={sourceId}
        controller={controller}
        audioRef={audioRef}
        bind={bind}
      />

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-state-success text-sm'>전사 확정됨</span>
        <Button
          variant='outline'
          size='sm'
          className='ml-auto'
          onClick={() => setTranscriptOpen(true)}
          data-testid='open-transcript'
        >
          <PanelRight className='size-4' aria-hidden />
          전사 원문
        </Button>
        {/* ⛔ 되돌릴 길은 서랍 안에 숨기지 않는다. 늘 보이는 자리에 둔다 */}
        <Button variant='outline' size='sm' onClick={() => void rev.reopen()}>
          전사 수정
        </Button>
      </div>

      {rev.error && (
        <p className='text-state-danger text-sm' role='alert'>
          {rev.error}
        </p>
      )}

      <AiResultSlot
        locked={locked}
        sourceId={sourceId}
        revision={rev.data}
        onSeek={seekFromEvidence}
        deps={deps}
      />

      {transcriptOpen && (
        <TranscriptDrawer onClose={() => setTranscriptOpen(false)}>
          {panel}
        </TranscriptDrawer>
      )}
    </div>
  )
}

/**
 * 전사 원문 서랍.
 *
 * ⛔ **닫는 길이 둘 이상이어야 한다.** 바깥을 누르든 Esc를 누르든 닫힌다.
 *    화면을 덮는 것에서 빠져나오지 못하면 그건 갇힌 것이다.
 */
function TranscriptDrawer({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div
        className='fixed inset-0 z-40 bg-black/20'
        onClick={onClose}
        aria-hidden
      />
      <aside
        className='bg-background border-border fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-3 border-l p-4 shadow-lg'
        role='dialog'
        aria-label='전사 원문'
        data-testid='transcript-drawer'
      >
        <div className='flex justify-end'>
          <Button variant='ghost' size='icon' onClick={onClose} aria-label='닫기'>
            <X className='size-4' aria-hidden />
          </Button>
        </div>
        {children}
      </aside>
    </>
  )
}

/**
 * 전사 교정 영역.
 *
 * ⛔ 확정 전에는 오른쪽 칸에, 확정 뒤에는 서랍 안에 **같은 것**이 들어간다.
 *    두 벌로 만들면 한쪽만 고쳐지고, 사용자는 같은 일에 다른 화면을 본다.
 */
function TranscriptPanel({
  rev,
  locked,
  changed,
  currentMs,
  onSeek,
}: {
  rev: ReturnType<typeof useRevision>
  locked: boolean
  changed: number
  currentMs: number | null
  onSeek: (ms: number) => void
}) {
  if (!rev.data) return null

  return (
    <>
      <header className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='text-sm font-medium'>{locked ? '전사 원문' : '전사 교정'}</h2>
        <SaveIndicator state={rev.save} locked={locked} changed={changed} />
      </header>

      {!locked && rev.error && (
        <p className='text-state-danger text-sm' role='alert'>
          {rev.error}
        </p>
      )}

      {/* ⛔ 높이를 여기서 못박지 않는다. 좁은 칸에서는 60vh로, 서랍에서는
          꽉 차게 — 쓰이는 자리가 정한다. 여기서 정하면 서랍 아래가 빈다 */}
      <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
        <TranscriptEditor
          segments={rev.data.segments}
          currentMs={currentMs}
          locked={locked}
          onSeek={onSeek}
          onEdit={rev.editSegment}
        />
      </div>

      {!locked && (
        <footer className='border-border flex items-center gap-2 border-t pt-3'>
          <span className='text-muted-foreground text-xs'>
            {changed > 0 ? `${changed}개 문장을 고쳤습니다` : '고친 문장이 없습니다'}
          </span>
          <Button
            size='sm'
            className='ml-auto'
            onClick={() => void rev.approve()}
            data-testid='approve-transcript'
          >
            전사 확정
          </Button>
        </footer>
      )}
    </>
  )
}

/**
 * AI 결과 자리.
 *
 * ⛔ **확정 전에는 잠금 상태다.** 자리를 비워두면 "곧 나오나 보다"로 읽히고,
 *    가짜 내용을 채우면 확정 전 결과를 보여주는 계약 위반이 된다.
 *    무엇이 막고 있고 무엇을 하면 열리는지 말한다.
 *
 * ⛔ **확정 전에는 `DocumentResult`를 마운트하지 않는다.** 마운트하면 그 자리에서
 *    결과를 조회하고, 조회 자체가 계약 위반이다. 안쪽에 조건을 또 두지 않고
 *    **여기서 마운트하지 않는 것으로** 막는다 — 판단이 두 곳에 있으면 어긋난다.
 */
function AiResultSlot({
  locked,
  sourceId,
  revision,
  onSeek,
  deps,
}: {
  locked: boolean
  sourceId: string
  revision: RevisionView
  onSeek: (ms: number) => void
  deps?: { fetch?: FetchLike; pollMs?: number }
}) {
  if (!locked) {
    return (
      <section
        className='border-border text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-6 text-sm'
        data-testid='ai-locked'
      >
        <span className='flex items-center gap-2 font-medium'>
          <Lock className='size-4' aria-hidden />
          전사 확정 후 생성
        </span>
        <p>
          회의 요약과 Action Item은 전사를 확정한 뒤에 만듭니다. 확정되지 않은
          전사에서 뽑은 결과는 근거가 없습니다.
        </p>
      </section>
    )
  }

  return (
    <DocumentResult
      sourceId={sourceId}
      revisionId={revision.revisionId}
      segments={revision.segments}
      onSeek={onSeek}
      deps={{ fetch: deps?.fetch, pollMs: deps?.pollMs }}
    />
  )
}

/** 저장 상태. ⛔ 실패를 숨기지 않는다 — 교정 내용을 잃는 것이 최악이다. */
function SaveIndicator({
  state,
  locked,
  changed,
}: {
  state: SaveState
  locked: boolean
  changed: number
}) {
  if (locked) return null
  if (state.kind === 'failed') {
    return (
      <span className='text-state-danger text-xs' role='alert'>
        저장하지 못했습니다 — {state.message}
      </span>
    )
  }
  if (state.kind === 'saving') {
    return <span className='text-muted-foreground text-xs'>저장 중…</span>
  }
  if (state.kind === 'saved') {
    return <span className='text-state-success text-xs'>저장됨</span>
  }
  return (
    <span className='text-muted-foreground text-xs'>
      {changed > 0 ? '' : '문장을 눌러 고칠 수 있습니다'}
    </span>
  )
}
