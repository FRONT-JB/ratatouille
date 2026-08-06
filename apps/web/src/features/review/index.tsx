import { useState } from 'react'
import { Loader2, Lock, PanelRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import type { FetchLike } from '../processing/session'
import { useAudioController } from './audio-controller'
import { AudioPlayer } from './audio-player'
import { isRunning } from './document'
import { DocumentResult } from './document-result'
import { useDocument } from './use-document'
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
  facts,
  deps,
}: {
  sourceId: string
  /** 처리 수치 한 줄. 전사 원문 패널의 부제로 들어간다 */
  facts?: string
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
  // ⛔ 「불러오는 중…」 한 줄로 두지 않는다. 뼈대를 보여주면 무엇이 올지 알 수
  //    있고, 멈춘 화면과 구분된다.
  if (!rev.data) return <ReviewSkeleton />

  const locked = isLocked(rev.data.revisionState)
  const changed = editedCount(rev.data.segments)

  /*
   * ⛔ **근거를 여는 것과 듣는 것과 전사를 펼치는 것은 서로 다른 조작이다.**
   *    예전에는 각주를 누르면 곧바로 소리가 나고 전사 서랍이 열리며 목록이
   *    한참을 스크롤해 내려갔다. 하나를 눌렀는데 세 가지가 한꺼번에 일어났다.
   */
  const openTranscriptAt = (ms: number) => {
    controller.seek(ms)
    setTranscriptOpen(true)
  }

  const panel = (
    <TranscriptPanel
      rev={rev}
      locked={locked}
      changed={changed}
      currentMs={controller.currentMs}
      onSeek={controller.playAt}
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
          <AiLocked />
        </div>
        <div className='flex max-h-[70vh] min-w-0 flex-col gap-3'>{panel}</div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-8' data-testid='review-layout'>
      <AudioPlayer
        sourceId={sourceId}
        controller={controller}
        audioRef={audioRef}
        bind={bind}
      />

      {rev.error && (
        <p className='text-state-danger text-sm' role='alert'>
          {rev.error}
        </p>
      )}

      {/*
        ⛔ **확정 뒤에만 마운트한다.** 안에서 결과를 조회하므로, 마운트하는
           것 자체가 확정 전 조회 금지(review-contract 6절)를 어긴다.
      */}
      <ApprovedView
        sourceId={sourceId}
        revision={rev.data}
        onSeek={controller.seek}
        onPlay={controller.playAt}
        onOpenTranscriptAt={openTranscriptAt}
        onOpenTranscript={() => setTranscriptOpen(true)}
        onReopen={() => void rev.reopen()}
        deps={deps}
      />

      <TranscriptDrawer
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
        facts={facts}
      >
        {transcriptOpen && panel}
      </TranscriptDrawer>
    </div>
  )
}

/**
 * 확정 뒤의 화면 — 조작 한 줄 + 결과.
 *
 * ⛔ **조작을 한 줄에 모은다.** 예전에는 「전사 원문」·「전사 수정」이 한 줄,
 *    「다시 정리」가 또 한 줄, 그 사이에 상태말이 두 번 반복됐다. 무엇을
 *    할 수 있는지 한눈에 안 들어왔다.
 *
 * 그래서 결과 조회를 이 컴포넌트가 소유한다 — 버튼과 상태가 한 곳에 있어야
 * 한 줄로 모을 수 있다.
 */
