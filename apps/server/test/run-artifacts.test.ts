import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ArtifactImmutableError,
  InvalidRunInputError,
  RunArtifactStore,
} from '../src/runs/store.ts'

let root: string
let runs: RunArtifactStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-runs-'))
  runs = new RunArtifactStore(path.join(root, 'runs'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const RUN_META = {
  model_provider: 'openai-codex',
  auth_type: 'chatgpt_oauth',
  model: 'gpt-5-codex',
  runtime: 'hermes_default',
  prompt_version: 'p1',
  skill_version: 's1',
  schema_version: 1,
  rubric_version: 'r1',
}

/** 재현에 필요한 참조만 담은 입력 snapshot */
const INPUT = {
  source_id: 'src_01',
  source_hash: 'sha256:aaa',
  transcription_id: 'tr_01',
  transcript_revision_id: 'rev_01',
  transcript_hash: 'sha256:bbb',
  segment_count: 154,
}

describe('디렉토리 배치 — technical-foundation 11절', () => {
  it('네 종류의 artifact가 각자 자리에 놓인다', async () => {
    await runs.putSource('src_01', { id: 'src_01', source_hash: 'sha256:aaa' })
    await runs.putRawTranscript('tr_01', { segments: [] })
    await runs.putTranscriptionRun('tr_01', RUN_META)
    await runs.putReviewedTranscript('rev_01', { segments: [] })
    await runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })

    const at = (p: string) => path.join(root, 'runs', p)
    for (const p of [
      'sources/src_01/source.json',
      'transcriptions/tr_01/transcript.raw.json',
      'transcriptions/tr_01/run.json',
      'transcript-revisions/rev_01/transcript.reviewed.json',
      'documentation-runs/run_01/input.json',
      'documentation-runs/run_01/run.json',
    ]) {
      await expect(readFile(at(p), 'utf8')).resolves.toContain('{')
    }
  })

  it('run artifact 영역은 vault와 섞이지 않는다', () => {
    // vault/sources/ 는 사람이 읽는 Markdown이고,
    // runs/sources/ 는 재현용 이력이다. 둘은 다른 루트에 있어야 한다.
    expect(runs.root).not.toContain('vault')
  })
})

describe('⛔ document run은 audio·transcript를 복사하지 않는다', () => {
  // 11절: "document run은 audio나 transcript를 복사하지 않고 source_id,
  //        source_hash, transcription_id와 transcript_revision_id로 참조한다.
  //        input.json에는 재현에 필요한 입력 snapshot과 hash만 남긴다."
  //
  // 이걸 주석으로 두면 지켜지지 않는다. 허용 키 목록으로 강제한다.

  it('참조와 hash만 있는 입력을 받는다', async () => {
    await expect(
      runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })
    ).resolves.toBeDefined()
  })

  it('transcript 본문을 넣으면 거부한다', async () => {
    await expect(
      runs.putDocumentationRun('run_01', {
        input: { ...INPUT, segments: [{ id: 'seg_1', text: '안녕하세요' }] },
        meta: RUN_META,
      })
    ).rejects.toThrow(InvalidRunInputError)
  })

  it('audio 바이트를 넣으면 거부한다', async () => {
    await expect(
      runs.putDocumentationRun('run_01', {
        input: { ...INPUT, audio: 'UklGRi4AAABXQVZF...' },
        meta: RUN_META,
      })
    ).rejects.toThrow(InvalidRunInputError)
  })

  it('거부 사유가 어느 필드 때문인지 한국어로 말한다', async () => {
    await expect(
      runs.putDocumentationRun('run_01', {
        input: { ...INPUT, transcript_text: '전문' },
        meta: RUN_META,
      })
    ).rejects.toThrow(/transcript_text/)
  })

  it('필수 참조가 빠지면 거부한다 — 재현할 수 없는 이력은 이력이 아니다', async () => {
    const { source_hash: _drop, ...noHash } = INPUT
    await expect(
      runs.putDocumentationRun('run_01', { input: noHash, meta: RUN_META })
    ).rejects.toThrow(/source_hash/)
  })
})

describe('run.json 필수 메타데이터 — 11절이 열거한 8개', () => {
  const keys = Object.keys(RUN_META)

  it.each(keys)('%s 가 빠지면 거부한다', async (k) => {
    const partial: Record<string, unknown> = { ...RUN_META }
    delete partial[k]
    await expect(
      runs.putDocumentationRun('run_01', { input: INPUT, meta: partial })
    ).rejects.toThrow(new RegExp(k))
  })

  it('빈 문자열은 채운 것으로 치지 않는다', async () => {
    await expect(
      runs.putDocumentationRun('run_01', {
        input: INPUT,
        meta: { ...RUN_META, model: '  ' },
      })
    ).rejects.toThrow(/model/)
  })

  it('앱이 모르는 필드는 그대로 보관한다', async () => {
    await runs.putDocumentationRun('run_01', {
      input: INPUT,
      meta: { ...RUN_META, hermes_version: '0.20.0' },
    })
    const meta = await runs.readDocumentationRun('run_01')
    expect(meta?.run.hermes_version).toBe('0.20.0')
  })
})

