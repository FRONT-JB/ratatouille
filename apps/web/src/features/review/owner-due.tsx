import { useState } from 'react'
import {
  type ProposalEdit,
  type ProposedTask,
  UNSET_LABEL,
} from '@ratatouille/contracts'
import { Input } from '@/components/ui/input'

/**
 * Action Item의 담당자와 기한.
 *
 * ⛔ **비어 있는 것을 감추지 않는다.** 화자 분리를 접었으므로 "제가
 *    하겠습니다"는 누구인지 알 수 없다 — 사람이 채울 자리라는 것을 보여준다.
 *
 * ⛔ **빈 칸은 `null`이다.** `'미입력'`을 그대로 저장하면 그런 이름의 담당자와
 *    구분되지 않고, "담당자가 정해졌는가"를 코드가 물을 수 없게 된다.
 *    화면에 보이는 말과 저장되는 값이 다르다.
 */
export function OwnerAndDue({
  task,
  index,
  disabled,
  onEdit,
}: {
  task: ProposedTask
  index: number
  disabled?: boolean
  onEdit: (edit: ProposalEdit) => void
}) {
  if (disabled) {
    return (
      <p className='text-muted-foreground mt-1 text-sm'>
        담당 {task.owner ?? UNSET_LABEL} · 기한 {task.due ?? UNSET_LABEL}
      </p>
    )
  }

  return (
    <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
      <span>담당</span>
      <Field
        key={`owner:${task.owner ?? ''}`}
        value={task.owner}
        label={`Action Item ${index + 1} 담당자`}
        onSave={(value) => onEdit({ section: 'tasks', kind: 'owner', index, value })}
      />
      <span aria-hidden>·</span>
      <span>기한</span>
      <Field
        key={`due:${task.due ?? ''}`}
        value={task.due}
        label={`Action Item ${index + 1} 기한`}
        onSave={(value) => onEdit({ section: 'tasks', kind: 'due', index, value })}
      />
    </div>
  )
}

/**
 * 한 칸.
 *
 * 입력을 멈추면 저장하는 대신 **포커스를 떠날 때** 보낸다 — 이름과 날짜는
 * 짧아서 타이핑 도중에 보내면 부분 문자열이 저장된다.
 */
function Field({
  value,
  label,
  onSave,
}: {
  value: string | null
  label: string
  onSave: (value: string | null) => void
}) {
  /*
   * ⛔ **밖의 값을 effect로 복사하지 않는다.** 렌더가 연쇄로 돌고, 타이핑
   *    도중에 서버 응답이 오면 쓰던 글자가 되돌아간다. 값이 밖에서 바뀌면
   *    부모가 `key`로 이 칸을 다시 만든다.
   */
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim()
    if (next !== value) onSave(next)
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value ?? '')
          e.currentTarget.blur()
        }
      }}
      aria-label={label}
      placeholder={UNSET_LABEL}
      className='h-7 w-28 px-2 text-sm'
    />
  )
}
