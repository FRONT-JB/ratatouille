import { Hono } from 'hono'

/**
 * Ratatouille 로컬 데몬의 Hono 앱.
 *
 * ⚠️ 이 파일은 **부수 효과가 없어야 한다.** 서버를 실제로 띄우는 것은
 *    `index.ts`의 책임이다. import만으로 포트를 잡으면 테스트가 서로
 *    충돌하고 병렬 실행이 불가능해진다.
 */
export const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))
