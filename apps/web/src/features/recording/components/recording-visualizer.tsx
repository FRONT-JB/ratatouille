import { AudioLines, Mic2, MonitorSpeaker } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAudioLevels } from '../use-audio-level'

type VisualizerProps = {
  stream: MediaStream | null
  active: boolean
  label: string
  className?: string
}

const STALLED_TEXT = '입력 레벨을 읽을 수 없습니다'

/**
 * 녹음 파형.
 *
 * ⛔ 막대 높이는 **실제 MediaStream 레벨**이다. 장식 animation이 아니다
 *    (`use-audio-level.ts` 참조). 파형이 움직인다는 것 자체가 입력이 살아
 *    있다는 증거여야 한다.
 *
 * 막대 하나하나가 과거 레벨의 이동 기록이다. 오른쪽 끝이 현재.
 *
 * ⛔ **평평한 파형이 "무음"인지 "고장"인지 화면에서 구분된다.** 실제로 탭
 *    오디오가 max -0.0 dB로 멀쩡히 녹음되는데 파형만 평평했던 적이 있고,
 *    그때 화면만 보고는 소리가 안 들어오는 건지 못 읽는 건지 알 수 없었다.
 */
export function RecordingVisualizer({
  stream,
  active,
  label,
  className,
}: VisualizerProps) {
  const { level, history, reading, stalled } = useAudioLevels(stream, active)
  const InputIcon = label === '탭 오디오' ? MonitorSpeaker : Mic2

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card',
        className
      )}
      data-testid='recording-visualizer'
      data-active={active}
      // 테스트와 접근성 양쪽에서 현재 레벨을 확인할 수 있게 노출한다
      data-level={level.toFixed(3)}
      data-reading={reading}
      role='img'
      aria-label={
        stalled
          ? `${label} ${STALLED_TEXT}`
          : `${label} 입력 레벨 ${Math.round(level * 100)}%`
      }
    >
      <div className='flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <InputIcon
            className='size-4 shrink-0 text-muted-foreground'
            aria-hidden
          />
          <p className='truncate text-sm font-medium'>{label}</p>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-xs',
            stalled
              ? 'text-state-warning'
              : active
                ? 'text-state-success'
                : 'text-muted-foreground'
          )}
        >
          <AudioLines className='size-3.5' aria-hidden />
          {stalled ? '읽기 오류' : active ? '실시간 입력' : '일시정지'}
        </span>
      </div>

      <div
        className='relative flex h-36 items-center gap-[3px] px-4 py-5 sm:h-44 sm:px-5'
        aria-hidden
      >
        <div className='absolute inset-x-4 top-1/2 h-px bg-border sm:inset-x-5' />
        {history.map((height, index) => (
          <div
            key={index}
            className={cn(
              'relative min-w-px flex-1 rounded-full transition-[height] duration-75 motion-reduce:transition-none',
              stalled
                ? 'bg-state-warning/40'
                : active
                  ? 'bg-foreground'
                  : 'bg-muted-foreground/25'
            )}
            style={{ height: `${Math.max(3, height * 100)}%` }}
          />
        ))}
      </div>

      <div className='flex min-h-10 items-center justify-between gap-3 border-t border-border px-4 py-2 sm:px-5'>
        {stalled ? (
          <p className='text-xs text-state-warning' role='alert'>
            {STALLED_TEXT}. 녹음은 계속되고 있습니다.
          </p>
        ) : (
          <p className='text-xs text-muted-foreground'>
            오른쪽 끝이 현재 입력입니다.
          </p>
        )}
        <span className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
          {Math.round(level * 100)}%
        </span>
      </div>
    </div>
  )
}

/**
 * 시작 전 사전 level meter.
 *
 * 화면 계약: "시작 전 마이크 level meter와 탭 오디오 level meter가 **각각** 표시된다."
 * 하나로 합치면 어느 쪽이 죽었는지 알 수 없다.
 */
export function LevelMeter({
  stream,
  label,
  hint,
  showLabel = true,
}: {
  stream: MediaStream | null
  /** 접근성 이름에 항상 쓰인다. 화면 표시는 `showLabel`이 정한다. */
  label: string
  hint?: string
  /** 바로 위에 같은 제목이 있으면 끈다 — 같은 말을 두 번 읽히지 않는다 */
  showLabel?: boolean
}) {
  const { level, reading, stalled } = useAudioLevels(stream, stream !== null)

  return (
    <div
      className='flex flex-col gap-1.5'
      data-testid={`level-meter-${label}`}
      data-reading={reading}
    >
      {(showLabel || hint) && (
        <div className='flex items-baseline justify-between'>
          {showLabel ? (
            <span className='text-sm font-medium'>{label}</span>
          ) : (
            <span />
          )}
          {hint && (
            <span className='text-xs text-muted-foreground'>{hint}</span>
          )}
        </div>
      )}
      <div
        className='h-2.5 w-full overflow-hidden rounded-full bg-muted'
        role='meter'
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} 입력 레벨`}
      >
        <div
          className='h-full rounded-full bg-state-success transition-[width] duration-75 motion-reduce:transition-none'
          style={{ width: `${level * 100}%` }}
        />
      </div>
      {/*
        ⛔ 시작 전에 이 사실을 못 보면, 레벨이 0인 채로 녹음을 시작하고
           끝난 뒤에야 무음인지 확인하게 된다.
      */}
      {stalled && (
        <p className='text-xs text-state-warning' role='alert'>
          {STALLED_TEXT}. 브라우저 탭을 한 번 클릭한 뒤 다시 확인해 주세요.
        </p>
      )}
    </div>
  )
}
