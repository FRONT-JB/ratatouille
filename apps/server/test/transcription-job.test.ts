import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunArtifactStore } from '../src/runs/store.ts'
import { type RunProcess, Transcriber } from '../src/transcription/job.ts'

let root: string
let runs: RunArtifactStore
let calls: Array<{ cmd: string; args: string[] }>

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-tr-'))
  runs = new RunArtifactStore(path.join(root, 'runs'))
  calls = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const WHISPER_OUT = {
  result: { language: 'ko' },
  transcription: [
    {
      offsets: { from: 0, to: 4120 },
      text: ' 결제 모듈 오픈을 3월 16일로 연기합니다.',
    },
    { offsets: { from: 4120, to: 9000 }, text: ' 네 그렇게 하시죠.', speaker: '1' },
  ],
}

/** whisper와 ffmpeg을 흉내낸다. 실제 실행은 별도 테스트에서 한다. */
function fakeRun(
  over: {
    ffmpegCode?: number
    whisperCode?: number
    whisperOut?: unknown | null
    stderr?: string
  } = {}
): RunProcess {
  return async (cmd, args) => {
    calls.push({ cmd, args })
    if (cmd.includes('ffprobe')) {
      return { code: 0, stdout: '507.0\n', stderr: '' }
    }
    if (cmd.includes('ffmpeg')) {
      const out = args[args.length - 1]!
      if ((over.ffmpegCode ?? 0) === 0) await writeFile(out, 'fake wav')
      return { code: over.ffmpegCode ?? 0, stdout: '', stderr: over.stderr ?? '' }
    }
    // whisper-cli
    const prefix = args[args.indexOf('-of') + 1]!
    if (over.whisperOut !== null) {
      await writeFile(`${prefix}.json`, JSON.stringify(over.whisperOut ?? WHISPER_OUT))
    }
    return { code: over.whisperCode ?? 0, stdout: '', stderr: over.stderr ?? '' }
  }
}

async function chunks(name: string, n = 3): Promise<string[]> {
  const dir = path.join(root, 'chunks', name)
  await mkdir(dir, { recursive: true })
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const p = path.join(dir, `${String(i).padStart(6, '0')}.webm`)
    await writeFile(p, new Uint8Array(64).fill(i + 1))
    out.push(p)
  }
  return out
}

function makeTranscriber(run: RunProcess, elapsed = [0, 35_000]) {
  let i = 0
  return new Transcriber({
    runs,
    workRoot: path.join(root, 'work'),
    modelPath: '/m/ggml-large-v3-turbo.bin',
    run,
    now: () => elapsed[Math.min(i++, elapsed.length - 1)]!,
  })
}

describe('전사 성공 경로', () => {
  it('completed까지 간다', async () => {
    const t = makeTranscriber(fakeRun())
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('completed')
    expect(job.error).toBeNull()
  })

  it('세그먼트를 돌려준다', async () => {
    const t = makeTranscriber(fakeRun())
    const { transcript } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(transcript?.segments.length).toBe(2)
    expect(transcript?.segments[0]?.startMs).toBe(0)
  })

  it('⛔ transcript.raw.json을 불변 이력으로 남긴다', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    const raw = (await runs.readRawTranscript('tr_01')) as {
      segments: unknown[]
      source_id: string
    }
    expect(raw.source_id).toBe('src_01')
    expect(raw.segments.length).toBe(2)
  })

  it('작업 파일을 정리한다 — 30분 회의마다 wav가 쌓이지 않는다', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    await expect(readFile(path.join(root, 'work/tr_01/input.wav'))).rejects.toThrow()
  })

  it('기준선 안이면 경고가 없다', async () => {
    const t = makeTranscriber(fakeRun(), [0, 35_000])
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.warning).toBeNull()
  })

  it('기준선을 크게 벗어나면 경고하되 실패시키지 않는다', async () => {
    // 507초 오디오를 400초에 → 1.3x. Metal 미적용 의심.
    const t = makeTranscriber(fakeRun(), [0, 400_000])
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('completed')
    expect(job.warning).toMatch(/Metal|느/)
  })
})

