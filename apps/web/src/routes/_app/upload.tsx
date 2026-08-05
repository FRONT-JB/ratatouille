import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/features/placeholder'

export const Route = createFileRoute('/_app/upload')({
  component: () => (
    <Placeholder
      title='파일 업로드'
      phase='Phase 4'
      contract={[
        '페이지 A를 거치지 않고 같은 처리 경로에 합류한다',
        '파일 선택·업로드 → 서버 검증(ready) → 전사 처리 → 페이지 B 전사 교정',
        '업로드 진행률 · 서버 검증 실패 · ready 도달을 각각 구분해 표시',
        '녹음 source와 같은 상태 표시 컴포넌트를 재사용한다',
        '업로드가 끝나지 않은 상태와 ready를 혼동하지 않는다',
      ]}
    />
  ),
})
