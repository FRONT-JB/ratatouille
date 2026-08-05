import { useEffect, useState } from 'react'
import { LevelMonitor, levelToBarHeight } from './audio-level'

export const BAR_COUNT = 32

const FLAT: readonly number[] = Array(BAR_COUNT).fill(0)

export type LevelState = {
  /** 0~1로 정규화된 현재 레벨 */
  level: number
  /** 과거 레벨. 오른쪽 끝이 현재. */
  history: readonly number[]
}

const IDLE: LevelState = { level: 0, history: FLAT }

/**
 * 실제 입력 레벨을 읽어 돌려준다.
 *
 * ⛔ 여기서 난수나 sin 곡선을 쓰지 않는다. 파형이 움직인다는 것은
 *    **입력이 살아 있다는 증거**여야 한다. 장식이면 마이크가 죽어도 움직이고,
 *    사용자는 30분 뒤에야 무음 파일을 발견한다.
 *
 * 갱신은 전부 rAF 콜백 안에서 한다. effect 본문에서 setState를 부르면
 * 렌더가 연쇄로 돈다.
 */
export function useAudioLevels(
  stream: MediaStream | null,
  active: boolean
): LevelState {
  const [state, setState] = useState<LevelState>(IDLE)

  useEffect(() => {
    if (!stream || !active) return

    let raf = 0
    let cancelled = false
    const monitor = new LevelMonitor()

    const tick = () => {
      if (cancelled) return
      const level = levelToBarHeight(monitor.read().rms)
      setState((prev) => ({ level, history: [...prev.history.slice(1), level] }))
      raf = requestAnimationFrame(tick)
    }

    void monitor.start(stream).then(() => {
      if (!cancelled) tick()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      void monitor.dispose()
    }
  }, [stream, active])

  // 꺼진 상태는 렌더 시점에 판단한다. effect의 setState로 되돌리면
  // 마지막 레벨이 한 프레임 남거나 렌더가 한 번 더 돈다.
  return stream && active ? state : IDLE
}

export function useAudioLevel(stream: MediaStream | null, active: boolean): number {
  return useAudioLevels(stream, active).level
}
