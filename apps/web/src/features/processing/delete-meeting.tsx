import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { FetchLike } from './session'

/**
 * 회의 삭제.
 *
 * ⛔ **확인 없이 지우지 않는다.** 30분·50분짜리 녹음이 오클릭 한 번으로
 *    사라지면 안 된다. 확인 창은 **어느 회의인지 이름을 보여준다** — 무엇이
 *    사라지는지 모르는 확인은 확인이 아니다.
 *
 * ⛔ **"완전히 삭제"라고 쓰지 않는다.** 서버는 `.data/trash`로 옮긴다.
 *    완전 삭제라고 하면 거짓이고, 아무 말도 안 하면 사용자는 디스크가 비었다고
 *    착각한다. 어디로 가는지 그대로 말한다.
 */
export function DeleteMeeting({
  sourceId,
  label,
  fetchFn,
  onDeleted,
  open: openProp,
  onOpenChange,
  trigger = true,
}: {
  sourceId: string
  /** 확인 창에 보일 이름. id는 사람이 읽을 수 없다 */
  label: string
  fetchFn?: FetchLike
  onDeleted?: (sourceId: string) => void
  /**
   * 밖에서 여는 경우(⋮ 메뉴).
   *
   * ⛔ **확인 창은 메뉴 **밖**에 살아야 한다.** 메뉴 안에 두면 항목을 누르는
   *    순간 메뉴가 닫히면서 창까지 같이 사라진다.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 자기 버튼을 그릴지. 메뉴에서 열 때는 끈다 */
  trigger?: boolean
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = openProp ?? innerOpen
  const setOpen = onOpenChange ?? setInnerOpen
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await (fetchFn ?? fetch)(`/api/sources/${sourceId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        // ⛔ 서버가 거절한 이유를 그대로 보여준다. "삭제 실패"만 띄우면
        //    전사 중이라 거절된 건지 서버가 죽은 건지 알 수 없다.
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `삭제하지 못했습니다 (${res.status})`)
      }
      setOpen(false)
      onDeleted?.(sourceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        {trigger && (
          <AlertDialogTrigger asChild>
            <Button variant='ghost' size='sm' className='text-state-danger w-fit'>
              <Trash2 className='size-4' aria-hidden />
              회의 삭제
            </Button>
          </AlertDialogTrigger>
        )}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label} 회의를 지울까요?</AlertDialogTitle>
            <AlertDialogDescription>
              녹음 원본과 전사 결과가 목록에서 사라집니다. 파일은 지워지지 않고
              서버의 휴지통(<code>.data/trash</code>)으로 옮겨지므로, 필요하면
              직접 되찾을 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            {/*
              ⛔ `AlertDialogAction`을 그대로 쓰지 않는다. 그 컴포넌트는 누르는
                 순간 창을 닫아서, 실패해도 닫혀버리고 오류를 보여줄 자리가
                 사라진다. 성공했을 때만 닫는다.
            */}
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
              disabled={busy}
              className='bg-state-danger text-white hover:opacity-90'
            >
              {busy ? '삭제 중…' : '삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
          {error && (
            <p className='text-state-danger text-sm' role='alert'>
              {error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