describe('⛔ 이력은 덮어쓰지 않는다', () => {
  // 11절: run artifact는 품질 평가를 위한 **역사 기록**이다.
  // 5절: raw audio와 source hash는 불변이다.

  it('source.json을 다른 내용으로 다시 쓰면 거부한다', async () => {
    await runs.putSource('src_01', { id: 'src_01', source_hash: 'sha256:aaa' })
    await expect(
      runs.putSource('src_01', { id: 'src_01', source_hash: 'sha256:bbb' })
    ).rejects.toThrow(ArtifactImmutableError)
  })

  it('raw transcript를 다른 내용으로 다시 쓰면 거부한다', async () => {
    await runs.putRawTranscript('tr_01', { segments: [{ id: 's1' }] })
    await expect(
      runs.putRawTranscript('tr_01', { segments: [{ id: 's2' }] })
    ).rejects.toThrow(ArtifactImmutableError)
  })

  it('모델이 낸 proposed.json을 나중에 고칠 수 없다', async () => {
    await runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })
    await runs.putProposed('run_01', { summary: '초안' })
    await expect(runs.putProposed('run_01', { summary: '고침' })).rejects.toThrow(
      ArtifactImmutableError
    )
  })

  it('같은 내용을 다시 쓰는 것은 통과한다 — 재시도가 실패로 보이면 안 된다', async () => {
    await runs.putSource('src_01', { id: 'src_01', source_hash: 'sha256:aaa' })
    await expect(
      runs.putSource('src_01', { id: 'src_01', source_hash: 'sha256:aaa' })
    ).resolves.toBeUndefined()
  })

  it('충돌 메시지가 무엇을 지키려는지 밝힌다', async () => {
    await runs.putRawTranscript('tr_01', { segments: [{ id: 's1' }] })
    await expect(
      runs.putRawTranscript('tr_01', { segments: [] })
    ).rejects.toThrow(/이력|불변|덮/)
  })
})

describe('audio artifact', () => {
  it('바이트를 그대로 보관한다', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    await runs.putAudio('src_01', 'mic.webm', bytes)
    const back = await runs.readAudio('src_01', 'mic.webm')
    expect(back && [...back]).toEqual([1, 2, 3, 4])
  })

  it('다른 바이트로 덮어쓰면 거부한다 — raw audio는 불변이다', async () => {
    await runs.putAudio('src_01', 'mic.webm', new Uint8Array([1]))
    await expect(
      runs.putAudio('src_01', 'mic.webm', new Uint8Array([2]))
    ).rejects.toThrow(ArtifactImmutableError)
  })

  it('경로 탈출을 막는다', async () => {
    await expect(
      runs.putAudio('src_01', '../../etc/passwd', new Uint8Array([1]))
    ).rejects.toThrow(/경로/)
  })

  it('id에 든 경로 구분자도 막는다', async () => {
    await expect(runs.putSource('../evil', {})).rejects.toThrow(/id/)
  })
})

describe('읽기와 목록', () => {
  it('document run 하나를 통째로 읽는다', async () => {
    await runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })
    await runs.putProposed('run_01', { summary: '초안' })
    await runs.putReviewed('run_01', { approved: true })

    const r = await runs.readDocumentationRun('run_01')
    expect(r?.input.source_id).toBe('src_01')
    expect(r?.proposed).toEqual({ summary: '초안' })
    expect(r?.reviewed).toEqual({ approved: true })
    expect(r?.run.model_provider).toBe('openai-codex')
  })

  it('아직 검수 전이면 reviewed가 null이다', async () => {
    await runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })
    const r = await runs.readDocumentationRun('run_01')
    expect(r?.proposed).toBeNull()
    expect(r?.reviewed).toBeNull()
  })

  it('없는 run은 null이다', async () => {
    expect(await runs.readDocumentationRun('nope')).toBeNull()
  })

  it('한 source의 run 이력을 시간순으로 훑을 수 있다', async () => {
    for (const id of ['run_03', 'run_01', 'run_02']) {
      await runs.putDocumentationRun(id, { input: INPUT, meta: RUN_META })
    }
    expect(await runs.listDocumentationRuns()).toEqual(['run_01', 'run_02', 'run_03'])
  })

  it('source_id로 걸러낸다', async () => {
    await runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })
    await runs.putDocumentationRun('run_02', {
      input: { ...INPUT, source_id: 'src_99' },
      meta: RUN_META,
    })
    expect(await runs.listDocumentationRuns({ sourceId: 'src_99' })).toEqual(['run_02'])
  })
})

describe('중복 실행이 current를 조용히 덮지 않는다 — 5절', () => {
  it('같은 source로 두 번 실행하면 서로 다른 run으로 남는다', async () => {
    await runs.putDocumentationRun('run_01', { input: INPUT, meta: RUN_META })
    await runs.putProposed('run_01', { summary: '1차' })
    await runs.putDocumentationRun('run_02', { input: INPUT, meta: RUN_META })
    await runs.putProposed('run_02', { summary: '2차' })

    // 1차 결과가 살아 있다 — 무엇이 왜 바뀌었는지 대조할 수 있다
    expect((await runs.readDocumentationRun('run_01'))?.proposed).toEqual({
      summary: '1차',
    })
    expect(await runs.listDocumentationRuns({ sourceId: 'src_01' })).toEqual([
      'run_01',
      'run_02',
    ])
  })
})
