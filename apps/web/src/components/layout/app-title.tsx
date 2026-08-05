import { Link } from '@tanstack/react-router'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

/**
 * Sidebar 헤더의 제품명.
 *
 * 토글 버튼을 두지 않는다 — 컨텐츠 영역 Header의 SidebarTrigger가 유일한
 * 진입점이다. 모바일 Sheet는 overlay 클릭과 ESC로 닫는다.
 */
export function AppTitle() {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          className='gap-0 py-0 hover:bg-transparent active:bg-transparent'
          asChild
        >
          <Link
            to='/'
            onClick={() => setOpenMobile(false)}
            className='grid flex-1 text-start text-sm'
          >
            <span className='truncate font-bold'>Ratatouille</span>
            <span className='truncate text-xs'>개인 워크스페이스</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
