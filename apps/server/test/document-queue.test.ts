/**
 * AI 정리 job.
 *
 * ⛔ **`transcript_approved` 이전에는 만들지 않는다**(규칙 2). 확정되지 않은
 *    전사에서 나온 결정·Action Item은 근거가 없다.
 *
 * ⛔ **evidence 검증을 통과해야 `proposed`가 된다.** 프롬프트로 고칠 문제가
 *    아니다 — 실측에서 인용 누락이 1차 44%, 2차 78%였고 전사가 길수록 악화했다.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { RuleViolationError } from '@ratatouille/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROVENANCE, DocumentQueue } from '../src/documents/queue.ts'
import { DocumentRunner, looksLikeAuthFailure } from '../src/documents/runner.ts'
import { RevisionStore } from '../src/revisions/store.ts'
import { RunArtifactStore } from '../src/runs/store.ts'
import { SourceRepository } from '../src/sources/repository.ts'
import { VaultStore } from '../src/vault/store.ts'

let root: string
let sources: SourceRepository
let revisions: RevisionStore
let runs: RunArtifactStore
let queue: DocumentQueue
let vault: VaultStore

/** 모델이 돌려줄 JSON. 테스트마다 갈아끼운다 */
let modelOutput: string
let exitCode: number

const GOOD = JSON.stringify({
  summary: { text: '결제 모듈 오픈을 3월 16일로 연기했다.', evidence: ['seg_0', 'seg_1'] },
  decisions: [{ what: '오픈을 3월 16일로 연기', evidence: ['seg_1'] }],
  tasks: [],
  evidence: [
    { id: 'seg_0', timestamp: '00:00:00', quote: '결제 모듈 오픈을 연기합니다.' },
    { id: 'seg_1', timestamp: '00:00:04', quote: '3월 16일로 하죠.' },
  ],
})

