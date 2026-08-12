/**
 * AI 정리 실행기 — Hermes 경계.
 *
 * ⛔ **Hermes는 모델 경계만 소유한다.** 전사는 Ratatouille이 whisper를 직접
 *    부르지만(0.7b: Hermes STT는 timestamp를 버린다), 모델 호출은 Hermes를
 *    거친다. `hermes proxy`는 profile·skill 층을 우회하는 단순 포워더라 쓰지 않는다.
 *
 * ⛔ **evidence 검증을 통과하지 못하면 `proposed`가 되지 않는다.**
 *    프롬프트로 고칠 문제가 아니다(실측: 누락률 44% → 78%, 전사가 길수록 악화).
 */

import { type ChildProcess, spawn } from 'node:child_process'
import {
  type DocumentProposal,
  type EvidenceViolation,
  type TranscriptSegment,
  canPromoteToProposed,
  citedIdsIn,
  describeViolation,
  normalizeTaskMetadata,
  verifyEvidence,
} from '@ratatouille/contracts'
import { buildDocumentPrompt, extractJson } from './prompt.ts'

/**
 * 실패 종류.
 *
 * ⛔ `auth_required`를 별도 상태로 둔다(5절). OAuth 만료를 "실패"로 뭉치면
 *    사용자는 재시도만 반복하고, 실제로 필요한 것은 재인증이다.
 */
export type DocumentFailureKind = 'auth_required' | 'retryable' | 'permanent'

export class DocumentFailed extends Error {
  constructor(
    message: string,
    readonly kind: DocumentFailureKind,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'DocumentFailed'
  }
}

export type SpawnLike = (
  bin: string,
  args: string[],
  opts: { stdio: ['ignore', 'pipe', 'pipe']; env?: NodeJS.ProcessEnv }
) => ChildProcess

export type RunnerDeps = {
  hermesBin?: string
  /** Hermes profile. 없으면 기본 profile로 돈다 */
  profile?: string
  spawnFn?: SpawnLike
  timeoutMs?: number
}

export type DocumentResult = {
  proposal: DocumentProposal
  violations: EvidenceViolation[]
  elapsedMs: number
  /** 모델 원문. 파싱이 어긋났을 때 되짚을 유일한 근거다 */
  rawOutput: string
}

/** OAuth 만료로 보이는 출력인가. 재시도가 아니라 재인증이 필요하다. */
export function looksLikeAuthFailure(text: string): boolean {
  return /unauthor|401|oauth|로그인|인증|expired.*token|token.*expired|re-?auth/i.test(
    text
  )
}

export class DocumentRunner {
  constructor(private readonly deps: RunnerDeps = {}) {}

  /**
   * 실제로 쓰는 Hermes profile. 지정하지 않으면 Hermes의 기본 profile이다.
   *
   * ⛔ **이력이 이 값을 여기서 읽어야 한다.** 같은 환경변수를 이력 쪽에서 또
   *    읽으면, profile을 코드로 넘기도록 바꾸는 날 기록만 옛 값을 가리킨다.
   *    「어떤 모델이 무엇을 만들었나」를 되짚는 것이 이 기록의 목적이다(11절).
   *
   * ⚠️ GOAL 6.6은 profile `ratatouille`를 요구하지만 그 profile은 아직 없다.
   *    없는 것을 기본값으로 박으면 AI 정리가 통째로 깨지므로, **비어 있다는
   *    사실을 이력에 남겨** 나중에 「무엇으로 돌았나」를 확인할 수 있게 한다.
   */
  get profile(): string | null {
    return this.deps.profile ?? null
  }

  async run(input: {
    segments: readonly TranscriptSegment[]
    context?: { title?: string | null; participants?: string[] }
    signal?: AbortSignal
  }): Promise<DocumentResult> {
    if (input.segments.length === 0) {
      throw new DocumentFailed(
        '전사 내용이 없어 정리할 수 없습니다.',
        'permanent'
      )
    }

    const prompt = buildDocumentPrompt({
      segments: input.segments,
      context: input.context,
    })

    const startedAt = Date.now()
    const args = this.deps.profile
      ? ['--profile', this.deps.profile, '-z', prompt]
      : ['-z', prompt]
    const { stdout, stderr } = await this.exec(args, input.signal)
    const elapsedMs = Date.now() - startedAt

    let parsed: unknown
    try {
      parsed = extractJson(stdout)
    } catch (e) {
      // ⛔ 파싱 실패는 재시도할 가치가 있다. 같은 프롬프트라도 다음 실행에서
      //    형식을 맞출 수 있다. 단 모델 원문을 남겨 원인을 볼 수 있게 한다.
      throw new DocumentFailed(
        e instanceof Error ? e.message : String(e),
        'retryable',
        stdout.slice(0, 2000) || stderr.slice(0, 2000)
      )
    }

    const proposal = fillEvidence(normalize(parsed), input.segments)
    const violations = verifyEvidence(proposal, input.segments)

    return { proposal, violations, elapsedMs, rawOutput: stdout }
  }

