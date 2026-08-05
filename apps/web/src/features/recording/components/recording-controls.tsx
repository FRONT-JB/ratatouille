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
  return (
    <div className='flex flex-wrap items-center gap-2'>
      {controls.canStart && (
        <Button onClick={onStart} size='lg'>
          <Mic /> 녹음 시작
        </Button>
      )}
      {controls.canPause && (
        <Button onClick={onPause} variant='outline' size='lg'>
          <Pause /> 일시정지
        </Button>
      )}
      {controls.canResume && (
        <Button onClick={onResume} size='lg'>
          <Play /> 재개
        </Button>
      )}
      {controls.canStop && (
        <Button onClick={onStop} variant='destructive' size='lg'>
          <Square /> 녹음 종료
        </Button>
      )}
    </div>
  )
}
