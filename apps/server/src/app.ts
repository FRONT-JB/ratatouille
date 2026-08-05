import { Hono } from 'hono'
import { sourcesRoutes } from './routes/sources.ts'
import { SourceRepository } from './sources/repository.ts'

/**
 * Ratatouille 로컬 데몬의 Hono 앱.
 *
 * ⚠️ 이 파일은 **부수 효과가 없어야 한다.** 서버를 실제로 띄우는 것은
 *    `index.ts`의 책임이다. import만으로 포트를 잡으면 테스트가 서로
 *    충돌하고 병렬 실행이 불가능해진다.
 */

export type AppDeps = {
  sources: SourceRepository
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/sources', sourcesRoutes(deps.sources))

  return app
}

/** 기본 인스턴스. 테스트는 createApp으로 격리된 저장소를 주입한다. */
export const app = createApp({
  sources: new SourceRepository(
    process.env.RATATOUILLE_BLOB_ROOT ?? './.data/blobs'
  ),
})
