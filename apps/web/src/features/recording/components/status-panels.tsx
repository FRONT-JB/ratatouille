import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  CirclePause,
  HardDrive,
  LoaderCircle,
  Mic2,
  MicOff,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type Preservation,
  type RecordingScreenState,
  type TrackAlert,
  describeScreenState,
  describeTrackAlert,
} from '../screen-state'

const STATE_STYLE = {
  permission_prompt: {
    icon: Mic2,
    tone: 'text-state-info',
    surface: 'bg-state-info/8 border-state-info/25',
    detail: '마이크 입력을 확인하려면 브라우저 권한을 허용해 주세요.',
  },
  permission_denied: {
    icon: MicOff,
    tone: 'text-state-danger',
    surface: 'bg-state-danger/6 border-state-danger/25',
    detail: '브라우저 주소창의 마이크 설정을 변경한 뒤 다시 확인해 주세요.',
  },
  ready: {
    icon: CircleCheck,
    tone: 'text-state-success',
    surface: 'bg-state-success/6 border-state-success/25',
    detail: '입력 레벨을 확인했습니다. 준비되면 직접 녹음을 시작하세요.',
  },
  recording: {
    icon: Radio,
    tone: 'text-state-danger',
    surface: 'bg-card border-border',
    detail: '실제 입력 신호를 녹음하고 있습니다.',
  },
  paused: {
    icon: CirclePause,
    tone: 'text-state-warning',
    surface: 'bg-state-warning/6 border-state-warning/25',
    detail: '새 오디오는 기록하지 않습니다. 기존 녹음은 그대로 보존됩니다.',
  },
  track_lost: {
    icon: Unplug,
    tone: 'text-state-danger',
    surface: 'bg-state-danger/6 border-state-danger/25',
    detail: '지금까지의 녹음은 유지됩니다. 아래에서 끊긴 입력을 확인하세요.',
  },
  saving: {
    icon: LoaderCircle,
    tone: 'text-state-info',
    surface: 'bg-state-info/6 border-state-info/25',
    detail: '남은 조각을 저장하고 서버에서 종료를 확인하고 있습니다.',
  },
  stop_failed: {
    icon: CircleAlert,
    tone: 'text-state-danger',
    surface: 'bg-state-danger/6 border-state-danger/25',
    detail:
      '로컬 녹음은 남아 있습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
  },
} as const

/**
 * ⛔ 녹음의 8개 화면 상태를 문구 + 고유 아이콘으로 표시한다.
 * 색을 보지 못해도 아이콘 윤곽과 설명으로 현재 상태를 구분할 수 있다.
 */
export function RecordingStatus({
  state,
  elapsedLabel,
  compact = false,
  testId = 'recording-status',
}: {
  state: RecordingScreenState
  elapsedLabel: string
  compact?: boolean
  testId?: string
}) {
  const style = STATE_STYLE[state]
  const Icon = style.icon
  const busy = state === 'saving'
  const live = state === 'recording'

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl border',
        compact ? 'p-4' : 'px-4 py-5 sm:px-6 sm:py-6',
        style.surface
      )}
      data-testid={testId}
      data-state={state}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border bg-background',
          compact ? 'size-10' : 'size-11 sm:size-12',
          style.tone
        )}
      >
        <Icon
          className={cn(
            compact ? 'size-4' : 'size-5',
            busy && 'animate-spin motion-reduce:animate-none',
            live && 'animate-pulse motion-reduce:animate-none'
          )}
          data-state-icon
          aria-hidden
        />
      </span>

      <div
        className='min-w-0 flex-1'
        role={
          state === 'track_lost' || state === 'stop_failed'
            ? undefined
            : 'status'
        }
        aria-live={
          state === 'track_lost' || state === 'stop_failed'
            ? undefined
            : 'polite'
        }
        aria-atomic={
          state === 'track_lost' || state === 'stop_failed' ? undefined : 'true'
        }
      >
        <p
          className={cn(
            'font-medium',
            compact ? 'text-sm' : 'text-base',
            style.tone
          )}
        >
          {describeScreenState(state)}
        </p>
        <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
          {style.detail}
        </p>
      </div>

      {!compact && (
        <time
          className='shrink-0 font-mono text-3xl font-medium tracking-tight tabular-nums sm:text-5xl'
          aria-label={`녹음 경과 시간 ${elapsedLabel}`}
        >
          {elapsedLabel}
        </time>
      )}
    </div>
  )
}

