/**
 * 전사 job 큐 — PLAN.md 순서 3의 "브라우저 탭 수명과 무관한 job".
 *
 * ⛔ **브라우저가 닫혀도 계속 돈다.** 그게 로컬 데몬이 필요한 이유 중 하나다
 *    (GOAL.md `실행 위상`). 그래서 job 상태는 메모리가 아니라 디스크에 남고,
 *    서버가 재기동되면 되살아난다.
 *
 * ⛔ **`ready` 이전 source로는 job을 만들지 못한다** (technical-foundation 5절).
 *    이 검사를 큐 진입점에 둔다 — 화면에서만 막으면 다른 경로로 새어 들어온다.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  type CaptureMode,
  type TranscriptionJobState,
  transition,
} from '@ratatouille/contracts'
import type { RunArtifactStore } from '../runs/store.ts'
import type { SourceRepository } from '../sources/repository.ts'
import { TranscriptionFailed, type TranscriptionRunner } from './runner.ts'

/** job 하나의 수명 상태. 실행 자체는 `TranscriptionRunner`가 한다. */
export type TranscriptionJob = {
  id: string
  sourceId: string
  state: TranscriptionJobState
  attempt: number
  error: string | null
  /**
   * 다시 시도해서 결과가 달라질 수 있는가.
   *
   * ⛔ 상태와 **따로** 둔다. `transcriptionJob` 머신에는 실패 상태가
   *    `failed_retryable` 하나뿐이라(5절) 영구 실패를 상태로 표현할 수 없다.
   *    화면은 이 값이 false일 때 재시도 버튼을 내지 않는다.
   */
  retryable: boolean
  warning: string | null
  audioMs: number | null
  elapsedMs: number | null
  segmentCount: number | null
}

const STATE_FILE = 'job.state.json'

export class SourceNotReadyError extends Error {
  constructor(readonly sourceId: string, readonly state: string) {
    super(
      `${sourceId}는 아직 ready가 아니다 (현재 ${state}). 조각이 모두 확인되기 전에는 전사할 수 없다.`
    )
    this.name = 'SourceNotReadyError'
  }
}

export type QueueDeps = {
  runner: TranscriptionRunner
  sources: SourceRepository
  runs: RunArtifactStore
  /** 중간 산출물을 놓을 곳. 전사가 끝나면 지운다 */
  workRoot: string
  /** job 상태를 남길 곳 */
  stateRoot: string
  /** source의 조각 파일 경로를 track별·순번순으로 준다 */
  chunkFilesOf: (sourceId: string) => Promise<Partial<Record<'mic' | 'remote', string[]>>>
  newJobId?: (sourceId: string, attempt: number) => string
}

export class TranscriptionQueue {
  private readonly jobs = new Map<string, TranscriptionJob>()
  /** 진행 중인 실행. 같은 source를 두 번 돌리지 않는다. */
  private readonly running = new Map<string, Promise<TranscriptionJob>>()

  constructor(private readonly deps: QueueDeps) {}

