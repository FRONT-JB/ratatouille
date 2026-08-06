import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { type RevisionSegmentView, activeSegmentId } from './revision'

/**
 * 전사 교정기 — Phase 5의 중심.
 *
 * ⛔ **timestamp를 누르면 그 지점이 들린다.** 이게 교정의 방법이다.
 *    소리 없이 글만 고치는 것은 교정이 아니라 창작이다.
 *
 * ⛔ **원문을 지우지 않는다.** 고친 줄에는 기계가 실제로 들은 말을 함께
 *    보여준다. 무엇을 바꿨는지 보이지 않으면 되돌릴 수 없다.
 *
 * ⚠️ 세그먼트를 합치거나 나눌 수 없다. evidence가 세그먼트 id로 원문을
 *    가리키므로 id가 바뀌면 인용이 깨진다. 잘못 인식된 구간은 비우면 된다.
 */
export function TranscriptEditor({
  segments,
  currentMs,
  locked,
  onSeek,
  onEdit,
}: {
  segments: readonly RevisionSegmentView[]
  /** 지금 재생 위치. 어느 줄이 들리는지 강조한다 */
  currentMs: number | null
  /** 확정된 뒤에는 못 고친다 */
  locked: boolean
  onSeek: (ms: number) => void
  onEdit: (id: string, text: string) => void
}) {
  const activeId = activeSegmentId(segments, currentMs)
  const activeRef = useRef<HTMLLIElement | null>(null)

  // 재생을 따라 화면이 움직인다. 안 그러면 30분 회의에서 매번 스크롤해야 한다.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  if (segments.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>교정할 전사 내용이 없습니다.</p>
    )
  }

  return (
    <ol className='flex flex-col gap-1' data-testid='transcript-editor'>
      {segments.map((s) => {
        const active = s.id === activeId
        return (
          <li
            key={s.id}
            ref={active ? activeRef : undefined}
            data-testid='editor-segment'
            data-segment-id={s.id}
            data-active={active}
            data-edited={s.edited}
            className={cn(
              'flex gap-2 rounded-md px-2 py-1.5 transition-colors',
              active && 'bg-primary/5'
            )}
          >
            {/*
              ⛔ 버튼이다. div에 onClick을 달면 keyboard로 닿지 않는다 —
                 화면 계약에 keyboard 완주가 있다.
            */}
            <button
              type='button'
              onClick={() => onSeek(s.startMs)}
              className={cn(
                'text-muted-foreground hover:text-primary shrink-0 pt-1 font-mono text-xs tabular-nums underline-offset-2 hover:underline',
                active && 'text-primary font-medium'
              )}
              aria-label={`${s.timestamp}부터 듣기`}
            >
              {s.timestamp}
            </button>

            <div className='flex min-w-0 flex-1 flex-col'>
              <TextCell
                value={s.text}
                locked={locked}
                onChange={(v) => onEdit(s.id, v)}
                label={`${s.timestamp} 전사 내용`}
              />
              {/*
                ⛔ 고친 줄에는 원문을 남긴다. 무엇을 바꿨는지 안 보이면
                   잘못 고쳤을 때 되돌릴 수 없다.
              */}
              {s.edited && (
                <p
                  className='text-muted-foreground mt-0.5 text-xs line-through'
                  data-testid='original-text'
                >
                  {s.original || '(원문 없음)'}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 한 줄 편집기.
 *
 * ⚠️ `<textarea>`를 내용 높이에 맞춰 늘린다. 고정 높이면 긴 문장이 잘려서
 *    보이고, 무엇을 고치는지 모른 채 고치게 된다.
 */
function TextCell({
  value,
  locked,
  label,
  onChange,
}: {
  value: string
  locked: boolean
  label: string
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  if (locked) {
    // 확정된 전사는 읽기 전용이다. 편집 가능한 것처럼 보이면 안 된다.
    return <p className='text-sm leading-[1.618] whitespace-pre-wrap'>{value}</p>
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      aria-label={label}
      className='focus-visible:border-primary w-full resize-none rounded border border-transparent bg-transparent text-sm leading-[1.618] outline-none focus-visible:bg-background'
    />
  )
}
