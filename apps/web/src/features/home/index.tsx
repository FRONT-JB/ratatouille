/**
 * 회의가 없을 때의 빈 상태.
 *
 * 회의 목록은 Sidebar의 `회의` 아래에 한 단계로 직접 표시된다 (PLAN.md 순서 1).
 * 이 화면에 두 번째 목록 열을 만들지 않는다.
 */
export function Home() {
  return (
    <div className='flex h-svh flex-col items-center justify-center gap-2 p-6 text-center'>
      <h1 className='text-2xl font-bold'>Ratatouille</h1>
      <p className='text-muted-foreground text-sm'>
        사이드바의 <span className='font-medium'>새 회의</span> 또는{' '}
        <span className='font-medium'>파일 업로드</span>로 시작하세요.
      </p>
    </div>
  )
}
