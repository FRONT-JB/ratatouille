import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FetchLike } from '../processing/session'
import { AudioPlayer, useAudioController } from './audio-player'
import { type SaveState, editedCount, isLocked } from './revision'
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
  deps?: { fetch?: FetchLike; saveDelayMs?: number }
}) {
  const rev = useRevision(sourceId, deps)
  const { controller, audioRef, bind } = useAudioController()

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

  return (
    <div
      className='grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
      data-testid='review-layout'
    >
      {/* 왼쪽 — 넓은 결과 영역 */}
      <div className='flex min-w-0 flex-col gap-4'>
        <AudioPlayer
          sourceId={sourceId}
          controller={controller}
          audioRef={audioRef}
          bind={bind}
        />
        <AiResultSlot locked={locked} />
      </div>

      {/* 오른쪽 — 좁은 전사 교정 영역 */}
      <div className='flex min-w-0 flex-col gap-3'>
        <header className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 className='text-sm font-medium'>전사 교정</h2>
          <SaveIndicator state={rev.save} locked={locked} changed={changed} />
        </header>

        {rev.error && (
          <p className='text-state-danger text-sm' role='alert'>
            {rev.error}
          </p>
        )}

        <div className='max-h-[60vh] overflow-y-auto pr-1'>
          <TranscriptEditor
            segments={rev.data.segments}
            currentMs={controller.currentMs}
            locked={locked}
            onSeek={controller.seek}
            onEdit={rev.editSegment}
          />
        </div>

        <footer className='border-border flex items-center gap-2 border-t pt-3'>
          {locked ? (
            <>
              <span className='text-state-success text-sm'>전사 확정됨</span>
              <Button
                variant='outline'
                size='sm'
                className='ml-auto'
                onClick={() => void rev.reopen()}
              >
                전사 수정
              </Button>
            </>
          ) : (
            <>
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
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

/**
 * AI 결과 자리.
 *
 * ⛔ **확정 전에는 잠금 상태다.** 자리를 비워두면 "곧 나오나 보다"로 읽히고,
 *    가짜 내용을 채우면 확정 전 결과를 보여주는 계약 위반이 된다.
 *    무엇이 막고 있고 무엇을 하면 열리는지 말한다.
 */
function AiResultSlot({ locked }: { locked: boolean }) {
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
    <section
      className='border-border text-muted-foreground rounded-lg border border-dashed p-6 text-sm'
      data-testid='ai-pending'
    >
      전사가 확정되었습니다. 회의 요약·Action Item 생성은 아직 만들지
      않았습니다(Phase 6).
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
