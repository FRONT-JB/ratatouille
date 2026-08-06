import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function NotFoundError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <p className='text-muted-foreground font-mono text-sm'>404</p>
        <span className='text-lg font-medium'>없는 화면입니다</span>
        <p className='text-muted-foreground text-center'>
          주소가 바뀌었거나 회의가 삭제되었을 수 있습니다.
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            뒤로 가기
          </Button>
          <Button onClick={() => navigate({ to: '/' })}>처음으로</Button>
        </div>
      </div>
    </div>
  )
}
