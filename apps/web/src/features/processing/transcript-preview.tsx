import { useEffect, useState } from 'react'
import type { FetchLike } from './session'

/**
 * 전사 원문 미리보기.
 *
 * ⚠️ **읽기 전용이다.** 교정은 Phase 5다. 여기서 편집을 받으면
 *    transcript_revision 확정 절차를 우회하게 된다. 편집 UI가 없다는 것을
 *    화면에도 밝힌다 — 빈 자리를 두면 "고칠 수 있는데 안 되는" 것으로 읽힌다.
 *
 * ⚠️ timestamp는 **서버가 만든 문자열을 그대로 쓴다.** 화면에서 다시 포맷하면
 *    evidence 검증(문자열 완전 일치)과 어긋난다.
 */

export type TranscriptSegmentView = {
  id: string
  startMs: number
  endMs: number
  timestamp: string
  text: string
  /**
   * whisper가 준 화자 라벨.
   *
   * ⚠️ **화면에 쓰지 않는다** (2026-08-06 범위 변경). 화자 분리는 실제 회의에서
   *    동작하지 않았고(전부 한 화자), 그 대가로 타임라인이 8초 덩어리로
   *    뭉개졌다. 서버 응답에는 남아 있으므로 필드는 유지한다.
   */
  speaker: string | null
}

export type TranscriptView = {
  jobId: string
  sourceId: string
  language: string | null
  captureMode: string | null
  audioMs: number | null
  segments: TranscriptSegmentView[]
}

export function TranscriptPreview({
  jobId,
  fetchFn,
}: {
  jobId: string
  fetchFn?: FetchLike
}) {
  const [data, setData] = useState<TranscriptView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const f = fetchFn ?? fetch
    void Promise.resolve()
      .then(() => f(`/api/transcriptions/${jobId}/transcript`))
      .then(async (res) => {
        if (!res.ok) throw new Error(`전사 원문을 불러오지 못했습니다 (${res.status})`)
        return (await res.json()) as TranscriptView
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [jobId, fetchFn])

  if (error) {
    return (
      <p className='text-state-danger text-sm' role='alert'>
        {error}
      </p>
    )
  }
  if (!data) {
    return <p className='text-muted-foreground text-sm'>전사 원문을 불러오는 중…</p>
  }

  return (
    <section className='flex flex-col gap-3' data-testid='transcript-preview'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='text-sm font-medium'>전사 원문</h2>
        <span className='text-muted-foreground text-xs'>
          {data.segments.length}개 · {data.language ?? '언어 미상'}
          {data.audioMs ? ` · ${Math.round(data.audioMs / 1000)}초` : ''}
        </span>
      </div>

      <ol className='border-border divide-border divide-y rounded-md border'>
        {data.segments.map((s) => (
          <li
            key={s.id}
            className='flex gap-3 p-3 text-sm'
            data-testid='transcript-segment'
          >
            <span className='text-muted-foreground shrink-0 font-mono text-xs tabular-nums'>
              {s.timestamp}
            </span>
            <span className='leading-[1.618]'>{s.text}</span>
          </li>
        ))}
      </ol>

      <p className='text-muted-foreground text-xs'>
        읽기 전용입니다. 교정 기능은 아직 만들지 않았습니다.
      </p>
    </section>
  )
}