  private exec(
    args: string[],
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string }> {
    const spawnFn = this.deps.spawnFn ?? (spawn as unknown as SpawnLike)
    const timeoutMs = this.deps.timeoutMs ?? 10 * 60_000

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DocumentFailed('정리가 취소되었습니다.', 'retryable'))
        return
      }

      const child = spawnFn(this.deps.hermesBin ?? 'hermes', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        fn()
      }

      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL')
          reject(
            new DocumentFailed(
              `모델 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않아 중단했습니다.`,
              'retryable',
              stderr.slice(0, 2000)
            )
          )
        })
      }, timeoutMs)

      const onAbort = () => {
        finish(() => {
          child.kill('SIGKILL')
          reject(new DocumentFailed('정리가 취소되었습니다.', 'retryable'))
        })
      }
      signal?.addEventListener('abort', onAbort)

      child.stdout?.on('data', (d) => {
        stdout += String(d)
      })
      child.stderr?.on('data', (d) => {
        stderr += String(d)
      })
      child.on('error', (e) =>
        finish(() =>
          reject(
            new DocumentFailed(
              `Hermes를 실행하지 못했습니다: ${e.message}`,
              'permanent'
            )
          )
        )
      )
      child.on('close', (code) =>
        finish(() => {
          if (code === 0) {
            resolve({ stdout, stderr })
            return
          }
          const text = `${stderr}\n${stdout}`
          reject(
            new DocumentFailed(
              looksLikeAuthFailure(text)
                ? '모델 인증이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.'
                : `모델 호출이 실패했습니다 (종료 코드 ${code}).`,
              looksLikeAuthFailure(text) ? 'auth_required' : 'retryable',
              text.slice(0, 2000)
            )
          )
        })
      )
    })
  }
}

/**
 * 모델 출력을 계약 형태로 맞춘다.
 *
 * ⛔ **없는 필드를 지어내지 않는다.** 빈 배열로 두면 "결정이 없었다"가 되고,
 *    그건 사실일 수 있다. 대신 형태가 아예 다르면 던진다 — 조용히 빈 결과를
 *    성공으로 치면 사용자는 회의에 아무 내용이 없었다고 믿는다.
 */
function normalize(parsed: unknown): DocumentProposal {
  if (!parsed || typeof parsed !== 'object') {
    throw new DocumentFailed('모델이 객체가 아닌 것을 돌려줬습니다.', 'retryable')
  }
  const p = parsed as Record<string, unknown>

  const summary = p.summary as { text?: unknown; evidence?: unknown } | undefined
  if (!summary || typeof summary.text !== 'string') {
    throw new DocumentFailed(
      '모델 결과에 회의 요약이 없습니다.',
      'retryable',
      JSON.stringify(parsed).slice(0, 1000)
    )
  }

  return {
    narrative: list(p.narrative).map((n) => {
      const r = n as Record<string, unknown>
      return { heading: String(r.heading ?? ''), body: String(r.body ?? '') }
    }),
    summary: { text: summary.text, evidence: cites(summary.text, summary.evidence) },
    decisions: list(p.decisions).map((d) => {
      const what = String((d as Record<string, unknown>).what ?? '')
      return { what, evidence: cites(what, (d as Record<string, unknown>).evidence) }
    }),
    tasks: list(p.tasks).map((t) => {
      const r = t as Record<string, unknown>
      const action = String(r.action ?? '')
      return {
        action,
        owner: normalizeTaskMetadata(r.owner),
        due: normalizeTaskMetadata(r.due),
        evidence: cites(action, r.evidence),
      }
    }),
    evidence: list(p.evidence).map((e) => {
      const r = e as Record<string, unknown>
      return {
        id: String(r.id ?? ''),
        timestamp: String(r.timestamp ?? ''),
        quote: String(r.quote ?? ''),
      }
    }),
  }
}