  /** 서버 기동 시 디스크에서 job을 되살린다. */
  async load(): Promise<number> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.deps.stateRoot)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw e
    }

    let loaded = 0
    for (const id of entries) {
      try {
        const raw = await fs.readFile(
          path.join(this.deps.stateRoot, id, STATE_FILE),
          'utf8'
        )
        const job = JSON.parse(raw) as TranscriptionJob
        // ⛔ 재기동 시점에 `transcribing`이던 job은 실제로는 죽어 있다.
        //    그대로 두면 화면이 영원히 "전사 중"을 보여준다.
        if (job.state === 'transcribing') {
          job.state = 'failed_retryable'
          job.retryable = true
          job.error = '서버가 재시작되어 전사가 중단되었습니다. 다시 시도해 주세요.'
        }
        this.jobs.set(job.id, job)
        loaded++
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue
      }
    }
    return loaded
  }

  private async persist(job: TranscriptionJob): Promise<void> {
    const dir = path.join(this.deps.stateRoot, job.id)
    await fs.mkdir(dir, { recursive: true })
    const full = path.join(dir, STATE_FILE)
    const tmp = `${full}.${process.pid}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(job, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, full)
  }

  get(jobId: string): TranscriptionJob | null {
    return this.jobs.get(jobId) ?? null
  }

  list(): TranscriptionJob[] {
    return [...this.jobs.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 이 source에 딸린 job 전부 */
  listFor(sourceId: string): TranscriptionJob[] {
    return this.list().filter((j) => j.sourceId === sourceId)
  }

  /** 이 source의 가장 최근 job */
  latestFor(sourceId: string): TranscriptionJob | null {
    return this.listFor(sourceId).at(-1) ?? null
  }

  /** 지금 실제로 whisper가 돌고 있는가. 삭제를 막는 판단에 쓴다. */
  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId)
  }

  /** job 상태 파일이 있는 디렉토리. 삭제가 옮길 대상이다. */
  stateDirOf(jobId: string): string {
    return path.join(this.deps.stateRoot, jobId)
  }

  /** 메모리에서 잊는다. 디스크는 호출부가 먼저 치운다 (`sources/delete.ts`). */
  forget(jobId: string): boolean {
    return this.jobs.delete(jobId)
  }

  /**
   * 전사를 시작한다.
   *
   * 같은 source가 이미 돌고 있으면 그 실행을 그대로 돌려준다 — 중복 실행이
   * 같은 조각을 두 번 전사하고 서로 다른 결과를 남기는 것을 막는다.
   */
  async enqueue(
    sourceId: string,
    opts: { vocabulary?: string[] } = {}
  ): Promise<TranscriptionJob> {
    const src = this.deps.sources.get(sourceId)
    if (src.state !== 'ready') {
      throw new SourceNotReadyError(sourceId, src.state)
    }

    const inFlight = this.running.get(sourceId)
    if (inFlight) return inFlight

    const attempt = this.list().filter((j) => j.sourceId === sourceId).length + 1
    const jobId =
      this.deps.newJobId?.(sourceId, attempt) ?? `tr_${sourceId}_${attempt}`

    const run = this.execute(jobId, sourceId, src.manifest?.captureMode ?? 'in_person', opts)
    this.running.set(sourceId, run)
    try {
      return await run
    } finally {
      this.running.delete(sourceId)
    }
  }

  /** 재시도 — **새 job id로** 남긴다. 기존 결과를 덮지 않는다 (11절). */
  async retry(sourceId: string, opts: { vocabulary?: string[] } = {}): Promise<TranscriptionJob> {
    return this.enqueue(sourceId, opts)
  }

  private async execute(
    jobId: string,
    sourceId: string,
    captureMode: CaptureMode,
    opts: { vocabulary?: string[] }
  ): Promise<TranscriptionJob> {
    // 실행 전에 queued를 남긴다. 여기서 죽어도 화면이 job의 존재를 안다.
    const queued: TranscriptionJob = {
      id: jobId,
      sourceId,
      state: 'queued',
      attempt: 1,
      error: null,
      retryable: true,
      warning: null,
      audioMs: null,
      elapsedMs: null,
      segmentCount: null,
    }
    this.jobs.set(jobId, queued)
    await this.persist(queued)

    const job: TranscriptionJob = { ...queued, state: 'transcribing' }
    this.jobs.set(jobId, job)
    await this.persist(job)

    const workDir = path.join(this.deps.workRoot, jobId)
    try {
      const chunkFiles = await this.deps.chunkFilesOf(sourceId)
      if (!chunkFiles.mic || chunkFiles.mic.length === 0) {
        throw new TranscriptionFailed('mic track 조각이 없어 전사할 수 없다.', false)
      }

      const result = await this.deps.runner.run({
        sourceId,
        captureMode,
        chunks: { mic: chunkFiles.mic, remote: chunkFiles.remote },
        workDir,
        vocabulary: opts.vocabulary,
      })

      // ⛔ 불변 이력. 같은 내용 재기록은 멱등 통과, 다른 내용은 거부된다 (11절).
      await this.deps.runs.putRawTranscript(jobId, {
        source_id: sourceId,
        capture_mode: captureMode,
        language: result.language,
        audio_ms: result.audioMs,
        segments: result.segments,
      })

      job.state = transition(
        'transcriptionJob',
        'transcribing',
        'completed'
      ) as TranscriptionJobState
      job.audioMs = result.audioMs
      job.elapsedMs = result.elapsedMs
      job.segmentCount = result.segments.length
      job.warning = result.performanceWarning
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e)
      job.retryable = e instanceof TranscriptionFailed ? e.retryable : true
      // 실패는 언제나 failed_retryable로 간다 — 머신에 있는 유일한 실패 상태다.
      job.state = transition(
        'transcriptionJob',
        'transcribing',
        'failed_retryable'
      ) as TranscriptionJobState
    } finally {
      // 중간 산출물은 지운다. 원본 조각과 transcript 이력은 남는다.
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }

    this.jobs.set(jobId, job)
    await this.persist(job)
    return job
  }
}
