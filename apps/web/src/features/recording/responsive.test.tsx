import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { RecordingPage } from './index'

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]

afterEach(() => page.viewport(1440, 900))

describe('녹음 화면 반응형', () => {
  it.each(VIEWPORTS)(
    '$widthpx에서 대면·온라인 준비 화면이 수평으로 넘치지 않는다',
    async ({ width, height }) => {
      await page.viewport(width, height)
      const screen = await render(<RecordingPage />)

      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      )

      await userEvent.click(screen.getByRole('radio', { name: /온라인 회의/ }))
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      )
    }
  )
})