const PRESERVATION_STYLE = {
  empty: {
    icon: HardDrive,
    tone: 'text-muted-foreground',
    label: '아직 저장할 것 없음',
  },
  at_risk: { icon: ShieldAlert, tone: 'text-state-danger', label: '보존 위험' },
  local_only: {
    icon: HardDrive,
    tone: 'text-state-warning',
    label: '이 브라우저에만 있음',
  },
  safe: {
    icon: ShieldCheck,
    tone: 'text-state-success',
    label: '서버에 안전하게 보존됨',
  },
} as const

/** ⛔ 입력 상태와 합치지 않는 독립된 보존 상태 패널. */
export function PreservationStatus({
  preservation,
}: {
  preservation: Preservation
}) {
  const style = PRESERVATION_STYLE[preservation.level]
  const Icon = style.icon

  return (
    <section
      className='min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5'
      data-testid='preservation-status'
      data-level={preservation.level}
      aria-labelledby='preservation-heading'
    >
      <div className='flex items-start gap-3'>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full bg-muted',
            style.tone
          )}
        >
          <Icon className='size-4' aria-hidden />
        </span>
        <div className='min-w-0 flex-1'>
          <p
            id='preservation-heading'
            className='text-xs font-medium text-muted-foreground'
          >
            보존 상태
          </p>
          <div className='mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
            <p className={cn('text-sm font-medium', style.tone)}>
              {style.label}
            </p>
            {preservation.savedChunks > 0 && (
              <span className='text-xs text-muted-foreground tabular-nums'>
                저장 조각 {preservation.savedChunks}개
              </span>
            )}
          </div>
          {preservation.warning && (
            <p className='mt-1 text-xs text-muted-foreground'>
              {preservation.warning}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * ⛔ track별 경고. 보존 상태와 별개이며 정상일 때도 입력 상태 영역을 유지한다.
 */
export function TrackAlerts({ alerts }: { alerts: TrackAlert[] }) {
  return (
    <section
      className='min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5'
      data-testid='track-alerts'
      aria-labelledby='track-health-heading'
    >
      <div className='flex items-start gap-3'>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full bg-muted',
            alerts.length > 0 ? 'text-state-danger' : 'text-state-success'
          )}
        >
          {alerts.length > 0 ? (
            <AlertTriangle className='size-4' aria-hidden />
          ) : (
            <CheckCircle2 className='size-4' aria-hidden />
          )}
        </span>

        <div className='min-w-0 flex-1'>
          <p
            id='track-health-heading'
            className='text-xs font-medium text-muted-foreground'
          >
            입력 상태
          </p>
          {alerts.length === 0 ? (
            <p className='mt-0.5 text-sm font-medium text-state-success'>
              입력 연결 정상
            </p>
          ) : (
            <ul className='mt-1 flex flex-col gap-2'>
              {alerts.map((alert) => (
                <li
                  key={`${alert.track}-${alert.kind}`}
                  data-testid={`track-alert-${alert.track}`}
                  data-kind={alert.kind}
                  className='flex items-start gap-2 text-sm'
                  role='alert'
                >
                  <AlertTriangle
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      alert.kind === 'lost'
                        ? 'text-state-danger'
                        : 'text-state-warning'
                    )}
                    aria-hidden
                  />
                  <span>{describeTrackAlert(alert)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
