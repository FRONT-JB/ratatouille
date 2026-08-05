/**
 * Ratatouille 로컬 데몬
 *
 * 이 서버가 기기 대수와 무관하게 필요한 이유 (GOAL.md `실행 위상` 참조):
 *   1. whisper-cli 네이티브 실행 — 브라우저가 못 함
 *   2. Hermes 호출 (OAuth token 보유)
 *   3. vault/ 원자적 쓰기 + file watcher
 *   4. 브라우저 탭 수명과 무관하게 살아있는 job
 *
 * Phase 1 가정: 127.0.0.1 바인딩. 인증·TLS·공개 도메인은 범위 밖.
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 5174)
const hostname = process.env.HOST ?? '127.0.0.1'

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Ratatouille server → http://${hostname}:${info.port}`)
})

export { app }
