import { Outlet } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { PageHeaderSlotProvider } from '@/components/layout/page-header-slot'
import { SkipToMain } from '@/components/skip-to-main'

type AppLayoutProps = {
  children?: React.ReactNode
}

/**
 * Ratatouille 공통 앱 셸 — `단일 사이드바 + 현재 페이지`.
 *
 * PLAN.md 순서 1: 페이지 A(녹음 중)와 페이지 B(회의 상세)가
 * 같은 셸과 내비게이션 상태를 공유한다.
 */
export function AppLayout({ children }: AppLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  return (
    <LayoutProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <SkipToMain />
        <AppSidebar />
        <SidebarInset
          className={cn(
            // Set content container, so we can use container queries
            '@container/content',

            // If layout is fixed, set the height
            // to 100svh to prevent overflow
            'has-data-[layout=fixed]:h-svh',

            // If layout is fixed and sidebar is inset,
            // set the height to 100svh - spacing (total margins) to prevent overflow
            'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
          )}
        >
          {/*
            좁은 화면에서 Sidebar는 Sheet로 접힌다. 이때 Sheet 안의 toggle 버튼은
            닫힌 상태에서 접근할 수 없으므로, 셸에 항상 붙는 Header의
            SidebarTrigger가 유일한 진입점이다. 제거하면 모바일에서 내비게이션이
            완전히 막힌다 (PLAN.md 순서 1 완료 조건).
          */}
          <PageHeaderSlotProvider>
            {(slot) => (
              <>
                <Header>
                  {/* 페이지가 여기에 breadcrumb을 넣는다 */}
                  <div ref={slot} className='flex min-w-0 items-center gap-2' />
                </Header>
                {children ?? <Outlet />}
              </>
            )}
          </PageHeaderSlotProvider>
        </SidebarInset>
      </SidebarProvider>
    </LayoutProvider>
  )
}
