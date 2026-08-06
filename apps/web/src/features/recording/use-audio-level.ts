import { useEffect, useState } from 'react'
import { levelToBarHeight, readLevel } from './audio-level'
import { acquireAnalyser, releaseAnalyser } from './analyser-pool'

export const BAR_COUNT = 32

const FLAT: readonly number[] = Array(BAR_COUNT).fill(0)

export type LevelState = {
  /** 0~1로 정규화된 현재 레벨 */
  level: number
  /** 과거 레벨. 오른쪽 끝이 현재. */
  history: readonly number[]
  /**
   * 레벨을 읽고 있는가.
   *
   * ⛔ 이 값이 없으면 화면에서 **"무음"과 "고장"이 구분되지 않는다.**
   *    실제로 파형이 평평했을 때, 녹음이 된 건지 안 된 건지 화면만 보고는
   *    판단할 수 없었다. 소리가 안 들어오는 것과 못 읽는 것은 다른 사실이다.
   */
  reading: boolean
  /**
   * 못 읽는 상태가 유예 시간을 넘겼는가. 화면 경고는 이 값으로 띄운다.
   *
   * ⚠️ `reading`을 그대로 쓰면 첫 프레임과 `resume()` 대기 구간에서 경고가
   *    깜빡인다. 경고가 깜빡이면 사용자는 경고를 무시하는 법을 배운다.
   */
  stalled: boolean
}

const IDLE: LevelState = { level: 0, history: FLAT, reading: false, stalled: false }

/** 이만큼 못 읽고 있으면 화면에 밝힌다 */
const STALL_GRACE_MS = 800

/**
 * 실제 입력 레벨을 읽어 돌려준다.
 *
 * ⛔ 여기서 난수나 sin 곡선을 쓰지 않는다. 파형이 움직인다는 것은
 *    **입력이 살아 있다는 증거**여야 한다. 장식이면 마이크가 죽어도 움직이고,
 *    사용자는 30분 뒤에야 무음 파일을 발견한다.
 *
 * ⛔ analyser는 `analyser-pool`에서 **공유**한다. 컴포넌트마다 AudioContext를
 *    만들면 같은 track에 source node가 둘 붙어 Chrome이 데이터를 끊는다.
 */
export function useAudioLevels(
  stream: MediaStream | null,
  active: boolean
): LevelState {
  const [state, setState] = useState<LevelState>(IDLE)

  useEffect(() => {
    if (!stream || !active) return

    const handle = acquireAnalyser(stream)
    if (!handle) return

    let raf = 0
    let cancelled = false
    // 유예는 **루프 안에서** 잰다. 별도 effect + setTimeout으로 재면
    // effect 안에서 setState를 부르게 되고 렌더가 연쇄로 돈다.
    let notReadingSince: number | null = null

    const tick = () => {
      if (cancelled) return
      handle.read(handle.buffer)
      const level = levelToBarHeight(readLevel(handle.buffer).rms)

      const reading = handle.isRunning()
      const now = performance.now()
      if (reading) notReadingSince = null
      else if (notReadingSince === null) notReadingSince = now

      setState((prev) => ({
        level,
        history: [...prev.history.slice(1), level],
        reading,
        stalled: notReadingSince !== null && now - notReadingSince >= STALL_GRACE_MS,
      }))
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      releaseAnalyser(stream)
    }
  }, [stream, active])

  // 꺼진 상태는 렌더 시점에 판단한다. effect의 setState로 되돌리면
  // 마지막 레벨이 한 프레임 남거나 렌더가 한 번 더 돈다.
  return stream && active ? state : IDLE
}
