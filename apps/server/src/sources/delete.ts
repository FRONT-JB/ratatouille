/**
 * 회의 삭제 — **소거가 아니라 휴지통 이동**.
 *
 * ⛔ 왜 완전히 지우지 않는가: raw audio와 source hash는 불변이고
 *    (technical-foundation 5절) 되돌릴 수단이 없다. 오조작 한 번으로 51분짜리
 *    녹음을 영영 잃게 두지 않는다. 대신 **어디로 옮겼는지를 응답에 반드시
 *    적는다** — 모르면 되찾을 수 없고, "지웠다"는 말이 반쪽 거짓이 된다.
 *
 * ⛔ 한 source에 딸린 것을 **전부** 옮긴다. 조각만 옮기고 vault 문서나 전사
 *    원문을 남기면, 목록에서는 사라졌는데 디스크에는 살아 있는 유령이 된다.
 *
 * ⚠️ 휴지통을 자동으로 비우지 않는다. 언제 진짜로 사라지는지는 사용자가
 *    정한다. 대신 화면과 응답이 휴지통의 존재를 숨기지 않는다.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { RunArtifactStore } from '../runs/store.ts'
import type { TranscriptionQueue } from '../transcription/queue.ts'
import type { VaultStore } from '../vault/store.ts'
import { meetingNotePath } from '../documents/markdown.ts'
import { sourceVaultPath } from './publish.ts'
import { SourceNotFoundError, type SourceRepository } from './repository.ts'

export class SourceBusyError extends Error {
  constructor(readonly sourceId: string) {
    super(
      `${sourceId}는 지금 전사 중이라 삭제할 수 없습니다. 전사가 끝난 뒤 다시 시도해 주세요.`
    )
    this.name = 'SourceBusyError'
  }
}

export type DeleteDeps = {
  sources: SourceRepository
  transcription?: TranscriptionQueue
  runs?: RunArtifactStore
  vault?: VaultStore
  /**
   * 재생용 오디오 캐시. 있으면 함께 버린다.
   *
   * ⚠️ 휴지통으로 옮기지 않고 **버린다.** 조각에서 다시 만들 수 있는
   *    파생물이라 잃는 것이 없다. 남겨두면 지운 회의의 소리가 계속 재생된다.
   */
  audio?: { invalidate: (sourceId: string) => Promise<void> }
  /**
   * 전사 교정본.
   *
   * ⛔ 함께 치우지 않으면 회의를 지운 뒤 같은 id로 새로 녹음했을 때 **옛 교정
   *    내용이 새 회의에 붙는다.** 사람이 고친 문장이라 휴지통으로 옮긴다.
   */
  revisions?: {
    forget: (sourceId: string) => boolean
    stateDirOf: (sourceId: string) => string
  }
  /**
   * AI 정리 실행.
   *
   * ⛔ 함께 치우지 않으면 **목록에서는 사라졌는데 검수 화면에서는 살아 있는**
   *    유령이 된다. 같은 id로 새 회의를 만들면 「최신 정리」가 지운 회의의
   *    결정과 할 일을 돌려준다. 사람이 검수한 내용이라 휴지통으로 옮긴다.
   */
  documents?: {
    listFor: (sourceId: string) => readonly { id: string }[]
    stateDirOf: (runId: string) => string
    forget: (runId: string) => boolean
  }
  /** 옮겨 둘 곳. 없으면 삭제 자체를 열지 않는다 */
  trashRoot: string
  /** 휴지통 폴더 이름에 붙일 시각. 테스트에서 고정할 수 있게 주입한다 */
  now?: () => Date
}

export type DeleteResult = {
  sourceId: string
  /** 되찾을 수 있는 자리. 응답에 그대로 실어 사용자에게 알린다 */
  trashPath: string
  /** 실제로 옮겨진 것들. 없던 것은 여기 나오지 않는다 */
  moved: string[]
}

/** 파일명에 쓸 수 있는 시각. 콜론은 경로에서 다루기 번거롭다. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

/**
 * 옮긴다. 없으면 조용히 넘어간다 — 지울 것이 없는 것은 실패가 아니다.
 *
 * ⚠️ `rename`이 EXDEV(다른 파일시스템)로 실패하면 복사 후 삭제로 떨어진다.
 *    데이터 루트와 휴지통이 같은 볼륨이면 rename 한 번으로 끝난다.
 */
