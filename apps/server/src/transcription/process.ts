/**
 * 외부 프로세스 실행.
 *
 * `Transcriber`가 이걸 주입받는다. 분리해 두면 명령 구성과 출력 파싱을
 * 실제 whisper 실행 없이 검증할 수 있고, 실행 자체는 별도 통합 테스트로 잰다.
 *
 * ⛔ `shell: true`를 쓰지 않는다. 파일 경로에 공백이나 따옴표가 들어가면
 *    (한국어 파일명에서 흔하다) 명령이 통째로 깨지거나 의도치 않은 것이 실행된다.
 */

import { spawn } from 'node:child_process'

export type ProcessResult = { code: number; stdout: string; stderr: string }

export class ProcessTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly timeoutMs: number
  ) {
    super(`${command}이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 중단했다.`)
    this.name = 'ProcessTimeoutError'
  }
}

export async function spawnProcess(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<ProcessResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // SIGTERM으로 먼저 부탁하고, 안 죽으면 SIGKILL.
      // whisper는 모델을 물고 있어 즉시 안 죽을 수 있다.
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
      reject(new ProcessTimeoutError(command, timeoutMs))
    }, timeoutMs)
    timer.unref()

    child.stdout?.on('data', (d) => {
      stdout += d
    })
    child.stderr?.on('data', (d) => {
      stderr += d
    })

    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 실행 파일이 없는 경우가 대부분이다. 무엇이 없는지 밝힌다.
      reject(
        new Error(
          `${command}을 실행할 수 없다: ${e.message}. 설치되어 있고 PATH에 있는지 확인한다.`
        )
      )
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
