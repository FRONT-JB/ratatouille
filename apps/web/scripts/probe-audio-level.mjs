/**
 * 실물 Chrome에서 입력 레벨이 실제로 움직이는지 재는 탐침.
 *
 * 실행: `pnpm dev` 로 5173을 띄운 뒤 `node scripts/probe-audio-level.mjs`
 *
 * ⛔ autoplay-policy 오버라이드를 **주지 않는다.** 브라우저 테스트는
 *    `--autoplay-policy=no-user-gesture-required`로 돌기 때문에, AudioContext가
 *    suspended로 남는 실제 조건을 재현하지 못한다.
 *
 * ⚠️ **측정 결과(2026-08-06): 이 탐침은 사용자가 겪은 결함을 재현하지 못했다.**
 *    고치기 전 구현으로도 meter가 75/26/79로 움직였다. 즉 합성 장치
 *    (`--use-fake-device-for-media-stream`) 경로는 실제 마이크·탭 공유
 *    (`getDisplayMedia`) 경로와 다르다. 실물 확인은 사람이 해야 한다.
 *    이 탐침으로 확인할 수 있는 것은 "회귀가 없다"까지다.
 */

import { chromium } from 'playwright'

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream', // 소리가 나는 합성 마이크
    '--use-fake-ui-for-media-stream',     // 권한 자동 허용
  ],
})
const ctx = await browser.newContext({ permissions: ['microphone'] })
const page = await ctx.newPage()
page.on('console', (m) => console.log('  [console]', m.type(), m.text().slice(0, 120)))
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

await page.goto('http://127.0.0.1:5173/meetings/new')
await page.getByRole('button', { name: '마이크 권한 요청' }).click()
await page.waitForTimeout(600)

console.log('AudioContext 상태(권한 후):', await page.evaluate(async () => {
  const c = new AudioContext()
  const before = c.state
  const r = await Promise.race([c.resume().then(() => 'resolved'), new Promise((s) => setTimeout(() => s('HUNG'), 1500))])
  const out = `${before} → resume: ${r} → ${c.state}`
  await c.close()
  return out
}))

// 사전 level meter가 움직이는가
const meters = []
for (let i = 0; i < 5; i++) {
  meters.push(await page.getAttribute('[data-testid="level-meter-마이크"] [role=meter]', 'aria-valuenow'))
  await page.waitForTimeout(250)
}
console.log('사전 meter aria-valuenow 5회:', meters.join(', '))
console.log('사전 meter data-reading:', await page.getAttribute('[data-testid="level-meter-마이크"]', 'data-reading'))

await page.getByRole('button', { name: /녹음 시작/ }).click()
await page.waitForTimeout(3000)

const levels = []
for (let i = 0; i < 6; i++) {
  levels.push(await page.getAttribute('[data-testid=recording-visualizer]', 'data-level'))
  await page.waitForTimeout(300)
}
console.log('녹음 중 data-level 6회:', levels.join(', '))
console.log('data-active:', await page.getAttribute('[data-testid=recording-visualizer]', 'data-active'))
console.log('data-reading:', await page.getAttribute('[data-testid=recording-visualizer]', 'data-reading'))
console.log('경고 노출:', (await page.content()).includes('입력 레벨을 읽을 수 없습니다'))

await browser.close()
