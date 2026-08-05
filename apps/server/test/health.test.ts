import { describe, expect, it } from 'vitest'
import { app } from '../src/app.ts'

/**
 * 스캐폴드 smoke test.
 *
 * Phase 2(서버 도메인 코어)의 상태 머신·manifest·evidence 무결성 테스트가
 * 여기 붙는다. 지금은 Hono 앱이 뜨고 라우팅이 동작하는지만 확인한다.
 */
describe('server scaffold', () => {
  it('GET /api/health 가 200과 {ok:true}를 반환한다', async () => {
    const res = await app.request('/api/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('없는 경로는 404를 반환한다', async () => {
    const res = await app.request('/api/does-not-exist')

    expect(res.status).toBe(404)
  })
})
