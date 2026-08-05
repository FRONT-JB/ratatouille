import { cn } from '@/lib/utils'
import { useAudioLevel, useAudioLevels } from '../use-audio-level'

type VisualizerProps = {
  stream: MediaStream | null
  active: boolean
  label: string
  className?: string
}

/**
 * 녹음 파형.
 *
 * ⛔ 막대 높이는 **실제 MediaStream 레벨**이다. 장식 animation이 아니다
 *    (`use-audio-level.ts` 참조). 파형이 움직인다는 것 자체가 입력이 살아
 *    있다는 증거여야 한다.
 *
 * 막대 하나하나가 과거 레벨의 이동 기록이다. 오른쪽 끝이 현재.
 */
export function RecordingVisualizer({
  stream,
  active,
  label,
  className,
}: VisualizerProps) {
  const { level, history } = useAudioLevels(stream, active)

  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-testid='recording-visualizer'
      data-active={active}
      // 테스트와 접근성 양쪽에서 현재 레벨을 확인할 수 있게 노출한다
      data-level={level.toFixed(3)}
      role='img'
      aria-label={`${label} 입력 레벨 ${Math.round(level * 100)}%`}
    >
      <div className='flex h-24 items-end gap-[3px]' aria-hidden>
        {history.map((h, i) => (
          <div
            key={i}
            className={cn(
              'flex-1 rounded-sm transition-[height] duration-75',
              active ? 'bg-primary' : 'bg-muted-foreground/25'
            )}
            style={{ height: `${Math.max(2, h * 100)}%` }}
          />
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>{label}</p>
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
  const level = useAudioLevel(stream, stream !== null)

  return (
    <div className='flex flex-col gap-1.5' data-testid={`level-meter-${label}`}>
      {(showLabel || hint) && (
        <div className='flex items-baseline justify-between'>
          {showLabel ? (
            <span className='text-sm font-medium'>{label}</span>
          ) : (
            <span />
          )}
          {hint && <span className='text-muted-foreground text-xs'>{hint}</span>}
        </div>
      )}
      <div
        className='bg-muted h-2 w-full overflow-hidden rounded-full'
        role='meter'
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} 입력 레벨`}
      >
        <div
          className='bg-state-success h-full rounded-full transition-[width] duration-75'
          style={{ width: `${level * 100}%` }}
        />
      </div>
    </div>
  )
}
