/**
 * 오디오 재생 제어.
 *
 * ⛔ **timestamp를 눌러 그 지점으로 가는 것이 페이지 B의 목적이다.**
 *    그래서 seek는 밖에서 부를 수 있어야 하고, 현재 위치는 밖으로 나가야 한다.
 *
 * ⚠️ 컴포넌트 파일에서 분리한 이유: 한 파일이 컴포넌트와 hook을 함께 내보내면
 *    Vite fast refresh가 동작하지 않는다.
 */

import { useCallback, useRef, useState } from 'react'

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

/** 앞뒤로 건너뛰는 폭. 말 한 문장이 대략 이 정도다 */
export const SKIP_MS = 5000

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

