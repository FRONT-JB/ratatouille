import { useEffect } from 'react'
import { Check, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const OPTIONS = [
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
  { value: 'system', label: '시스템' },
] as const

/**
 * 화면 테마 전환.
 *
 * ⛔ **아이콘만 있는 동그란 버튼으로 두지 않는다.** 사이드바 맨 아래 구석에
 *    아이콘 하나만 있으면 못 찾는다 — 실제로 "토글이 없는 것 같다"는 말을
 *    들었다. 다른 nav 항목과 같은 모양의 줄로 둔다.
 */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()

  /* 모바일 주소창 색을 테마에 맞춘다 */
  useEffect(() => {
    const themeColor = theme === 'dark' ? '#0a0a0a' : '#ffffff'
    document
      .querySelector("meta[name='theme-color']")
      ?.setAttribute('content', themeColor)
  }, [theme])

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='w-full justify-start gap-2 px-2 font-normal'
          data-testid='theme-switch'
        >
          <Sun className='size-4 dark:hidden' aria-hidden />
          <Moon className='hidden size-4 dark:block' aria-hidden />
          화면 테마
          <span className='text-muted-foreground ml-auto text-xs'>
            {current.label}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => setTheme(o.value)}>
            {o.label}
            <Check
              size={14}
              className={cn('ms-auto', theme !== o.value && 'hidden')}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
