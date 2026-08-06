import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * 결과 한 덩어리를 그 자리에서 고친다.
 *
 * ⛔ **각주 마커를 그대로 보여준다.** `[seg_33]`을 감추고 고치게 하면 사람은
 *    자기가 어느 근거를 지우는지 모른 채 지운다. 보기 흉하더라도 보여준다 —
 *    이 앱에서 근거는 장식이 아니라 계약이다.
 *
 * ⛔ **고치는 동안에도 원래 글을 볼 수 있어야 한다.** 그래서 편집기를 열면
 *    자리를 차지하되 원문이 사라지지는 않는다(취소하면 그대로 돌아온다).
 */
export function Editable({
  children,
  text,
  label,
  disabled,
  onSave,
  onRemove,
}: {
  /** 읽기 상태에서 보여줄 것 — 각주가 번호로 그려진 본문 */
  children: React.ReactNode
  /** 편집기에 넣을 원본. 마커가 그대로 들어 있다 */
  text: string
  label: string
  disabled?: boolean
  onSave: (next: string) => void
  onRemove?: () => void
}) {
  /*
   * ⛔ **편집기는 열 때마다 새로 만든다**(`key`). 밖에서 내용이 바뀌었을 때
   *    effect로 draft를 따라가게 하면 렌더가 연쇄로 돌고, 타이핑 도중에
   *    글이 되돌아가는 사고가 난다. 열려 있지 않을 때는 draft가 없다.
   */
  const [editing, setEditing] = useState(false)

  if (disabled) return <>{children}</>

  if (editing) {
    return (
      <Draft
        key={text}
        initial={text}
        label={label}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          onSave(next)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div className='group/edit flex items-start gap-2'>
      <div className='min-w-0 flex-1'>{children}</div>
      <div className='flex shrink-0 gap-1 opacity-0 transition-opacity group-hover/edit:opacity-100 focus-within:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          aria-label={`${label} 고치기`}
          onClick={() => setEditing(true)}
        >
          <Pencil className='size-3.5' aria-hidden />
        </Button>
        {onRemove && (
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-state-danger size-7'
            aria-label={`${label} 지우기`}
            onClick={onRemove}
          >
            <Trash2 className='size-3.5' aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * 열려 있는 동안의 편집기.
 *
 * ⛔ 별도 컴포넌트인 이유: `key={text}`로 **다시 만들어** 초기값을 넣는다.
 *    effect로 prop을 state에 복사하면 렌더가 연쇄로 돌고, 타이핑 중에 밖에서
 *    값이 바뀌면 쓰던 글이 사라진다.
 */
function Draft({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string
  label: string
  onSave: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)

  return (
    <div className='flex flex-col gap-2'>
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`${label} 내용`}
        className='min-h-24 font-mono text-sm'
        onKeyDown={(e) => {
          // ⛔ Enter로 저장하지 않는다. 여러 문장을 쓰는 칸이다
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(draft)
        }}
      />
      <p className='text-muted-foreground text-xs'>
        {/* 마커를 왜 남겨야 하는지 말해준다 — 안 그러면 지운다 */}
        <code className='font-mono'>[seg_12]</code> 는 근거 표시입니다. 지우면 그
        문장의 근거가 사라집니다.
      </p>
      <div className='flex gap-2'>
        <Button size='sm' onClick={() => onSave(draft)}>
          저장
        </Button>
        <Button size='sm' variant='ghost' onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  )
}
