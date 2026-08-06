import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PHRASE_PLACEHOLDER } from '@ratatouille/contracts'
import {
  type NextAction,
  type SessionSource,
  isProcessing,
  primaryStatus,
} from './session'

/**
 * 처리 중 상태 표시 — PLAN.md 순서 3.
 *
 * ⛔ **녹음 source와 업로드 source가 같은 컴포넌트를 재사용한다.** 두 경로가
 *    각자 상태 표시를 만들면 문구와 판정이 갈라지고, 사용자는 같은 일에
 *    다른 화면을 보게 된다.
 *
 * ⛔ 문구·다음 조작을 **여기서 만들지 않는다.** 서버가 준 것을 그대로 쓴다.
 *    클라이언트가 따로 판정하면 서버와 갈라진다.
 */
export function ProcessingStatus({
  source,
  onAction,
  className,
}: {
  source: SessionSource
  onAction?: (action: NextAction) => void
  className?: string
}) {
  const status = primaryStatus(source)
  const busy = isProcessing(source)
  const failed = source.job?.jobState === 'failed_retryable'
  const action = source.nextAction

  return (
    <section
      className={cn('flex flex-col gap-4', className)}
      data-testid='processing-status'
      // ⛔ 어느 객체의 상태인지 DOM에도 남긴다. 화면을 보는 사람도,
      //    테스트도 source와 job을 구분할 수 있어야 한다.
      data-machine={status.machine}
      data-state={status.state}
      aria-live='polite'
    >
      <div className='flex items-start gap-3'>
        <StatusIcon busy={busy} failed={failed} />
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <h2 className='text-lg font-medium'>{status.phrase.label}</h2>
            {status.phrase.provisional && (
              /* 확정되지 않은 문구임을 화면에 드러낸다 */
              <span
                className='text-muted-foreground border-border rounded border px-1.5 py-0.5 text-[10px]'
                data-testid='provisional-phrase'
              >
                {/* 문구를 여기서 따로 적지 않는다 — 계약이 정한 표시를 쓴다 */}
                {PHRASE_PLACEHOLDER}
              </span>
            )}
          </div>
          {status.phrase.detail && (
            <p className='text-muted-foreground text-sm'>{status.phrase.detail}</p>
          )}
          {source.job?.error && (
            <p className='text-state-danger text-sm' role='alert'>
              {source.job.error}
            </p>
          )}
          {source.job?.warning && (
            <p className='text-state-warning text-sm'>{source.job.warning}</p>
          )}
        </div>
      </div>

      <ProgressDetail source={source} />

      {action && (
        <Button
          className='w-fit'
          variant={action.kind.startsWith('retry') ? 'outline' : 'default'}
          onClick={() => onAction?.(action)}
          data-testid={`next-action-${action.kind}`}
        >
          {action.kind.startsWith('retry') && <RotateCcw />}
          {action.label}
        </Button>
      )}
    </section>
  )
}

function StatusIcon({ busy, failed }: { busy: boolean; failed: boolean }) {
  if (failed) {
    return <AlertTriangle className='text-state-danger mt-1 size-5 shrink-0' aria-hidden />
  }
  if (busy) {
    return (
      <Loader2 className='text-muted-foreground mt-1 size-5 shrink-0 animate-spin' aria-hidden />
    )
  }
  return <CheckCircle2 className='text-state-success mt-1 size-5 shrink-0' aria-hidden />
}

/**
 * 세부 진행 정보.
 *
 * ⛔ 업로드가 덜 끝난 것과 서버 검증까지 끝난 `ready`를 구분해 보여준다
 *    (완료 조건 2). "조각 3개 받음"과 "원본 준비됨"은 다른 사실이다.
 */
function ProgressDetail({ source }: { source: SessionSource }) {
  const missing = Object.entries(source.missing).flatMap(([track, seqs]) =>
    (seqs ?? []).length > 0 ? [{ track, count: (seqs ?? []).length }] : []
  )

  return (
    <dl className='text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
      <dt>받은 조각</dt>
      <dd className='tabular-nums' data-testid='chunk-count'>
        {source.chunkCount}개
      </dd>

      {missing.length > 0 && (
        <>
          <dt className='text-state-warning'>아직 안 올라온 조각</dt>
          <dd className='tabular-nums' data-testid='missing-chunks'>
            {missing.map((m) => `${m.track} ${m.count}개`).join(' · ')}
          </dd>
        </>
      )}

      {source.job?.segmentCount != null && (
        <>
          <dt>전사 세그먼트</dt>
          <dd className='tabular-nums'>{source.job.segmentCount}개</dd>
        </>
      )}

      {source.job?.elapsedMs != null && (
        <>
          <dt>전사 소요</dt>
          <dd className='tabular-nums'>
            {(source.job.elapsedMs / 1000).toFixed(1)}초
          </dd>
        </>
      )}
    </dl>
  )
}
