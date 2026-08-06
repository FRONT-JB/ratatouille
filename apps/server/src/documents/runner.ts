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
  describeViolation,
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
    summary: { text: summary.text, evidence: strings(summary.evidence) },
    decisions: list(p.decisions).map((d) => ({
      what: String((d as Record<string, unknown>).what ?? ''),
      evidence: strings((d as Record<string, unknown>).evidence),
    })),
    tasks: list(p.tasks).map((t) => ({
      action: String((t as Record<string, unknown>).action ?? ''),
      evidence: strings((t as Record<string, unknown>).evidence),
    })),
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
