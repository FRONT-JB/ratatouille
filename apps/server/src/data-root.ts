/**
 * 데이터 폴더가 어디인가.
 *
 * ⛔ **현재 디렉토리에 맡기지 않는다.** `apps/server`에서 서버를 띄웠더니
 *    `./.data`가 `apps/server/.data`로 잡혔고, 그 폴더는 비어 있었다.
 *    화면에는 회의가 한 건도 나오지 않았고, **데이터가 지워진 것과 구분되지
 *    않았다.** 실제로 그렇게 «회의록이 다 날아갔다»고 판단할 뻔했다.
 *
 * 그래서 기본값은 **이 파일의 위치**에서 저장소 루트를 거슬러 찾는다.
 * 어느 디렉토리에서 띄우든 같은 곳을 가리킨다.
 */

import { existsSync } from 'node:fs'
import * as path from 'node:path'

export class DataRootMissingError extends Error {
  constructor(readonly dataRoot: string) {
    super(
      `데이터 폴더가 없습니다: ${dataRoot}\n` +
        `  경로를 잘못 적었는지 확인하세요. 회의 기록은 지정한 폴더에만 있습니다.\n` +
        `  정말 새로 시작하는 것이라면: mkdir -p ${dataRoot}`
    )
    this.name = 'DataRootMissingError'
  }
}

/** 저장소 루트를 알아보는 표식. 여기 있으면 루트다 */
const ROOT_MARKER = 'pnpm-workspace.yaml'

export type ResolveOptions = {
  /** 어디서부터 루트를 찾을지. 기본은 이 파일이 있는 곳 */
  from?: string
  /** 상대 경로를 절대화할 기준 */
  cwd?: string
}

/**
 * 쓸 데이터 폴더의 **절대** 경로.
 *
 * ⛔ **없는 폴더를 만들어 주지 않는다**(환경변수로 지정한 경우). 경로 오타로
 *    빈 vault가 생기면 사용자는 앱이 기록을 날렸다고 본다. 틀린 경로는 시작을
 *    막고 무엇이 틀렸는지 말하는 편이 낫다.
 */
export function resolveDataRoot(
  env: { RATATOUILLE_DATA_ROOT?: string } = process.env,
  options: ResolveOptions = {}
): string {
  const cwd = options.cwd ?? process.cwd()
  const explicit = env.RATATOUILLE_DATA_ROOT?.trim()

  if (explicit) {
    const resolved = path.resolve(cwd, explicit)
    if (!existsSync(resolved)) throw new DataRootMissingError(resolved)
    return resolved
  }

  return path.join(repoRootFrom(options.from ?? here()), '.data')
}

/** 이 모듈이 사는 디렉토리 */
function here(): string {
  return import.meta.dirname
}

/**
 * 표식을 만날 때까지 거슬러 올라간다.
 *
 * 못 찾으면 출발점을 그대로 쓴다 — 번들되어 표식이 없는 곳에 놓일 수도 있고,
 * 그때 예외로 죽는 것보다 예측 가능한 자리에 두는 편이 낫다.
 */
function repoRootFrom(start: string): string {
  let dir = path.resolve(start)
  while (true) {
    if (existsSync(path.join(dir, ROOT_MARKER))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}
