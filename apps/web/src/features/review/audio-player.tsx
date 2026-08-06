import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 회의 오디오 재생기.
 *
 * ⛔ **영상 player가 아니다.** 화면 계약: 왼쪽 상단에 오디오 재생기.
 *    영상 자리를 만들면 없는 것을 기다리게 된다.
 *
 * ⛔ **timestamp를 눌러 그 지점으로 가는 것이 이 화면의 목적이다.**
 *    그래서 seek는 밖에서 부를 수 있어야 하고, 현재 위치는 밖으로 나가야 한다.
 */

export type AudioController = {
  /** 밀리초 지점으로 이동하고 재생한다 */
  seek: (ms: number) => void
  /** 현재 재생 위치(ms). 재생 전에는 0 */
  currentMs: number
  playing: boolean
  /** 오디오를 못 불러왔다. 화면이 이 사실을 숨기지 않는다 */
  error: string | null
  duration: number | null
}

const SKIP_MS = 5000

export function useAudioController(): {
  controller: AudioController
  audioRef: React.RefObject<HTMLAudioElement | null>
  bind: {
    onTimeUpdate: () => void
    onPlay: () => void
    onPause: () => void
    onLoadedMetadata: () => void
    onError: () => void
  }
} {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const seek = useCallback((ms: number) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = ms / 1000
    setCurrentMs(ms)
    // 눌렀는데 안 들리면 눌린 것인지 알 수 없다. 재생까지 한다.
    void el.play().catch(() => undefined)
  }, [])

  return {
    controller: { seek, currentMs, playing, error, duration },
    audioRef,
    bind: {
      onTimeUpdate: () =>
        setCurrentMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000)),
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onLoadedMetadata: () => {
        const d = audioRef.current?.duration
        setDuration(Number.isFinite(d) ? Math.round((d ?? 0) * 1000) : null)
        setError(null)
      },
      onError: () =>
        setError(
          '오디오를 불러오지 못했습니다. 조각이 아직 정리되지 않았을 수 있습니다.'
        ),
    },
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

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
  const { currentMs, playing, duration, error } = controller

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }

  const skip = (delta: number) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = Math.max(0, el.currentTime + delta / 1000)
  }

  // 회의가 바뀌면 처음부터
  useEffect(() => {
    audioRef.current?.load()
  }, [sourceId, audioRef])

  return (
    <section
      className='border-border flex flex-col gap-3 rounded-lg border p-4'
      data-testid='audio-player'
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

      {error ? (
        <p className='text-state-danger text-sm' role='alert'>
          {error}
        </p>
      ) : (
        <>
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              size='icon'
              variant='secondary'
              onClick={toggle}
              aria-label={playing ? '일시정지' : '재생'}
            >
              {playing ? (
                <Pause className='size-4' aria-hidden />
              ) : (
                <Play className='size-4' aria-hidden />
              )}
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              onClick={() => skip(-SKIP_MS)}
              aria-label='5초 뒤로'
            >
              <RotateCcw className='size-4' aria-hidden />
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              onClick={() => skip(SKIP_MS)}
              aria-label='5초 앞으로'
            >
              <RotateCw className='size-4' aria-hidden />
            </Button>
            <span
              className='text-muted-foreground ml-auto font-mono text-xs tabular-nums'
              data-testid='audio-clock'
            >
              {formatClock(currentMs)}
              {duration !== null && ` / ${formatClock(duration)}`}
            </span>
          </div>

          {/*
            ⚠️ 진행 막대는 `<input type=range>`다. 직접 그린 div는 keyboard로
               못 움직인다 — 화면 계약에 keyboard 완주가 있다.
          */}
          <input
            type='range'
            min={0}
            max={duration ?? 0}
            value={Math.min(currentMs, duration ?? 0)}
            onChange={(e) => controller.seek(Number(e.target.value))}
            className='accent-primary w-full'
            aria-label='재생 위치'
            disabled={duration === null}
          />
        </>
      )}
    </section>
  )
}