function fakeHermes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (() => {
    const emitter = new EventEmitter() as any
    emitter.stdout = new EventEmitter()
    emitter.stderr = new EventEmitter()
    emitter.kill = () => undefined
    void (async () => {
      await Promise.resolve()
      if (exitCode === 0) emitter.stdout.emit('data', modelOutput)
      else emitter.stderr.emit('data', modelOutput)
      emitter.emit('close', exitCode)
    })()
    return emitter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

async function readySource(id = 'src_01') {
  await sources.create({
    sourceId: id,
    captureMode: 'in_person',
    startedAt: '2026-08-06T10:00:00+09:00',
    devices: { mic: '마이크' },
    tracks: ['mic'],
    expectedChunks: {},
    pauses: [],
    chunkDurationMs: 5000,
  })
  await sources.putChunk(id, { track: 'mic', seq: 0, bytes: new Uint8Array(16).fill(1) })
  await sources.finalize(id, { expectedChunks: { mic: 1 } })
}

async function withRevision(id = 'src_01', approve = true) {
  await readySource(id)
  await revisions.open({
    sourceId: id,
    jobId: `tr_${id}_1`,
    segments: [
      { id: 'seg_0', startMs: 0, endMs: 4000, text: '결제 모듈 오픈을 연기합니다.' },
      { id: 'seg_1', startMs: 4000, endMs: 8000, text: '3월 16일로 하죠.' },
    ],
  })
  if (approve) await revisions.approve(id)
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-doc-'))
  modelOutput = GOOD
  exitCode = 0
  runs = new RunArtifactStore(path.join(root, 'runs'))
  sources = new SourceRepository(path.join(root, 'blobs'))
  revisions = new RevisionStore({ stateRoot: path.join(root, 'revisions'), runs })
  vault = new VaultStore(path.join(root, 'vault'))
  await vault.init()
  queue = new DocumentQueue({
    runner: new DocumentRunner({ spawnFn: fakeHermes() }),
    sources,
    revisions,
    runs,
    vault,
    stateRoot: path.join(root, 'docruns'),
    provenance: DEFAULT_PROVENANCE,
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('⛔ 전사 확정 전에는 만들지 않는다 — 규칙 2', () => {
  it('교정 중이면 거절한다', async () => {
    await withRevision('src_01', false)
    await expect(queue.enqueue('src_01')).rejects.toThrow(RuleViolationError)
  })

  it('전사 자체가 없으면 거절한다', async () => {
    await readySource()
    await expect(queue.enqueue('src_01')).rejects.toThrow(RuleViolationError)
  })

  it('확정했으면 만든다', async () => {
    await withRevision()
    expect((await queue.enqueue('src_01')).state).toBe('proposed')
  })

  it('⛔ 거절 이유가 규칙 이름으로 나온다 — 화면이 원인을 짚을 수 있어야 한다', async () => {
    await withRevision('src_01', false)
    await queue.enqueue('src_01').catch((e) => {
      expect((e as RuleViolationError).rule).toBe('document-requires-approved-transcript')
    })
  })
})

describe('⛔ evidence 검증을 통과해야 proposed가 된다', () => {
  it('정상 결과는 proposed다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    expect(run.state).toBe('proposed')
    expect(run.violations).toEqual([])
  })

  it('⛔ 결함 A는 이제 구조적으로 일어날 수 없다', async () => {
    // 예전에는 모델이 evidence 배열을 만들었고, 인용한 id를 빠뜨렸다
    // (1차 44%, 2차 78%). 이제 **서버가 인용된 id 전부로 배열을 만든다.**
    // 모델이 배열을 아예 안 줘도 결과는 온전하다.
    modelOutput = JSON.stringify({
      summary: { text: 'x', evidence: ['seg_0', 'seg_1'] },
      decisions: [],
      tasks: [],
      // evidence 배열 자체가 없다
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.state).toBe('proposed')
    expect(run.proposal!.evidence.map((e) => e.id)).toEqual(['seg_0', 'seg_1'])
  })

  it('⛔ 서버가 채운 인용문은 원문 그대로다', async () => {
    modelOutput = JSON.stringify({
      summary: { text: 'x', evidence: ['seg_0'] },
      decisions: [],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal!.evidence[0]).toEqual({
      id: 'seg_0',
      timestamp: '00:00:00',
      quote: '결제 모듈 오픈을 연기합니다.',
    })
  })

  it('⛔ 없는 세그먼트를 인용하면 막힌다 — 환각', async () => {
    modelOutput = JSON.stringify({
      summary: { text: 'x', evidence: ['seg_999'] },
      decisions: [],
      tasks: [],
      evidence: [{ id: 'seg_999', timestamp: '00:99:99', quote: '없는 말' }],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.state).toBe('failed_retryable')
    expect(run.violations.some((v) => v.kind === 'unknown_segment')).toBe(true)
  })

  it('⛔ 모델이 인용문을 다듬어 보내도 무시된다 — 서버 값이 이긴다', async () => {
    modelOutput = JSON.stringify({
      summary: { text: 'x', evidence: ['seg_0'] },
      decisions: [],
      tasks: [],
      // 모델이 굳이 배열을 만들고 인용문을 다듬었다
      evidence: [{ id: 'seg_0', timestamp: '99:99:99', quote: '결제 모듈 오픈 연기' }],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.state).toBe('proposed')
    expect(run.proposal!.evidence[0]!.quote).toBe('결제 모듈 오픈을 연기합니다.')
    expect(run.proposal!.evidence[0]!.timestamp).toBe('00:00:00')
  })

  it('⛔ 검증에 실패해도 결과를 버리지 않는다 — 못 보면 고칠 수 없다', async () => {
    modelOutput = JSON.stringify({
      // seg_999는 없는 세그먼트다 — 환각이라 막혀야 한다
      summary: { text: '이 요약은 남아야 한다', evidence: ['seg_0', 'seg_999'] },
      decisions: [],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal?.summary.text).toBe('이 요약은 남아야 한다')
    const stored = await readFile(
      path.join(root, 'runs/documentation-runs', run.id, 'proposed.json'),
      'utf8'
    )
    expect(stored).toContain('이 요약은 남아야 한다')
  })
})

describe('⛔ 근거는 문장 안 마커에서 온다', () => {
  // 항목 끝에 근거를 몰아 달면 `[1][2]…[10]`이 되어 어느 근거가 어느 주장을
  // 받치는지 알 수 없다. 검수는 "이 문장이 맞나"를 묻는 일이다.

  it('본문 마커가 evidence로 모인다', async () => {
    modelOutput = JSON.stringify({
      summary: { text: '오픈을 연기했고[seg_0] 날짜를 정했다[seg_1].' },
      decisions: [],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.state).toBe('proposed')
    expect(run.proposal!.summary.evidence).toEqual(['seg_0', 'seg_1'])
    expect(run.proposal!.evidence.map((e) => e.id)).toEqual(['seg_0', 'seg_1'])
  })

  it('⛔ 본문은 마커를 그대로 지닌다 — 화면이 각주를 그릴 위치다', async () => {
    modelOutput = JSON.stringify({
      summary: { text: '오픈을 연기했다[seg_0].' },
      decisions: [],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal!.summary.text).toContain('[seg_0]')
  })

  it('⛔ 각주 번호 순서는 읽는 순서다 — 요약 → 결정 → 할 일', async () => {
    modelOutput = JSON.stringify({
      summary: { text: '요약[seg_1].' },
      decisions: [{ what: '결정[seg_0].' }],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    // seg_1이 먼저 읽히므로 1번이다. 세그먼트 순서가 아니라 인용 순서.
    expect(run.proposal!.evidence.map((e) => e.id)).toEqual(['seg_1', 'seg_0'])
  })

  it('마커를 빠뜨리고 배열만 줘도 근거가 사라지지 않는다', async () => {
    // 모델이 형식을 어겨도 근거를 통째로 잃지 않는다. 마커가 앞 번호를 갖는다.
    modelOutput = JSON.stringify({
      summary: { text: '요약[seg_1].', evidence: ['seg_0', 'seg_1'] },
      decisions: [],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal!.summary.evidence).toEqual(['seg_1', 'seg_0'])
  })

  it('⛔ 없는 ID를 문장에 박아도 막힌다 — 환각', async () => {
    modelOutput = JSON.stringify({
      summary: { text: '지어낸 근거[seg_999].' },
      decisions: [],
      tasks: [],
    })
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.state).toBe('failed_retryable')
    expect(run.violations.some((v) => v.kind === 'unknown_segment')).toBe(true)
  })
})

describe('⛔ Action Item의 담당자와 기한', () => {
  // 프롬프트는 `owner`·`due`를 요구하는데 파서가 버리고 있었다. 2차 실측에서
  // 기한 정확도가 4/4였는데 그 값이 화면까지 오지 못했다.
  //
  // ⚠️ 화자 분리를 접었으므로 "제가 하겠습니다"류는 담당자를 알 수 없다.
  //    그건 `null`로 남고 사람이 지정한다 — 지어내지 않는다.

  const withTasks = (owner: unknown, due: unknown) =>
    JSON.stringify({
      summary: { text: 'x', evidence: ['seg_0'] },
      decisions: [],
      tasks: [{ action: '계약서 검토', owner, due, evidence: ['seg_1'] }],
    })

  it('모델이 준 담당자와 기한이 보존된다', async () => {
    modelOutput = withTasks('이한결', '3월 16일')
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal!.tasks[0]).toMatchObject({
      action: '계약서 검토',
      owner: '이한결',
      due: '3월 16일',
    })
  })

  it('⛔ `미입력`은 문자열이 아니라 null이다 — 그런 이름의 사람이 없다', async () => {
    modelOutput = withTasks('미입력', '미입력')
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal!.tasks[0]!.owner).toBeNull()
    expect(run.proposal!.tasks[0]!.due).toBeNull()
  })

  it('아예 없으면 null이다 — 빈 문자열로 두지 않는다', async () => {
    modelOutput = withTasks(undefined, undefined)
    await withRevision()
    const run = await queue.enqueue('src_01')

    expect(run.proposal!.tasks[0]!.owner).toBeNull()
    expect(run.proposal!.tasks[0]!.due).toBeNull()
  })
})

describe('⛔ 사람이 검수해야 current가 된다', () => {
  it('만들어진 직후에는 아무도 안 본 상태다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    expect(run.documentState).toBe('reviewing')
    expect(run.review.summary.state).toBe('unreviewed')
  })

  it('⛔ 검수 전에는 승격이 거절된다 — AI 판정만으로 확정되는 길이 없다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    await expect(queue.promote(run.id)).rejects.toThrow(RuleViolationError)
  })

  it('무엇이 막고 있는지 알려준다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    expect(queue.blockers(run.id).map((b) => b.section)).toEqual([
      'summary',
      'decisions',
      'tasks',
      'evidence',
    ])
  })

  it('section별로 따로 확인한다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    await queue.review(run.id, 'summary', { state: 'accepted' })

    expect(queue.get(run.id)!.review.summary.state).toBe('accepted')
    expect(queue.get(run.id)!.review.tasks.state).toBe('unreviewed')
  })

  it('넷을 다 확인하면 승격된다', async () => {
    // 이 모델 출력에는 결정 1건, 할 일 0건이 들어 있다
    await withRevision()
    const run = await queue.enqueue('src_01')
    for (const s of ['summary', 'decisions', 'evidence'] as const) {
      await queue.review(run.id, s, { state: 'accepted' })
    }
    // 할 일이 실제로 없으므로 「없음」이 정직하다
    await queue.review(run.id, 'tasks', { state: 'empty' })

    expect((await queue.promote(run.id)).documentState).toBe('current')
  })

  it('⛔ 루브릭에 「수정 필요」가 남아 있으면 막힌다 — 결함 B 대응', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    for (const s of ['summary', 'decisions', 'evidence'] as const) {
      await queue.review(run.id, s, { state: 'accepted' })
    }
    await queue.review(run.id, 'tasks', { state: 'empty' })
    await queue.review(run.id, 'decisions', {
      rubric: { 'decision-vs-proposal': 'fix_required' },
    })

    await expect(queue.promote(run.id)).rejects.toThrow(/수정 필요/)
  })

  it('⛔ 검수 상태가 디스크에 남는다 — 재시작해도 다시 봐야 하면 안 된다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    await queue.review(run.id, 'summary', { state: 'accepted' })

    const reloaded = new DocumentQueue({
      runner: new DocumentRunner({ spawnFn: fakeHermes() }),
      sources,
      revisions,
      runs,
      stateRoot: path.join(root, 'docruns'),
      provenance: DEFAULT_PROVENANCE,
    })
    await reloaded.load()
    expect(reloaded.get(run.id)!.review.summary.state).toBe('accepted')
  })
})

describe('⛔ 확정하면 vault에 남는다 — 9절', () => {
  const acceptAll = async (runId: string) => {
    for (const s of ['summary', 'decisions', 'evidence'] as const) {
      await queue.review(runId, s, { state: 'accepted' })
    }
    await queue.review(runId, 'tasks', { state: 'empty' })
  }

  it('확정 전에는 vault에 아무것도 없다', async () => {
    await withRevision()
    await queue.enqueue('src_01')
    expect(await vault.read('notes/src_01.md')).toBeNull()
  })

  it('확정하면 회의록이 생긴다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    await acceptAll(run.id)
    await queue.promote(run.id)

    const note = await vault.read('notes/src_01.md')
    expect(note).not.toBeNull()
    expect(note!.frontmatter.source_id).toBe('src_01')
    expect(note!.body).toContain('## 요약')
  })

  it('⛔ 오디오나 전사 본문을 복사하지 않는다 — ID로만 참조한다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    await acceptAll(run.id)
    await queue.promote(run.id)

    const note = await vault.read('notes/src_01.md')
    expect(JSON.stringify(note!.frontmatter)).not.toContain('결제 모듈')
  })

  it('⛔ 사람이 쓴 frontmatter를 지우지 않는다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')
    await acceptAll(run.id)
    await queue.promote(run.id)

    // Obsidian에서 태그를 붙였다
    const note = (await vault.read('notes/src_01.md'))!
    await vault.write('notes/src_01.md', {
      frontmatter: { ...note.frontmatter, tags: ['결제'] },
      body: note.body,
    })

    // 다시 정리하고 다시 확정한다
    const again = await queue.enqueue('src_01')
    await acceptAll(again.id)
    await queue.promote(again.id)

    const after = (await vault.read('notes/src_01.md'))!
    expect(after.frontmatter.tags).toEqual(['결제'])
    expect(after.frontmatter.documentation_run_id).toBe(again.id)
  })

  it('vault 없이도 확정은 된다 — 수집만 하는 구성이 있다', async () => {
    const noVault = new DocumentQueue({
      runner: new DocumentRunner({ spawnFn: fakeHermes() }),
      sources,
      revisions,
      runs,
      stateRoot: path.join(root, 'docruns2'),
      provenance: DEFAULT_PROVENANCE,
    })
    await withRevision('src_02')
    const run = await noVault.enqueue('src_02')
    for (const s of ['summary', 'decisions', 'evidence'] as const) {
      await noVault.review(run.id, s, { state: 'accepted' })
    }
    await noVault.review(run.id, 'tasks', { state: 'empty' })
    expect((await noVault.promote(run.id)).documentState).toBe('current')
  })
})