describe('⛔ 온라인 모드는 스테레오로 합친다 — Phase 0.5c', () => {
  it('mic과 remote를 join한다 (amix가 아니다)', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'online',
      chunkFiles: { mic: await chunks('mic'), remote: await chunks('remote') },
    })
    const ff = calls.find((c) => c.cmd.includes('ffmpeg'))!
    const filter = ff.args[ff.args.indexOf('-filter_complex') + 1]!
    expect(filter).toContain('join=inputs=2')
    expect(filter).not.toContain('amix')
  })

  it('화자 분리 플래그를 붙인다', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'online',
      chunkFiles: { mic: await chunks('mic'), remote: await chunks('remote') },
    })
    expect(calls.find((c) => c.cmd.includes('whisper'))!.args).toContain('-di')
  })

  it('⛔ remote가 없으면 전사하지 않는다 — 조용히 모노로 넘어가지 않는다', async () => {
    // 모노로 전사하면 담당자 필드가 통째로 비고 이유를 아무도 모른다.
    // Phase 0 2차 실측에서 A1 담당자가 `미입력`으로 나온 것과 같은 원인이다.
    const t = makeTranscriber(fakeRun())
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'online',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/remote|화자/)
    // 조각이 없는 것은 다시 해도 없다 — 화면이 재시도 버튼을 내지 않게 한다
    expect(job.retryable).toBe(false)
  })

  it('대면 모드는 모노로 간다', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    const ff = calls.find((c) => c.cmd.includes('ffmpeg'))!
    expect(ff.args).toContain('-ac')
    expect(ff.args[ff.args.indexOf('-ac') + 1]).toBe('1')
  })
})

describe('실패 처리', () => {
  it('ffmpeg 실패는 재시도 가능하다', async () => {
    const t = makeTranscriber(fakeRun({ ffmpegCode: 1, stderr: 'boom' }))
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/ffmpeg/)
    expect(job.retryable).toBe(true)
  })

  it('whisper 실패는 재시도 가능하다', async () => {
    const t = makeTranscriber(fakeRun({ whisperCode: 1, stderr: 'oom' }))
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('failed_retryable')
  })

  it('JSON이 안 나오면 잡아낸다', async () => {
    const t = makeTranscriber(fakeRun({ whisperOut: null }))
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/JSON/)
  })

  it('⛔ 무음(세그먼트 0개)을 성공으로 치지 않는다', async () => {
    const t = makeTranscriber(fakeRun({ whisperOut: { transcription: [] } }))
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/세그먼트/)
  })

  it('mic 조각이 없으면 재시도해도 소용없다', async () => {
    const t = makeTranscriber(fakeRun())
    const { job } = await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: {},
    })
    expect(job.error).toMatch(/mic/)
    expect(job.state).toBe('failed_retryable')
    // 재시도해도 소용없다는 것은 상태가 아니라 이 플래그가 전한다
    expect(job.retryable).toBe(false)
  })

  it('실패해도 transcript 이력을 남기지 않는다', async () => {
    const t = makeTranscriber(fakeRun({ whisperCode: 1 }))
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    expect(await runs.readRawTranscript('tr_01')).toBeNull()
  })

  it('실패 후에도 작업 파일을 정리한다', async () => {
    const t = makeTranscriber(fakeRun({ whisperCode: 1 }))
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })
    await expect(readFile(path.join(root, 'work/tr_01/mic.webm'))).rejects.toThrow()
  })
})

describe('고유명사 주입', () => {
  it('용어를 whisper에 넘긴다', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
      vocabulary: ['한결', 'PG 계약서'],
    })
    const w = calls.find((c) => c.cmd.includes('whisper'))!
    expect(w.args[w.args.indexOf('--prompt') + 1]).toContain('한결')
  })
})

describe('⛔ 재시도는 기존 결과를 덮지 않는다', () => {
  it('같은 job id로 다른 내용을 쓰려 하면 거부된다', async () => {
    const t = makeTranscriber(fakeRun())
    await t.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })

    // 다른 결과가 나오는 두 번째 실행
    const t2 = makeTranscriber(
      fakeRun({ whisperOut: { transcription: [{ offsets: { from: 0, to: 1 }, text: '다름' }] } })
    )
    const { job } = await t2.transcribe({
      jobId: 'tr_01',
      sourceId: 'src_01',
      captureMode: 'in_person',
      chunkFiles: { mic: await chunks('mic') },
    })

    expect(job.state).toBe('failed_retryable')
    expect(job.error).toMatch(/이력|불변|덮/)
  })
})
