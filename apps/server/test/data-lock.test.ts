/**
 * 한 데이터 폴더에 서버 한 대.
 *
 * ⛔ **두 대가 같은 폴더를 쓰면 상태 파일이 서로를 지운다.** 실제로 났다 —
 *    `rename '.../run.state.json.37052.tmp'` ENOENT로 한쪽 서버가 죽었다.
 *    한쪽이 쓴 임시 파일을 다른 쪽이 치우는 사이에 rename이 실패한 것이다.
 *    지금은 죽는 것으로 끝났지만, 반쯤 쓰인 상태가 남으면 복구가 어렵다.
 *
 * ⛔ **죽은 자물쇠는 이어받는다.** 서버가 kill -9로 죽으면 자물쇠가 남는데,
 *    그것 때문에 다시 못 뜨면 사용자는 파일을 손으로 지워야 한다.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataRootLockedError, acquireDataLock } from '../src/data-lock.ts'

let root: string
const LOCK = 'server.lock'

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-lock-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 살아 있다고 우기는 판정기 */
const alive = () => true
const dead = () => false

describe('자물쇠를 건다', () => {
  it('처음이면 잠긴다', async () => {
    await acquireDataLock(root, { pid: 100, isAlive: alive })
    expect(existsSync(path.join(root, LOCK))).toBe(true)
  })

  it('누가 쥐고 있는지 남긴다 — 무엇을 끄면 되는지 알아야 한다', async () => {
    await acquireDataLock(root, { pid: 4242, isAlive: alive })
    const raw = JSON.parse(await readFile(path.join(root, LOCK), 'utf8'))
    expect(raw.pid).toBe(4242)
  })

  it('놓으면 자물쇠가 사라진다', async () => {
    const release = await acquireDataLock(root, { pid: 100, isAlive: alive })
    await release()
    expect(existsSync(path.join(root, LOCK))).toBe(false)
  })
})

describe('⛔ 두 대가 같은 폴더를 쓰지 못한다', () => {
  it('살아 있는 서버가 있으면 거절한다', async () => {
    await acquireDataLock(root, { pid: 100, isAlive: alive })
    await expect(
      acquireDataLock(root, { pid: 200, isAlive: alive })
    ).rejects.toThrow(DataRootLockedError)
  })

  it('무엇을 끄면 되는지 pid와 경로로 말한다', async () => {
    await acquireDataLock(root, { pid: 4242, isAlive: alive })
    try {
      await acquireDataLock(root, { pid: 200, isAlive: alive })
    } catch (e) {
      expect((e as Error).message).toContain('4242')
      expect((e as Error).message).toContain(root)
    }
  })

  it('⛔ 자기 자신은 막지 않는다 — 재시작이 자기 자물쇠에 걸리면 안 된다', async () => {
    await acquireDataLock(root, { pid: 100, isAlive: alive })
    await expect(
      acquireDataLock(root, { pid: 100, isAlive: alive })
    ).resolves.toBeTypeOf('function')
  })
})

describe('⛔ 죽은 자물쇠는 이어받는다', () => {
  it('쥐고 있던 프로세스가 죽었으면 잠근다', async () => {
    await acquireDataLock(root, { pid: 100, isAlive: alive })
    await expect(
      acquireDataLock(root, { pid: 200, isAlive: dead })
    ).resolves.toBeTypeOf('function')
  })

  it('이어받으면 새 주인이 적힌다', async () => {
    await acquireDataLock(root, { pid: 100, isAlive: alive })
    await acquireDataLock(root, { pid: 200, isAlive: dead })
    const raw = JSON.parse(await readFile(path.join(root, LOCK), 'utf8'))
    expect(raw.pid).toBe(200)
  })

  it('⛔ 늦게 도착한 정리가 새 주인의 자물쇠를 풀지 않는다', async () => {
    // 죽은 줄 알고 이어받았는데, 옛 서버가 뒤늦게 종료 정리를 돌리는 경우다.
    // 여기서 파일을 지우면 그 뒤로는 아무나 들어올 수 있게 된다.
    const releaseOld = await acquireDataLock(root, { pid: 100, isAlive: alive })
    await acquireDataLock(root, { pid: 200, isAlive: dead })
    await releaseOld()

    expect(existsSync(path.join(root, LOCK))).toBe(true)
    const raw = JSON.parse(await readFile(path.join(root, LOCK), 'utf8'))
    expect(raw.pid).toBe(200)
  })

  it('깨진 자물쇠 파일도 이어받는다 — 그것 때문에 못 뜨면 안 된다', async () => {
    await writeFile(path.join(root, LOCK), '이건 JSON이 아니다', 'utf8')
    await expect(
      acquireDataLock(root, { pid: 200, isAlive: alive })
    ).resolves.toBeTypeOf('function')
  })
})
