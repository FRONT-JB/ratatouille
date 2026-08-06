import { useLocation } from '@tanstack/react-router'
import { Mic } from 'lucide-react'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { ThemeSwitch } from '@/components/theme-switch'
import { useMeetings } from '@/features/processing/use-meetings'
import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import type { NavGroup as NavGroupType } from './types'

/**
 * Ratatouille 공통 앱 셸의 유일한 Sidebar.
 *
 * PLAN.md 순서 1 계약:
 *   - `새 회의`, `회의` + 한 단계 회의 항목, `파일 업로드`를 한 Sidebar 안에 둔다
 *   - Sidebar 옆에 별도 회의 목록 열을 만들지 않는다
 *   - Today · 캘린더 · 로드맵 · 통합 작업 관리를 넣지 않는다 (Phase 2)
 *
 * ⛔ 회의 목록은 **아직 교정하지 않은 것까지 전부** 보여준다. 진입 시점에
 *    무엇이 있고 무엇이 덜 끝났는지 알 수 없으면 URL을 외우고 있어야 한다.
 *
 * 1인용 앱이므로 팀 전환기와 사용자 프로필을 두지 않는다.
 */
export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  // ⛔ 경로가 바뀌면 목록을 다시 불러온다. 진행 중인 것이 없으면 폴링이
  //    멈추므로, 회의를 지우고 돌아와도 지운 회의가 그대로 남아 있었다.
  const { pathname } = useLocation()
  const { items } = useMeetings({ revision: pathname })

  const groups: NavGroupType[] = sidebarData.navGroups.map((g) =>
    g.title === '회의'
      ? {
          ...g,
          // 한 단계로 직접 넣는다 — 중첩 tree를 만들지 않는다
          items: items.map((m) => ({
            title: m.label,
            url: `/meetings/${m.sourceId}`,
            badge: m.badge,
            icon: Mic,
          })),
        }
      : g
  )

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <ThemeSwitch />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
