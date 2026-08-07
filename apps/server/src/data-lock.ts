/**
 * 한 데이터 폴더에 서버 한 대.
 *
 * ⛔ **두 대가 같은 폴더를 쓰면 상태 파일이 서로를 지운다.** 실제로 났다 —
 *    `rename '.../run.state.json.<pid>.tmp'`가 ENOENT로 실패해 한쪽 서버가
 *    죽었다. 상태 저장은 «임시 파일에 쓰고 rename»인데, 한쪽이 쓴 임시 파일을
 *    다른 쪽이 치우는 사이에 rename 대상이 사라진 것이다.
 *
 * 지금은 죽는 것으로 끝났지만, 이 경합은 반쯤 쓰인 상태를 남길 수 있다.
 * 회의 기록은 다시 만들 수 없으므로 **애초에 두 대가 뜨지 못하게** 한다.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export class DataRootLockedError extends Error {
  constructor(
    readonly pid: number,
    readonly dataRoot: string
  ) {
    super(
      `이미 다른 서버가 이 데이터 폴더를 쓰고 있습니다 (pid ${pid})\n` +
        `  폴더: ${dataRoot}\n` +
        `  두 대가 같은 폴더를 쓰면 회의 기록이 깨집니다.\n` +
        `  그 서버를 끄려면: kill ${pid}`
    )
    this.name = 'DataRootLockedError'
  }
}

const LOCK_FILE = 'server.lock'

/** 그 프로세스가 아직 살아 있나. 신호 0은 죽이지 않고 존재만 묻는다 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export type LockOptions = {
  pid?: number
  isAlive?: (pid: number) => boolean
}

/**
 * 자물쇠를 걸고, 푸는 함수를 돌려준다.
 *
 * ⛔ **죽은 자물쇠는 이어받는다.** `kill -9`로 죽으면 파일이 남는데, 그것 때문에
 *    다시 못 뜨면 사용자가 파일을 손으로 지워야 한다. 그건 도구가 할 일이다.
 */
export async function acquireDataLock(
  dataRoot: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const pid = options.pid ?? process.pid
  const isAlive = options.isAlive ?? processAlive
  const lockPath = path.join(dataRoot, LOCK_FILE)

  const holder = await readHolder(lockPath)
  // 자기 자물쇠는 막지 않는다 — 재시작이 자기 것에 걸리면 안 된다
  if (holder !== null && holder !== pid && isAlive(holder)) {
    throw new DataRootLockedError(holder, dataRoot)
  }

  await fs.mkdir(dataRoot, { recursive: true })
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid, at: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  )

  return async () => {
    // 남의 자물쇠를 풀지 않는다 — 이어받힌 뒤 늦게 도착한 정리일 수 있다
    if ((await readHolder(lockPath)) === pid) {
      await fs.rm(lockPath, { force: true })
    }
  }
}

/** 자물쇠를 쥔 pid. 없거나 읽을 수 없으면 `null` */
async function readHolder(lockPath: string): Promise<number | null> {
  try {
    const raw = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { pid?: unknown }
    return typeof raw.pid === 'number' ? raw.pid : null
  } catch {
    // ⛔ 깨진 파일 때문에 서버가 못 뜨면 안 된다. 주인 없는 것으로 친다.
    return null
  }
}
