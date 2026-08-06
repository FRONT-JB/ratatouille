import { Hono } from 'hono'
import type { AudioPublisher } from './audio/publisher.ts'
import type { RevisionStore } from './revisions/store.ts'
import type { DocumentQueue } from './documents/queue.ts'
import type { DecisionStore } from './decisions/store.ts'
import { audioRoutes } from './routes/audio.ts'
import { decisionRoutes } from './routes/decisions.ts'
import { documentRoutes } from './routes/documents.ts'
import { revisionRoutes } from './routes/revisions.ts'
import { type PublishFn, sourcesRoutes } from './routes/sources.ts'
import { transcriptionRoutes } from './routes/transcriptions.ts'
import type { RunArtifactStore } from './runs/store.ts'
import type { TranscriptionQueue } from './transcription/queue.ts'
import { SourceRepository } from './sources/repository.ts'
import type { VaultStore } from './vault/store.ts'

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
  /**
   * 지운 회의를 옮겨 둘 곳.
   *
   * ⛔ **없으면 삭제 API 자체가 열리지 않는다.** 휴지통 자리를 모르는 앱이
   *    지우기 시작하면 그건 소거이고, raw audio는 되돌릴 수 없다(5절).
   */
  trashRoot?: string
  /** 삭제 시 vault 문서까지 함께 옮기려면 필요하다 */
  vault?: VaultStore
  /** 없으면 재생 경로를 열지 않는다 (수집만 하는 테스트용 앱) */
  audio?: AudioPublisher
  /** 없으면 전사 교정 경로를 열지 않는다 */
  revisions?: RevisionStore
  /** 없으면 AI 정리 경로를 열지 않는다 */
  documents?: DocumentQueue
  /** 없으면 결정 사항 경로를 열지 않는다 (vault가 있어야 만들 수 있다) */
  decisions?: DecisionStore
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route(
    '/api/sources',
    sourcesRoutes(
      deps.sources,
      deps.publish,
      deps.trashRoot
        ? {
            sources: deps.sources,
            transcription: deps.transcription,
            runs: deps.runs,
            vault: deps.vault,
            audio: deps.audio,
            revisions: deps.revisions,
            trashRoot: deps.trashRoot,
          }
        : undefined
    )
  )
  if (deps.audio) {
    app.route('/api/sources', audioRoutes(deps.sources, deps.audio))
  }
  if (deps.revisions && deps.transcription && deps.runs) {
    app.route(
      '/api/sources',
      revisionRoutes(deps.sources, deps.transcription, deps.revisions, deps.runs)
    )
  }
  if (deps.documents) {
    app.route('/api/sources', documentRoutes(deps.documents))
  }
  if (deps.decisions) {
    app.route('/api/sources', decisionRoutes(deps.decisions))
  }
  if (deps.transcription) {
    app.route(
      '/api',
      transcriptionRoutes(
        deps.sources,
        deps.transcription,
        deps.runs,
        deps.revisions,
        deps.documents
      )
    )
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
