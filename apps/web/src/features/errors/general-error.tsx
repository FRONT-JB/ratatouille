import { useNavigate, useRouter } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({
  className,
  minimal = false,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (
          <p className='text-muted-foreground font-mono text-sm'>500</p>
        )}
        <span className='text-lg font-medium'>화면을 여는 중 문제가 생겼습니다</span>
        {/*
          ⛔ 사과만 하고 끝내지 않는다. 무엇이 안전한지 말한다 —
             이 앱에서 사용자가 제일 걱정하는 것은 녹음과 교정 내용이다.
        */}
        <p className='text-muted-foreground text-center'>
          녹음과 전사 내용은 그대로 남아 있습니다. <br />
          잠시 뒤 다시 시도해 주세요.
        </p>
        {!minimal && (
          <div className='mt-6 flex gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              뒤로 가기
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>처음으로</Button>
          </div>
        )}
      </div>
    </div>
  )
}