describe('⛔ 불변 이력 — 11절', () => {
  it('input.json이 ID와 hash로만 참조한다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')

    const input = JSON.parse(
      await readFile(
        path.join(root, 'runs/documentation-runs', run.id, 'input.json'),
        'utf8'
      )
    )
    expect(input.source_id).toBe('src_01')
    expect(input.transcript_revision_id).toBe('rev_src_01_1')
    expect(typeof input.source_hash).toBe('string')
    // ⛔ 오디오나 전사 본문이 복사되어 있으면 안 된다
    expect(JSON.stringify(input)).not.toContain('결제 모듈')
  })

  it('run.json에 어떤 모델이 만들었는지 남는다', async () => {
    await withRevision()
    const run = await queue.enqueue('src_01')

    const meta = JSON.parse(
      await readFile(
        path.join(root, 'runs/documentation-runs', run.id, 'run.json'),
        'utf8'
      )
    )
    expect(meta.model_provider).toBe('openai-codex')
    expect(meta.model).toBeTruthy()
    expect(meta.runtime).toContain('hermes')
  })
})

describe('실패를 구분한다', () => {
  it('⛔ 인증 만료는 실패가 아니라 auth_required다', async () => {
    // 재시도만 반복하게 두면 사용자는 실제로 필요한 재인증에 도달하지 못한다.
    exitCode = 1
    modelOutput = 'Error: 401 Unauthorized — token expired'
    await withRevision()

    expect((await queue.enqueue('src_01')).state).toBe('auth_required')
  })

  it('그 밖의 실패는 재시도할 수 있다', async () => {
    exitCode = 1
    modelOutput = 'Error: connection reset'
    await withRevision()

    expect((await queue.enqueue('src_01')).state).toBe('failed_retryable')
  })

  it('JSON이 아니면 재시도할 수 있다 — 다음 실행에서 형식을 맞출 수 있다', async () => {
    modelOutput = '죄송합니다, 정리할 수 없습니다.'
    await withRevision()

    const run = await queue.enqueue('src_01')
    expect(run.state).toBe('failed_retryable')
    expect(run.error).toMatch(/JSON/)
  })

  it('⛔ 요약이 없으면 성공으로 치지 않는다', async () => {
    // 빈 결과를 성공으로 두면 사용자는 회의에 아무 내용이 없었다고 믿는다.
    modelOutput = JSON.stringify({ decisions: [], tasks: [], evidence: [] })
    await withRevision()

    expect((await queue.enqueue('src_01')).state).toBe('failed_retryable')
  })

  it('인증 만료 문구를 알아본다', () => {
    expect(looksLikeAuthFailure('401 Unauthorized')).toBe(true)
    expect(looksLikeAuthFailure('OAuth token expired')).toBe(true)
    expect(looksLikeAuthFailure('다시 로그인해 주세요')).toBe(true)
    expect(looksLikeAuthFailure('connection reset by peer')).toBe(false)
  })
})

