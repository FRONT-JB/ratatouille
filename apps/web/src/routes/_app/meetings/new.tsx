import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/features/placeholder'

export const Route = createFileRoute('/_app/meetings/new')({
  component: () => (
    <Placeholder
      title='페이지 A — 녹음 중'
      phase='Phase 3'
      contract={[
        '사이드바 + 분할되지 않은 녹음 화면',
        '시작 전: 입력 모드(대면·온라인)·장치 선택, 온라인은 탭 track 선택',
        '마이크와 탭 오디오의 사전 level meter를 각각 표시',
        '탭 track이 없으면 녹음이 시작되지 않고 경고',
        '사용자가 직접 시작한다 — 자동 시작 없음',
        'manifest에 입력 모드·장치·선택한 track·시작 시각 기록',
        'visualizer는 실제 MediaStream level에 반응 (장식 animation 아님)',
        '녹음 상태와 원본 보존 상태를 독립된 표시 요소로 분리',
        '금지: 실시간 전사 · AI 요약 · 결정 · Action Item · 검수 UI',
      ]}
    />
  ),
})