/**
 * 본문에서 근거를 **다시 뽑는다.**
 *
 * ⛔ 사람이 문장을 고치면 인용도 같이 바뀐다. 본문만 바꾸고 `evidence` 배열을
 *    그대로 두면 «본문에 없는 근거»와 «근거 없는 문장»이 동시에 생긴다.
 *    실제로 그렇게 났다 — 요약을 seg_1로 바꿨는데 배열은 seg_0이었다.
 *
 * 모델이 처음 줄 때는 `normalize`가 같은 일을 한다. 여기는 **편집 경로**다.
 */
export function recite(proposal: DocumentProposal): DocumentProposal {
  return {
    ...proposal,
    summary: {
      ...proposal.summary,
      evidence: citedIdsIn(proposal.summary.text),
    },
    decisions: proposal.decisions.map((d) => ({
      ...d,
      evidence: citedIdsIn(d.what),
    })),
    tasks: proposal.tasks.map((t) => ({
      ...t,
      evidence: citedIdsIn(t.action),
    })),
  }
}

/**
 * evidence 배열을 **서버가 채운다.**
 *
 * ⛔ 예전에는 모델에게 id·시각·인용문을 전부 받았고, 실측에서 그 셋이 전부
 *    틀렸다:
 *      · 인용했는데 배열에 없음  1차 44%, 2차 78% (결함 A)
 *      · timestamp 불일치        1423 세그먼트 실행에서 발생
 *      · 인용문을 다듬어 인용     같은 실행에서 발생
 *
 *    시각과 인용문은 **id만 있으면 서버가 만들 수 있는 파생값**이다. 파생값을
 *    모델에게 받으면 틀릴 수 있고, 실제로 틀렸다. 검증으로 막는 것보다
 *    **애초에 틀릴 수 없게 만드는 것**이 낫다.
 *
 * 남는 위험은 하나다: 모델이 **없는 id**를 지어내는 것. 그건 `verifyEvidence`가
 * `unknown_segment`로 잡고, 그건 진짜 환각이므로 막아야 한다.
 *
 * ⚠️ 근거가 주장을 실제로 뒷받침하는지는 여전히 사람이 본다. 그건 검수 계약의
 *    몫이고 그대로 남는다.
 */
export function fillEvidence(
  proposal: DocumentProposal,
  segments: readonly TranscriptSegment[]
): DocumentProposal {
  const bySegId = new Map(segments.map((s) => [s.id, s]))
  const cited: string[] = []
  const seen = new Set<string>()
  const note = (ids: readonly string[]) => {
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      cited.push(id)
    }
  }
  /*
   * ⛔ **읽는 순서대로 모은다.** 이 순서가 곧 각주 번호다. 회의 전문이 먼저
   *    읽히므로 앞 번호를 가져야 한다 — 요약부터 세면 전문의 각주가 [40]부터
   *    시작하는 이상한 글이 된다.
   */
  for (const n of proposal.narrative ?? []) note(citedIdsIn(n.body))
  note(proposal.summary.evidence)
  for (const d of proposal.decisions) note(d.evidence)
  for (const t of proposal.tasks) note(t.evidence)

  return {
    ...proposal,
    evidence: cited.map((id) => {
      const seg = bySegId.get(id)
      // 모르는 id는 그대로 둔다 — `verifyEvidence`가 unknown_segment로 잡아야 한다.
      // 여기서 조용히 버리면 환각이 검증을 건너뛴다.
      return {
        id,
        timestamp: seg?.timestamp ?? '',
        quote: seg?.text ?? '',
      }
    }),
  }
}

/**
 * 이 본문이 인용한 세그먼트 ID.
 *
 * ⛔ **본문 안 마커가 정식 출처다.** 프롬프트가 `[seg_33]`을 문장 안에 넣으라고
 *    시키고, 화면은 그 자리에 각주 번호를 그린다. 여기서 뽑은 순서가 곧 각주
 *    번호 순서가 된다.
 *
 * 예전 형식(`evidence: ["seg_7"]`)도 받아준다. 모델이 마커를 빠뜨리고 배열만
 * 주는 경우가 있고, 그때 근거를 통째로 잃는 것보다는 항목 끝에 붙는 편이 낫다.
 * 마커가 있는 것이 먼저 오고, 배열에만 있는 것이 뒤에 붙는다.
 */
function cites(text: string, given: unknown): string[] {
  const out = citedIdsIn(text)
  const seen = new Set(out)
  for (const id of strings(given)) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** 검증 결과를 사람이 읽는 말로. 화면이 그대로 보여준다. */
export function describeViolations(violations: EvidenceViolation[]): string[] {
  return violations.map(describeViolation)
}

export { canPromoteToProposed }
