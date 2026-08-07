/**
 * 데이터 폴더를 어디로 잡을 것인가.
 *
 * ⛔ **이 판단을 현재 디렉토리에 맡기지 않는다.** 실제로 겪었다 —
 *    `apps/server`에서 서버를 띄웠더니 데이터 폴더가 `apps/server/.data`로
 *    잡혔고, 그 폴더는 비어 있었다. 화면에는 회의가 **한 건도** 나오지 않았다.
 *    데이터가 지워진 것과 구분되지 않는다. 그게 이 실패의 가장 나쁜 점이다.
 *
 * ⛔ **없는 폴더를 조용히 만들지 않는다.** 경로를 잘못 적었을 때 빈 vault가
 *    생기면, 사용자는 «앱이 내 회의록을 다 날렸다»고 본다. 틀린 경로는
 *    시작 자체를 막고 무엇이 틀렸는지 말해야 한다.
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataRootMissingError, resolveDataRoot } from '../src/data-root.ts'

let root: string
/** 이 파일이 실제로 사는 곳. 저장소 루트를 찾는 출발점이다 */
const HERE = path.join(process.cwd(), 'src')

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-root-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('⛔ 현재 디렉토리에 좌우되지 않는다', () => {
  it('어디서 띄우든 같은 폴더를 가리킨다', () => {
    const fromRepo = resolveDataRoot({}, { from: HERE, cwd: '/' })
    const fromServer = resolveDataRoot({}, { from: HERE, cwd: '/tmp/anywhere' })
    expect(fromRepo).toBe(fromServer)
  })

  it('⛔ apps/server에서 띄워도 apps/server/.data가 아니다 — 실제로 났던 사고다', () => {
    // 서버를 `pnpm --filter server dev`로 띄우면 cwd가 apps/server가 된다.
    // 그때 `./.data`는 빈 폴더를 새로 만들었고, 화면에서 회의가 전부 사라졌다.
    const resolved = resolveDataRoot({}, { from: HERE, cwd: process.cwd() })
    expect(resolved.endsWith(`${path.sep}.data`)).toBe(true)
    expect(resolved).not.toContain(`apps${path.sep}server`)
  })

  it('절대 경로를 돌려준다 — 상대 경로는 읽는 쪽마다 달라진다', () => {
    expect(path.isAbsolute(resolveDataRoot({}, { from: HERE, cwd: '/tmp' }))).toBe(true)
  })
})

describe('환경변수로 지정하면 그것을 쓴다', () => {
  it('있는 폴더를 지정하면 그대로 쓴다', () => {
    expect(
      resolveDataRoot({ RATATOUILLE_DATA_ROOT: root }, { from: HERE, cwd: '/' })
    ).toBe(root)
  })

  it('상대 경로도 현재 디렉토리 기준으로 절대화한다', async () => {
    await mkdir(path.join(root, 'nested'), { recursive: true })
    expect(
      resolveDataRoot({ RATATOUILLE_DATA_ROOT: 'nested' }, { from: HERE, cwd: root })
    ).toBe(path.join(root, 'nested'))
  })

  it('⛔ 없는 폴더를 지정하면 시작하지 않는다 — 빈 vault를 만들지 않는다', () => {
    const missing = path.join(root, '없는폴더')
    expect(() =>
      resolveDataRoot({ RATATOUILLE_DATA_ROOT: missing }, { from: HERE, cwd: '/' })
    ).toThrow(DataRootMissingError)
  })

  it('무엇이 틀렸는지 경로와 함께 말한다', () => {
    const missing = path.join(root, '오타난경로')
    try {
      resolveDataRoot({ RATATOUILLE_DATA_ROOT: missing }, { from: HERE, cwd: '/' })
    } catch (e) {
      // 경로를 안 보여주면 사용자는 어디를 고쳐야 하는지 모른다
      expect((e as Error).message).toContain(missing)
      expect((e as Error).message).toContain('mkdir')
    }
  })

  it('빈 문자열은 지정하지 않은 것으로 친다', () => {
    expect(resolveDataRoot({ RATATOUILLE_DATA_ROOT: '  ' }, { from: HERE, cwd: '/' })).toBe(
      resolveDataRoot({}, { from: HERE, cwd: '/' })
    )
  })
})
