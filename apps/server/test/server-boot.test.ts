import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ⛔ **서버가 실제로 뜨는지** 확인한다.
 *
 * 이 파일이 없어서 놓친 결함: 테스트 618건·build·typecheck·lint가 전부
 * 통과하는데 `node src/index.ts`가 죽었다. vitest는 esbuild로 TypeScript를
 * **완전 변환**하지만, Node의 기본 type-stripping은 `constructor(readonly x: T)`
 * 같은 parameter property를 지원하지 않기 때문이다.
 *
 * 다른 테스트는 전부 `createApp`/`boot`를 **import해서** 부르므로 이 차이를
 * 볼 수 없다. 진짜 진입점을 프로세스로 띄우는 테스트만 잡을 수 있다.
 */

const SERVER_DIR = path.resolve(import.meta.dirname, '..')

let dataRoot: string
let child: ReturnType<typeof spawn> | null = null

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), 'rat-boot-e2e-'))
})

afterEach(async () => {
  child?.kill('SIGKILL')
  child = null
  await rm(dataRoot, { recursive: true, force: true })
})

/** package.json의 `start` 스크립트와 **같은 방식으로** 띄운다. */
function startServer(port: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // package.json의 start와 어긋나면 이 테스트가 의미를 잃는다.
    child = spawn(
      process.execPath,
      ['--experimental-transform-types', 'src/index.ts'],
      {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          PORT: String(port),
          RATATOUILLE_DATA_ROOT: dataRoot,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      reject(
        new Error(
          `서버가 15초 안에 뜨지 않았다.\nstdout: ${stdout}\nstderr: ${stderr}`
        )
      )
    }, 15_000)

    child.stdout?.on('data', (d) => {
      stdout += d
      if (stdout.includes('Ratatouille server')) {
        clearTimeout(timer)
        resolve({ stdout, stderr })
      }
    })
    child.stderr?.on('data', (d) => {
      stderr += d
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(
        new Error(`서버가 뜨지 못하고 종료했다 (code ${code}).\n${stderr || stdout}`)
      )
    })
  })
}

describe('⛔ 진입점이 실제로 실행된다', () => {
  it('node로 src/index.ts를 띄우면 서버가 뜬다', async () => {
    const { stdout } = await startServer(5311)
    expect(stdout).toContain('Ratatouille server')
  }, 30_000)

  it('띄운 서버가 요청에 답한다', async () => {
    await startServer(5312)
    const res = await fetch('http://127.0.0.1:5312/api/health')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  }, 30_000)

  it('세션 API가 붙어 있다 — 라우트 배선이 실제로 산다', async () => {
    await startServer(5313)
    const res = await fetch('http://127.0.0.1:5313/api/session')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sources: [], inProgress: [] })
  }, 30_000)

  it('vault 디렉토리를 만든다', async () => {
    await startServer(5314)
    const { existsSync } = await import('node:fs')
    expect(existsSync(path.join(dataRoot, 'vault/sources'))).toBe(true)
  }, 30_000)
})
