/**
 * Phase 6 결과 화면을 **실제 Chrome + 실제 서버**로 확인한다.
 *
 * 테스트는 서버 대역을 쓴다. 대역은 내가 만든 것이라, 내가 잘못 이해한 계약은
 * 대역에도 똑같이 들어간다. 실제 데이터로 한 번은 봐야 한다.
 *
 * 사용법:
 *   node apps/web/scripts/probe-document-ui.mjs <sourceId>
 */

import { chromium } from 'playwright'

const sourceId = process.argv[2] ?? 'src_msgvfbti'
const base = process.env.WEB_URL ?? 'http://127.0.0.1:5173'

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const requests = []
page.on('request', (r) => {
  if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`)
})

await page.goto(`${base}/meetings/${sourceId}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid=ai-result]', { timeout: 20_000 })

const report = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const sections = [...document.querySelectorAll('[data-section]')].map((el) => ({
    key: el.dataset.section,
    title: el.querySelector('h3')?.textContent,
    marks: el.querySelectorAll('sup button[data-cite]').length,
    rows: el.querySelectorAll('ol > li').length,
    broken: el.querySelectorAll('[data-cite-broken]').length,
  }))
  const notes = q('details[data-section=evidence]')
  return {
    sections,
    tasks: [...document.querySelectorAll('[data-task]')].map(
      (el) => el.querySelectorAll('p')[1]?.textContent
    ),
    decisions: document.querySelectorAll('[data-decision]').length,
    // 마커가 글자로 새어 나오면 안 된다
    rawMarkers: (document.body.textContent ?? '').match(/\[seg_\d+\]/g)?.length ?? 0,
    notesOpen: notes ? notes.open : null,
    notesLabel: notes?.querySelector('summary')?.textContent?.trim(),
    drawerOpen: !!q('[data-testid=transcript-drawer]'),
    hasTextarea: !!q('textarea'),
    hasVideo: !!q('video'),
    stale: (document.body.textContent ?? '').includes('재검토 필요'),
  }
})

console.log('=== section ===')
for (const s of report.sections) {
  console.log(
    `  ${String(s.key).padEnd(10)} ${String(s.title).padEnd(12)} 각주 ${String(s.marks).padStart(3)}  각주란 ${String(s.rows).padStart(3)}  깨짐 ${s.broken}`
  )
}
console.log('\n=== Action Item 담당/기한 ===')
report.tasks.forEach((t) => console.log('  ' + t))

console.log('\n결정 항목:', report.decisions)
console.log('본문에 새어나온 마커(0이어야 함):', report.rawMarkers)
console.log('각주란 접힘(false여야 열림):', report.notesOpen, '|', report.notesLabel)
console.log('전사 서랍 처음부터 열려있나(false여야 함):', report.drawerOpen)
console.log('전사 편집기(확정 후 없어야 함):', report.hasTextarea)
console.log('video 태그(없어야 함):', report.hasVideo)
console.log('재검토 필요 표시:', report.stale)

// 각주를 눌러 실제로 전사가 열리고 그 지점으로 가는지
const mark = page.locator('[data-section=summary] sup button[data-cite]').first()
const label = await mark.getAttribute('aria-label')
const title = await mark.getAttribute('title')
await mark.click()
await page.waitForTimeout(400)
const after = await page.evaluate(() => ({
  t: document.querySelector('audio')?.currentTime ?? null,
  drawer: !!document.querySelector('[data-testid=transcript-drawer]'),
  // ⛔ 서랍 **안**에서 찾는다. 사이드바에도 data-active가 있어서, 범위를
  //    좁히지 않으면 엉뚱한 것을 보고 통과했다고 착각한다.
  active: document
    .querySelector('[data-testid=transcript-drawer] [data-active=true]')
    ?.textContent?.slice(0, 40) ?? null,
}))
console.log(`\n각주 클릭: ${label}`)
console.log(`  hover 인용문: ${title}`)
console.log(`  → audio.currentTime = ${after.t}`)
console.log(`  → 전사 서랍 열림 = ${after.drawer}`)
console.log(`  → 강조된 문장 = ${after.active}`)

console.log('\n=== /api 요청 ===')
console.log('  ' + [...new Set(requests)].join('\n  '))
console.log('\n콘솔 오류:', errors.length ? errors : '없음')

await browser.close()
