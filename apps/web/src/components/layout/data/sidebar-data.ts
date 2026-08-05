import { Mic, Upload, FileAudio } from 'lucide-react'
import { type SidebarData } from '../types'

/**
 * Ratatouille Sidebar 데이터.
 *
 * PLAN.md 순서 1 계약:
 *   - `새 회의`, `회의` 아래 회의 항목을 **한 단계로 직접** 표시, `파일 업로드`
 *   - 별도 회의 목록 열을 만들지 않는다
 *
 * ⛔ 금지 (PLAN.md `구현 세션이 임의로 바꾸면 안 되는 것`):
 *   Today · 캘린더 · 로드맵 · 통합 작업 관리는 Phase 2다. 여기에 넣지 않는다.
 *
 * 회의 항목은 Phase 2(서버 도메인 코어) 이후 서버에서 받아 채운다.
 * 지금은 셸 구조만 세운다.
 */
export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: '녹음',
      items: [
        {
          title: '새 회의',
          url: '/meetings/new',
          icon: Mic,
        },
        {
          title: '파일 업로드',
          url: '/upload',
          icon: Upload,
        },
      ],
    },
    {
      title: '회의',
      items: [
        // 회의 항목이 한 단계로 여기에 직접 들어온다 (중첩 tree 금지).
        // 서버 연동 전까지는 placeholder 하나만 둔다.
        {
          title: '아직 회의가 없습니다',
          url: '/',
          icon: FileAudio,
        },
      ],
    },
  ],
}
