import { useEffect, type CSSProperties } from 'react'
import {
  AudioLines,
  CircleAlert,
  CircleCheck,
  CirclePause,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  type AudioController,
  type AudioPlaybackState,
  formatClock,
  type useAudioController,
} from './audio-controller'
import './audio-player.css'

/**
 * 회의 오디오 재생기.
 *
 * ⛔ **영상 player가 아니다.** 화면 계약: 왼쪽 상단에 오디오 재생기.
 *    영상 자리를 만들면 없는 것을 기다리게 된다.
 *
 * ⛔ **timestamp를 눌러 그 지점으로 가는 것이 이 화면의 목적이다.**
 *    그래서 seek는 밖에서 부를 수 있어야 하고, 현재 위치는 밖으로 나가야 한다.
 */

const STATE_META = {
  loading: {
    label: '오디오 불러오는 중',
    detail: '재생 정보를 확인하고 있습니다.',
    icon: LoaderCircle,
    tone: 'text-muted-foreground',
  },
  paused: {
    label: '재생 준비',
    detail: '타임스탬프를 선택하거나 재생을 시작하세요.',
    icon: CirclePause,
    tone: 'text-foreground',
  },
  playing: {
    label: '재생 중',
    detail: '전사 내용과 현재 재생 위치를 함께 확인할 수 있습니다.',
    icon: AudioLines,
    tone: 'text-state-info',
  },
  ended: {
    label: '재생 완료',
    detail: '처음부터 다시 듣거나 원하는 위치를 선택하세요.',
    icon: CircleCheck,
    tone: 'text-state-success',
  },
  error: {
    label: '오디오 오류',
    detail: '회의 오디오를 재생할 수 없습니다.',
    icon: CircleAlert,
    tone: 'text-state-danger',
  },
} satisfies Record<
  AudioPlaybackState,
  { label: string; detail: string; icon: typeof Play; tone: string }
>

export function AudioPlayer({
  sourceId,
  controller,
  audioRef,
  bind,
}: {
  sourceId: string
  controller: AudioController
  audioRef: React.RefObject<HTMLAudioElement | null>
  bind: ReturnType<typeof useAudioController>['bind']
}) {
  const { currentMs, duration, error, state, reset } = controller
  const meta = STATE_META[state]
  const StateIcon = meta.icon
  const progress =
    duration && duration > 0 ? Math.min(100, (currentMs / duration) * 100) : 0
  const rangeStyle = { '--audio-progress': `${progress}%` } as CSSProperties
  const loading = state === 'loading'
  const playing = state === 'playing'
  const ended = state === 'ended'

  const toggle = () => {
    if (playing) {
      controller.pause()
      return
    }
    if (ended) controller.seek(0)
    controller.play()
  }

  const reload = () => {
    reset()
    audioRef.current?.load()
  }

  // 회의가 바뀌면 이전 회의의 시간·완료·오류 표시를 남기지 않는다.
  useEffect(() => {
    reset()
    audioRef.current?.load()
  }, [sourceId, audioRef, reset])

  return (
    <section
      className='flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card'
      data-testid='audio-player'
      data-state={state}
      aria-label='회의 오디오'
    >
      {/* ⛔ <video>가 아니다. 회의 녹음은 소리다 */}
      <audio
        ref={audioRef}
        src={`/api/sources/${sourceId}/audio`}
        preload='metadata'
        data-testid='meeting-audio'
        {...bind}
      />

      <div className='flex min-w-0 items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5'>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background',
            meta.tone
          )}
        >
          <StateIcon
            className={cn(
              'size-4',
              loading && 'animate-spin motion-reduce:animate-none'
            )}
            data-state-icon
            aria-hidden
          />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-1'>
            <div
              className='min-w-0 flex-1'
              role='status'
              aria-live='polite'
              aria-atomic='true'
            >
              <p className={cn('text-sm font-medium', meta.tone)}>
                {meta.label}
              </p>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                {meta.detail}
              </p>
            </div>
            <p
              className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'
              data-testid='audio-clock'
              aria-label={`현재 ${formatClock(currentMs)}, 전체 ${duration === null ? '확인 중' : formatClock(duration)}`}
            >
              <span className='text-foreground'>{formatClock(currentMs)}</span>
              <span aria-hidden> / </span>
              <span>{duration === null ? '--:--' : formatClock(duration)}</span>
            </p>
          </div>
        </div>
      </div>

      {state === 'error' ? (
        <div className='mt-4 flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
          <p className='min-w-0 text-sm text-state-danger' role='alert'>
            {error}
          </p>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={reload}
            className='shrink-0 self-start sm:self-auto'
            aria-label='오디오 다시 불러오기'
          >
            <RefreshCw className='size-4' aria-hidden />
            다시 불러오기
          </Button>
        </div>
      ) : (
        <div className='mt-5 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-4 pb-4 sm:gap-5 sm:px-5 sm:pb-5'>
          <Button
            type='button'
            size='icon'
            variant={playing ? 'secondary' : 'default'}
            onClick={toggle}
            disabled={loading}
            className='size-11 rounded-full'
            aria-label={playing ? '일시정지' : ended ? '처음부터 재생' : '재생'}
          >
            {playing ? (
              <Pause className='size-4' aria-hidden />
            ) : ended ? (
              <RotateCcw className='size-4' aria-hidden />
            ) : (
              <Play className='ml-0.5 size-4' aria-hidden />
            )}
          </Button>

          <div className='flex min-w-0 flex-col gap-2'>
            <input
              type='range'
              min={0}
              max={duration ?? 0}
              step={1000}
              value={Math.min(currentMs, duration ?? 0)}
              onChange={(event) => controller.seek(Number(event.target.value))}
              className='audio-player__scrubber w-full'
              style={rangeStyle}
              aria-label='재생 위치'
              aria-valuetext={`${formatClock(currentMs)} / ${duration === null ? '전체 시간 확인 중' : formatClock(duration)}`}
              disabled={duration === null}
            />
            <div
              className='flex justify-between font-mono text-[10px] text-muted-foreground tabular-nums'
              aria-hidden
            >
              <span>0:00</span>
              <span>{duration === null ? '--:--' : formatClock(duration)}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
