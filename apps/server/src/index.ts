/**
 * Ratatouille 로컬 데몬 진입점.
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
import { DataRootLockedError, acquireDataLock } from './data-lock.ts'
import { DataRootMissingError, resolveDataRoot } from './data-root.ts'
import { boot } from './runtime.ts'

const port = Number(process.env.PORT ?? 5174)
const hostname = process.env.HOST ?? '127.0.0.1'

/*
 * ⛔ **데이터 폴더를 현재 디렉토리로 정하지 않는다.** `apps/server`에서 띄우면
 *    `./.data`가 `apps/server/.data`가 되고, 빈 폴더가 새로 생기고, 화면에서
 *    회의가 **전부 사라진다.** 데이터가 지워진 것과 구분되지 않는다.
 */
let dataRoot: string
try {
  dataRoot = resolveDataRoot()
} catch (e) {
  if (e instanceof DataRootMissingError) {
    console.error(`\n${e.message}\n`)
    process.exit(1)
  }
  throw e
}

/*
 * ⛔ **한 폴더에 서버 한 대.** 두 대가 같은 폴더를 쓰다가 상태 파일 rename이
 *    ENOENT로 깨져 한쪽이 죽었다. 회의 기록은 다시 만들 수 없다.
 */
let releaseLock: () => Promise<void>
try {
  releaseLock = await acquireDataLock(dataRoot)
} catch (e) {
  if (e instanceof DataRootLockedError) {
    console.error(`\n${e.message}\n`)
    process.exit(1)
  }
  throw e
}

const runtime = await boot({ dataRoot })

const server = serve({ fetch: runtime.app.fetch, port, hostname }, (info) => {
  console.log(`Ratatouille server → http://${hostname}:${info.port}`)
  // ⛔ 어느 폴더를 보고 있는지 먼저 보여준다. 목록이 비었을 때 제일 먼저
  //    확인해야 하는 값이고, 안 보이면 데이터가 날아간 줄 안다.
  console.log(`  데이터  ${dataRoot}`)
  console.log(`  vault  ${runtime.vault.root}`)
  console.log(`  인덱스 ${runtime.index.count()}건`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    // watcher와 SQLite를 정리한다. 안 하면 WAL이 남는다.
    // 자물쇠도 푼다 — 안 풀면 다음 서버가 못 뜬다.
    void runtime
      .shutdown()
      .then(releaseLock)
      .then(() => server.close(() => process.exit(0)))
  })
}
