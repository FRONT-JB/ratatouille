import { Link } from '@tanstack/react-router'
import { Construction } from 'lucide-react'

type PlaceholderProps = {
  /** 이 화면이 무엇이 될 자리인지 */
  title: string
  /** GOAL.md의 어느 Phase에서 구현하는지 */
  phase: string
  /** 확정된 화면 계약 — 구현 세션이 임의로 바꾸면 안 되는 것들 */
  contract: string[]
}

/**
 * 아직 구현하지 않은 화면의 자리 표시.
 *
 * 사이드바가 링크를 갖고 있으면 최소한 "여기가 무엇이 될 자리"는 보여야 한다.
 * 404를 띄우면 링크가 잘못된 것인지 아직 안 만든 것인지 구분되지 않는다.
 *
 * ⚠️ 이 컴포넌트를 쓰는 라우트는 **아직 아무 기능도 하지 않는다.**
 *    구현했다고 착각하지 않도록 화면에 Phase를 명시한다.
 */
export function Placeholder({ title, phase, contract }: PlaceholderProps) {
  return (
    <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 sm:p-10'>
      <div className='flex items-center gap-3'>
        <Construction className='text-state-warning size-5 shrink-0' />
        <div>
          <h1 className='text-xl font-semibold'>{title}</h1>
          <p className='text-muted-foreground text-sm'>{phase}에서 구현합니다</p>
        </div>
      </div>

      <div className='border-border bg-muted/40 rounded-lg border p-4'>
        <h2 className='text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase'>
          확정된 화면 계약
        </h2>
        <ul className='flex flex-col gap-1.5 text-sm'>
          {contract.map((line) => (
            <li key={line} className='flex gap-2'>
              <span className='text-muted-foreground shrink-0'>·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link
        to='/'
        className='text-muted-foreground hover:text-foreground w-fit text-sm underline underline-offset-4'
      >
        홈으로
      </Link>
    </div>
  )
}
