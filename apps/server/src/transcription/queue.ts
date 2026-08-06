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
import type { CaptureMode } from '@ratatouille/contracts'
import type { SourceRepository } from '../sources/repository.ts'
import { type TranscriptionJob, type Transcriber } from './job.ts'

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
  transcriber: Transcriber
  sources: SourceRepository
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

  /** 이 source의 가장 최근 job */
  latestFor(sourceId: string): TranscriptionJob | null {
    const mine = this.list().filter((j) => j.sourceId === sourceId)
    return mine.at(-1) ?? null
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

    const chunkFiles = await this.deps.chunkFilesOf(sourceId)
    const { job } = await this.deps.transcriber.transcribe({
      jobId,
      sourceId,
      captureMode,
      chunkFiles,
      vocabulary: opts.vocabulary,
    })

    this.jobs.set(jobId, job)
    await this.persist(job)
    return job
  }
}
