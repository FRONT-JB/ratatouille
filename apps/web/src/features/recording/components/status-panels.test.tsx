import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { RECORDING_SCREEN_STATES, describeScreenState } from '../screen-state'
import { RecordingStatus } from './status-panels'

describe('녹음 화면 상태 피드백', () => {
  it('8종 상태가 문구와 아이콘을 함께 제공한다', async () => {
    const screen = await render(
      <RecordingStatus state='permission_prompt' elapsedLabel='00:00' />
    )

    for (const state of RECORDING_SCREEN_STATES) {
      await screen.rerender(
        <RecordingStatus state={state} elapsedLabel='00:00' />
      )

      const status = screen.container.querySelector(
        `[data-testid='recording-status'][data-state='${state}']`
      )
      expect(status).toBeTruthy()
      expect(status?.textContent).toContain(describeScreenState(state))
      expect(status?.querySelector('[data-state-icon]')).toBeTruthy()
    }
  })

  it('reduced-motion에서는 상태 pulse를 제거한다', async () => {
    const screen = await render(
      <RecordingStatus state='recording' elapsedLabel='00:12' />
    )
    const icon = screen.container.querySelector('[data-state-icon]')

    expect(icon?.classList.contains('animate-pulse')).toBe(true)
    expect(icon?.classList.contains('motion-reduce:animate-none')).toBe(true)
  })

  it('계속 변하는 타이머는 live region 밖에 둔다', async () => {
    const screen = await render(
      <RecordingStatus state='recording' elapsedLabel='00:12' />
    )
    const liveRegion = screen.getByRole('status').element()
    const timer = screen.getByLabelText(/녹음 경과 시간/).element()

    expect(liveRegion.contains(timer)).toBe(false)

    await screen.rerender(
      <RecordingStatus state='track_lost' elapsedLabel='00:12' />
    )
    expect(screen.container.querySelector('[role=status]')).toBeNull()
  })
})