describe('재시작 복구', () => {
  it('⛔ 죽은 채로 남은 정리는 실패로 되살린다 — 영원히 "정리 중"이면 안 된다', async () => {
    await withRevision()
    await queue.enqueue('src_01')

    const reloaded = new DocumentQueue({
      runner: new DocumentRunner({ spawnFn: fakeHermes() }),
      sources,
      revisions,
      runs,
      stateRoot: path.join(root, 'docruns'),
      provenance: DEFAULT_PROVENANCE,
    })
    await reloaded.load()
    // 이미 proposed로 끝난 것은 그대로다
    expect(reloaded.latestFor('src_01')?.state).toBe('proposed')
  })
})

describe('⛔ 「최신」은 만든 시각이다', () => {
  it('열 번을 넘겨도 마지막에 만든 것이 나온다', async () => {
    // id 문자열로 정렬하면 `_9`가 `_12`보다 뒤로 간다. 실제로 12번째 실행을
    // 만들었는데 화면은 9번째를 보여줬다.
    await withRevision()
    let last = ''
    for (let i = 0; i < 11; i++) {
      last = (await queue.enqueue('src_01')).id
    }
    expect(queue.latestFor('src_01')!.id).toBe(last)
    expect(last).toContain('_11')
  })
})

describe('중복 실행', () => {
  it('같은 회의를 두 번 동시에 돌리지 않는다', async () => {
    await withRevision()
    const [a, b] = await Promise.all([
      queue.enqueue('src_01'),
      queue.enqueue('src_01'),
    ])
    expect(a.id).toBe(b.id)
  })

  it('다시 돌리면 새 run id다 — 이전 결과를 덮지 않는다', async () => {
    await withRevision()
    const first = await queue.enqueue('src_01')
    const second = await queue.enqueue('src_01')
    expect(second.id).not.toBe(first.id)
  })
})