function ApprovedView({
  sourceId,
  revision,
  onSeek,
  onPlay,
  onOpenTranscriptAt,
  onOpenTranscript,
  onReopen,
  deps,
}: {
  sourceId: string
  revision: RevisionView
  onSeek: (ms: number) => void
  onPlay: (ms: number) => void
  onOpenTranscriptAt: (ms: number) => void
  onOpenTranscript: () => void
  onReopen: () => void
  deps?: { fetch?: FetchLike; pollMs?: number }
}) {
  const doc = useDocument(sourceId, { fetch: deps?.fetch, pollMs: deps?.pollMs })
  const state = doc.view?.documentRunState ?? null
  const running = isRunning(state)

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='secondary'
          size='sm'
          onClick={onOpenTranscript}
          data-testid='open-transcript'
        >
          <PanelRight className='size-4' aria-hidden />
          전사 원문
        </Button>
        {/* ⛔ 되돌릴 길은 서랍 안에 숨기지 않는다. 늘 보이는 자리에 둔다 */}
        <Button variant='ghost' size='sm' onClick={onReopen}>
          전사 수정
        </Button>

        <div className='ml-auto flex items-center gap-3'>
          {/*
            진행 표시는 **버튼 옆**에 둔다. 페이지 배지도 같은 말을 하지만,
            도는 동안에는 방금 누른 자리에서 반응이 보여야 한다.
          */}
          {running && (
            <span className='text-muted-foreground flex items-center gap-1.5 text-sm'>
              <Loader2 className='size-3.5 animate-spin' aria-hidden />
              정리 중
            </span>
          )}
          {!running && doc.view?.elapsedMs != null && (
            <span className='text-muted-foreground text-sm tabular-nums'>
              {(doc.view.elapsedMs / 1000).toFixed(1)}초
            </span>
          )}
          {/* ⛔ 도는 동안에는 시작 버튼이 아예 없다. 두 번 돌리지 않는다 */}
          {!running && (
            <Button
              size='sm'
              variant={doc.view?.proposal ? 'ghost' : 'default'}
              onClick={() => void doc.generate()}
              data-testid='generate'
            >
              <Sparkles className='size-4' aria-hidden />
              {doc.view?.proposal || state ? '다시 정리' : 'AI 정리 시작'}
            </Button>
          )}
        </div>
      </div>

      <DocumentResult
        view={doc.view}
        error={doc.error}
        revisionId={revision.revisionId}
        segments={revision.segments}
        onSeek={onSeek}
        onPlay={onPlay}
        onOpenTranscript={onOpenTranscriptAt}
        onRetry={() => void doc.generate()}
      />
    </div>
  )
}

/**
 * 전사 원문 서랍.
 *
 * ⛔ 직접 만든 고정 패널에서 shadcn `Sheet`로 바꿨다. 포커스 가두기·Esc·
 *    바깥 클릭·애니메이션을 손으로 다시 만들 이유가 없고, 손으로 만들면
 *    빠뜨린다.
 */
function TranscriptDrawer({
  open,
  onOpenChange,
  facts,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 처리 수치. ⛔ 토글로 감싸지 않는다 — 한 줄짜리 사실 셋이다 */
  facts?: string
  children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='flex w-full flex-col gap-3 p-4 sm:max-w-md'
        data-testid='transcript-drawer'
      >
        <SheetHeader className='gap-1 p-0'>
          <SheetTitle className='text-sm font-medium'>전사 원문</SheetTitle>
          {facts && (
            <SheetDescription className='font-mono text-xs tabular-nums'>
              {facts}
            </SheetDescription>
          )}
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
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
      {/*
        ⛔ 확정 뒤에는 제목을 여기서 그리지 않는다. 서랍(`SheetTitle`)이 이미
           「전사 원문」이라고 말한다 — 같은 제목이 두 줄로 겹쳐 보였다.
      */}
      {!locked && (
        <header className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 className='text-sm font-medium'>전사 교정</h2>
          <SaveIndicator state={rev.save} locked={locked} changed={changed} />
        </header>
      )}

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
 * 확정 전 안내.
 *
 * ⛔ 자리를 비워두면 "곧 나오나 보다"로 읽히고, 가짜 내용을 채우면 확정 전
 *    결과를 보여주는 계약 위반이 된다. 무엇이 막고 있고 무엇을 하면 열리는지
 *    말한다.
 */
function AiLocked() {
  return (
    <section
      className='border-border text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-6 text-sm'
      data-testid='ai-locked'
    >
      <span className='text-foreground flex items-center gap-2 font-medium'>
        <Lock className='size-4' aria-hidden />
        전사 확정 후 생성
      </span>
      <p className='max-w-[60ch]'>
        회의 요약과 Action Item은 전사를 확정한 뒤에 만듭니다. 확정되지 않은
        전사에서 뽑은 결과는 근거가 없습니다.
      </p>
    </section>
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

/** ⛔ 로딩은 스켈레톤으로 보여준다. 빈 화면은 멈춘 화면과 구분되지 않는다. */
function ReviewSkeleton() {
  return (
    <div className='flex flex-col gap-8' data-testid='review-skeleton'>
      <Skeleton className='h-24 w-full rounded-lg' />
      <div className='flex gap-2'>
        <Skeleton className='h-8 w-24' />
        <Skeleton className='h-8 w-20' />
      </div>
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-4 w-20' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-10/12' />
      </div>
    </div>
  )
}
