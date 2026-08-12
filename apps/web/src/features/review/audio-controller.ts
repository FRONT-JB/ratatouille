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

export type AudioPlaybackState =
  'loading' | 'paused' | 'playing' | 'ended' | 'error'

const AUDIO_ERROR =
  '오디오를 불러오지 못했습니다. 조각이 아직 정리되지 않았을 수 있습니다.'

export type AudioController = {
  /**
   * 그 지점으로 **옮기기만** 한다. 재생 상태는 건드리지 않는다.
   *
   * ⛔ 예전에는 여기서 항상 재생했다. 근거를 확인하려고 각주를 눌렀을 뿐인데
   *    소리가 터져 나왔다 — 읽는 중에 재생이 시작되는 건 방해다.
   *    듣고 싶으면 `playAt`을 부른다.
   */
  seek: (ms: number) => void
  /** 그 지점으로 옮기고 **재생한다.** 사용자가 「듣기」를 눌렀을 때만 */
  playAt: (ms: number) => void
  /** 플레이어의 주 재생 조작. 재생 실패도 화면 상태로 올린다. */
  play: () => void
  pause: () => void
  /** source가 바뀌거나 오류 뒤 다시 불러올 때 모든 표시 상태를 비운다. */
  reset: () => void
  /** 현재 재생 위치(ms). 재생 전에는 0 */
  currentMs: number
  playing: boolean
  state: AudioPlaybackState
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
    onLoadStart: () => void
    onPlay: () => void
    onPause: () => void
    onWaiting: () => void
    onCanPlay: () => void
    onEnded: () => void
    onLoadedMetadata: () => void
    onError: () => void
  }
} {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [state, setState] = useState<AudioPlaybackState>('loading')
  const [duration, setDuration] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = useCallback(() => {
    setError(AUDIO_ERROR)
    setState('error')
  }, [])

  const seek = useCallback((ms: number) => {
    const el = audioRef.current
    if (!el) return
    const endMs = Number.isFinite(el.duration)
      ? Math.round(el.duration * 1000)
      : null
    const next = Math.max(0, endMs === null ? ms : Math.min(ms, endMs))
    el.currentTime = next / 1000
    setCurrentMs(next)
    setState((current) =>
      current === 'ended' && (endMs === null || next < endMs)
        ? 'paused'
        : current
    )
  }, [])

  const play = useCallback(() => {
    void audioRef.current?.play().catch(fail)
  }, [fail])

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const playAt = useCallback(
    (ms: number) => {
      seek(ms)
      play()
    },
    [play, seek]
  )

  const reset = useCallback(() => {
    setCurrentMs(0)
    setDuration(null)
    setError(null)
    setState('loading')
  }, [])

  const readReadyState = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    setState(el.ended ? 'ended' : el.paused ? 'paused' : 'playing')
  }, [])

  return {
    controller: {
      seek,
      playAt,
      play,
      pause,
      reset,
      currentMs,
      playing: state === 'playing',
      state,
      error,
      duration,
    },
    audioRef,
    bind: {
      onLoadStart: () => {
        setError(null)
        setState('loading')
      },
      onTimeUpdate: () =>
        setCurrentMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000)),
      onPlay: () => setState('playing'),
      onPause: () =>
        setState((current) => {
          if (current === 'loading' || current === 'error') return current
          return audioRef.current?.ended ? 'ended' : 'paused'
        }),
      onWaiting: () => setState('loading'),
      onCanPlay: readReadyState,
      onEnded: () => {
        const el = audioRef.current
        setCurrentMs(Math.round((el?.duration ?? el?.currentTime ?? 0) * 1000))
        setState('ended')
      },
      onLoadedMetadata: () => {
        const d = audioRef.current?.duration
        setDuration(Number.isFinite(d) ? Math.round((d ?? 0) * 1000) : null)
        setError(null)
        readReadyState()
      },
      onError: fail,
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