async function move(from: string, to: string): Promise<boolean> {
  try {
    await fs.access(from)
  } catch {
    return false
  }
  await fs.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await fs.cp(from, to, { recursive: true })
    await fs.rm(from, { recursive: true, force: true })
  }
  return true
}

export async function deleteSource(
  sourceId: string,
  deps: DeleteDeps
): Promise<DeleteResult> {
  // 없는 것을 지웠다고 하지 않는다 — 없으면 여기서 SourceNotFoundError가 난다
  deps.sources.get(sourceId)

  const jobs = deps.transcription?.listFor(sourceId) ?? []
  const docRuns = deps.documents?.listFor(sourceId) ?? []
  // ⛔ 돌고 있는 전사가 읽는 중인 조각을 치우면, 전사는 알 수 없는 이유로
  //    깨지고 사용자는 원인을 모른다. 끝나기를 기다리게 한다.
  if (deps.transcription?.isRunning(sourceId)) {
    throw new SourceBusyError(sourceId)
  }

  const dir = path.join(deps.trashRoot, `${sourceId}__${stamp((deps.now ?? (() => new Date()))())}`)
  const moved: string[] = []

  const blobRoot = deps.sources.rootOf(sourceId)
  if (await move(blobRoot, path.join(dir, 'blobs'))) moved.push('blobs')

  if (deps.vault) {
    /*
     * ⛔ **이 회의에 딸린 vault 문서를 전부 옮긴다.** 한동안 `sources/`만
     *    옮기고 있었다 — 회의록(`notes/`)이 남아 지운 회의가 계속 검색에
     *    잡혔다. 결정 사항까지 생기면서 남는 것이 셋이 될 참이었다.
     */
    for (const rel of [sourceVaultPath(sourceId), meetingNotePath(sourceId)]) {
      if (await move(path.join(deps.vault.root, rel), path.join(dir, 'vault', rel))) {
        moved.push('vault')
      }
    }
    for (const rel of await deps.vault.listMarkdown('decisions')) {
      const doc = await deps.vault.read(rel)
      if (doc?.frontmatter.source_id !== sourceId) continue
      if (await move(path.join(deps.vault.root, rel), path.join(dir, 'vault', rel))) {
        moved.push('vault')
      }
    }
  }

  if (deps.runs) {
    if (
      await move(
        deps.runs.pathOf(path.join('sources', sourceId)),
        path.join(dir, 'runs/sources', sourceId)
      )
    ) {
      moved.push('runs/sources')
    }
    for (const job of jobs) {
      if (
        await move(
          deps.runs.pathOf(path.join('transcriptions', job.id)),
          path.join(dir, 'runs/transcriptions', job.id)
        )
      ) {
        moved.push('runs/transcriptions')
      }
    }
    for (const run of docRuns) {
      if (
        await move(
          deps.runs.pathOf(path.join('documentation-runs', run.id)),
          path.join(dir, 'runs/documentation-runs', run.id)
        )
      ) {
        moved.push('runs/documentation-runs')
      }
    }
  }

  for (const job of jobs) {
    if (
      await move(
        deps.transcription!.stateDirOf(job.id),
        path.join(dir, 'jobs', job.id)
      )
    ) {
      moved.push('jobs')
    }
  }

  if (deps.revisions) {
    if (
      await move(
        deps.revisions.stateDirOf(sourceId),
        path.join(dir, 'revisions', sourceId)
      )
    ) {
      moved.push('revisions')
    }
  }

  for (const run of docRuns) {
    if (
      await move(deps.documents!.stateDirOf(run.id), path.join(dir, 'documents', run.id))
    ) {
      moved.push('documents')
    }
  }

  await deps.audio?.invalidate(sourceId).catch(() => undefined)

  // ⛔ 디스크를 옮긴 **뒤에** 메모리에서 지운다. 순서를 바꾸면 중간에 죽었을 때
  //    파일은 남았는데 아무도 그 존재를 모르는 상태가 된다.
  deps.sources.forget(sourceId)
  deps.revisions?.forget(sourceId)
  for (const job of jobs) deps.transcription?.forget(job.id)
  for (const run of docRuns) deps.documents?.forget(run.id)

  // 파생 인덱스는 vault를 따라간다 — watcher가 파일이 사라진 것을 보고 지운다.
  // 여기서 직접 건드리지 않는다(9절: SQLite는 파생물이다).

  return { sourceId, trashPath: dir, moved: [...new Set(moved)] }
}

export { SourceNotFoundError }
