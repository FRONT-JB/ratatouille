/**
 * 로컬 데몬의 조립과 기동.
 *
 * 기동 순서에 의미가 있다.
 *   1. vault 디렉토리 확보
 *   2. 진행 중이던 source 복구 — 재기동 전 업로드를 이어받을 수 있어야 한다
 *   3. 파생 인덱스 확보 — 비어 있으면 vault에서 통째로 다시 만든다
 *   4. watcher 시작 — 즉시 한 번 scan해서, 서버가 꺼져 있는 동안의 편집을 잡는다
 *
 * ⚠️ `app.ts`는 부수 효과가 없어야 하므로 여기서만 실제 자원을 연다.
 */

import * as path from 'node:path'
import { type AppDeps, createApp } from './app.ts'
import { VaultIndex } from './index-db/indexer.ts'
import { RunArtifactStore } from './runs/store.ts'
import { publishSource } from './sources/publish.ts'
import { SourceRepository } from './sources/repository.ts'
import { TranscriptionQueue } from './transcription/queue.ts'
import { TranscriptionRunner } from './transcription/runner.ts'
import { VaultStore } from './vault/store.ts'
import { VaultWatcher } from './vault/watcher.ts'

export type Runtime = {
  vault: VaultStore
  index: VaultIndex
  watcher: VaultWatcher
  sources: SourceRepository
  runs: RunArtifactStore
  transcription: TranscriptionQueue
  app: ReturnType<typeof createApp>
  shutdown: () => Promise<void>
}

export type BootOptions = {
  /** 모든 데이터가 이 아래에 모인다 */
  dataRoot: string
  /** 0이면 주기 scan을 끈다 */
  scanIntervalMs?: number
  /** whisper 모델 경로. 없으면 전사를 시도할 때 실패한다 */
  modelPath?: string
}

export async function boot(opts: BootOptions): Promise<Runtime> {
  const { dataRoot } = opts

  const vault = new VaultStore(path.join(dataRoot, 'vault'))
  await vault.init()

  const sources = new SourceRepository(path.join(dataRoot, 'blobs'))
  const recovered = await sources.load()
  if (recovered.loaded > 0) {
    console.log(`[boot] 진행 중이던 source ${recovered.loaded}건 복구`)
  }
  if (recovered.skipped.length > 0) {
    console.warn(`[boot] 상태 파일이 깨져 건너뜀: ${recovered.skipped.join(', ')}`)
  }

  const runs = new RunArtifactStore(path.join(dataRoot, 'runs'))

  const index = new VaultIndex(path.join(dataRoot, 'index.db'))
  if (index.count() === 0) {
    // 파생 데이터다. 없으면 vault에서 만들면 된다 (9절).
    const r = await index.rebuild(vault)
    console.log(`[boot] 인덱스 재구축 ${r.indexed}건 (건너뜀 ${r.skipped})`)
  }

  const watcher = new VaultWatcher(vault, index, {
    scanIntervalMs: opts.scanIntervalMs ?? 30_000,
  })
  watcher.start()

  const transcription = new TranscriptionQueue({
    runner: new TranscriptionRunner({
      modelPath:
        opts.modelPath ??
        process.env.RATATOUILLE_WHISPER_MODEL ??
        path.join(dataRoot, 'models/ggml-large-v3-turbo.bin'),
    }),
    sources,
    runs,
    workRoot: path.join(dataRoot, 'work'),
    stateRoot: path.join(dataRoot, 'jobs'),
    chunkFilesOf: async (id) => sources.chunkFiles(id),
  })
  const recoveredJobs = await transcription.load()
  if (recoveredJobs > 0) console.log(`[boot] 전사 job ${recoveredJobs}건 복구`)

  const deps: AppDeps = {
    sources,
    publish: (src) => publishSource(src, { vault, runs }),
    transcription,
    runs,
  }

  return {
    vault,
    index,
    watcher,
    sources,
    runs,
    transcription,
    app: createApp(deps),
    shutdown: async () => {
      // watcher가 멈춘 뒤에 닫는다. 순서를 바꾸면 진행 중이던 scan이
      // 닫힌 DB를 건드린다.
      await watcher.stop()
      index.close()
    },
  }
}
