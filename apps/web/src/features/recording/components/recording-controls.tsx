import { Mic, Pause, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RecordingControls as Controls } from '../screen-state'

type Props = {
  controls: Controls
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

/**
 * 녹음 조작.
 *
 * ⛔ **자동으로 녹음이 시작되지 않는다.** 화면 계약: "사용자가 직접 시작한다".
 *    이 컴포넌트는 클릭에만 반응하고, 마운트 시 아무 일도 하지 않는다.
 */
export function RecordingControls({
  controls,
  onStart,
  onPause,
  onResume,
  onStop,
}: Props) {
  const visible = Object.values(controls).some(Boolean)
  if (!visible) return null

  return (
    <div
      className='flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.06)] sm:p-4'
      aria-label='녹음 조작'
    >
      {controls.canStart && (
        <Button onClick={onStart} size='lg' className='w-full sm:w-auto'>
          <Mic /> 녹음 시작
        </Button>
      )}
      {controls.canPause && (
        <Button
          onClick={onPause}
          variant='outline'
          size='lg'
          className='flex-1 sm:flex-none'
        >
          <Pause /> 일시정지
        </Button>
      )}
      {controls.canResume && (
        <Button onClick={onResume} size='lg' className='flex-1 sm:flex-none'>
          <Play /> 재개
        </Button>
      )}
      {controls.canStop && (
        <Button
          onClick={onStop}
          variant='destructive'
          size='lg'
          className='flex-1 sm:flex-none'
        >
          <Square /> 녹음 종료
        </Button>
      )}
    </div>
  )
}
