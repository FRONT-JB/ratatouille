import { AlertTriangle, HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type Preservation,
  type RecordingScreenState,
  type TrackAlert,
  describeScreenState,
  describeTrackAlert,
} from '../screen-state'

/**
 * ⛔ 녹음 상태 표시.
 *
 * `PreservationStatus`와 **별개의 요소다.** 화면 계약: "녹음 상태와 원본 보존
 * 상태가 각각 독립된 표시 요소를 가진다." 하나로 합치면 저장에 실패해도
 * 사용자는 녹음이 잘 되고 있다고 믿는다.
 */
export function RecordingStatus({
  state,
  elapsedLabel,
}: {
  state: RecordingScreenState
  elapsedLabel: string
}) {
  const live = state === 'recording'
  return (
    <div
      className='flex items-center gap-3'
      data-testid='recording-status'
      data-state={state}
    >
      <span
        className={cn(
          'size-2.5 rounded-full',
          live ? 'bg-state-danger animate-pulse' : 'bg-muted-foreground/40'
        )}
        aria-hidden
      />
      <div className='flex items-baseline gap-3'>
        <span className='text-sm font-medium'>{describeScreenState(state)}</span>
        <span className='font-mono text-2xl tabular-nums' aria-label='녹음 경과 시간'>
          {elapsedLabel}
        </span>
      </div>
    </div>
  )
}

const PRESERVATION_STYLE = {
  empty: { icon: HardDrive, tone: 'text-muted-foreground', label: '아직 저장할 것 없음' },
  at_risk: { icon: ShieldAlert, tone: 'text-state-danger', label: '보존 위험' },
  local_only: { icon: HardDrive, tone: 'text-state-warning', label: '이 브라우저에만 있음' },
  safe: { icon: ShieldCheck, tone: 'text-state-success', label: '서버에 안전하게 보존됨' },
} as const

/** ⛔ `RecordingStatus`와 분리된 요소. 위 주석 참조. */
export function PreservationStatus({ preservation }: { preservation: Preservation }) {
  const style = PRESERVATION_STYLE[preservation.level]
  const Icon = style.icon

  return (
    <div
      className='flex flex-col gap-1'
      data-testid='preservation-status'
      data-level={preservation.level}
    >
      <div className={cn('flex items-center gap-2 text-sm', style.tone)}>
        <Icon className='size-4 shrink-0' aria-hidden />
        <span className='font-medium'>{style.label}</span>
        {preservation.savedChunks > 0 && (
          <span className='text-muted-foreground tabular-nums'>
            조각 {preservation.savedChunks}개
          </span>
        )}
      </div>
      {preservation.warning && (
        <p className='text-muted-foreground pl-6 text-xs'>{preservation.warning}</p>
      )}
    </div>
  )
}

/**
 * ⛔ track별 경고.
 *
 * 화면 계약: "마이크만 끊긴 경우와 탭 오디오만 끊긴 경우가 **서로 다르게**
 * 표시된다." 하나의 "입력 오류"로 뭉치지 않는다 — 대처가 완전히 다르다.
 */
export function TrackAlerts({ alerts }: { alerts: TrackAlert[] }) {
  if (alerts.length === 0) return null

  return (
    <ul className='flex flex-col gap-2' data-testid='track-alerts'>
      {alerts.map((a) => (
        <li
          key={`${a.track}-${a.kind}`}
          data-testid={`track-alert-${a.track}`}
          data-kind={a.kind}
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-sm',
            a.kind === 'lost'
              ? 'border-state-danger/40 bg-state-danger/5'
              : 'border-state-warning/40 bg-state-warning/5'
          )}
          role='alert'
        >
          <AlertTriangle
            className={cn(
              'mt-0.5 size-4 shrink-0',
              a.kind === 'lost' ? 'text-state-danger' : 'text-state-warning'
            )}
            aria-hidden
          />
          <span>{describeTrackAlert(a)}</span>
        </li>
      ))}
    </ul>
  )
}
