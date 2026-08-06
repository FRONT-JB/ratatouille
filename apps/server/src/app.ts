import { Hono } from 'hono'
import { type PublishFn, sourcesRoutes } from './routes/sources.ts'
import { transcriptionRoutes } from './routes/transcriptions.ts'
import type { RunArtifactStore } from './runs/store.ts'
import type { TranscriptionQueue } from './transcription/queue.ts'
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
  /** ready가 된 source를 vault에 쓴다. 없으면 수집만 하고 발행하지 않는다. */
  publish?: PublishFn
  /** 없으면 전사 API를 열지 않는다 (수집만 하는 테스트용 앱) */
  transcription?: TranscriptionQueue
  /** 전사 원문 조회에 필요하다 */
  runs?: RunArtifactStore
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/sources', sourcesRoutes(deps.sources, deps.publish))
  if (deps.transcription) {
    app.route('/api', transcriptionRoutes(deps.sources, deps.transcription, deps.runs))
  }

  return app
}

/**
 * 기본 인스턴스 — vault 없이 수집만 한다.
 *
 * 실제 데몬은 `runtime.ts`의 `boot()`이 만든 앱을 쓴다. 이쪽은 vault·인덱스를
 * 열지 않아 import만으로 파일을 만들지 않으므로, 테스트가 안전하게 쓸 수 있다.
 */
export const app = createApp({
  sources: new SourceRepository(
    process.env.RATATOUILLE_BLOB_ROOT ?? './.data/blobs'
  ),
})
