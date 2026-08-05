import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { ThemeSwitch } from '@/components/theme-switch'
import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'

/**
 * Ratatouille 공통 앱 셸의 유일한 Sidebar.
 *
 * PLAN.md 순서 1 계약:
 *   - `새 회의`, `회의` + 한 단계 회의 항목, `파일 업로드`를 한 Sidebar 안에 둔다
 *   - Sidebar 옆에 별도 회의 목록 열을 만들지 않는다
 *   - Today · 캘린더 · 로드맵 · 통합 작업 관리를 넣지 않는다 (Phase 2)
 *
 * 1인용 앱이므로 팀 전환기와 사용자 프로필을 두지 않는다.
 */
export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
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
