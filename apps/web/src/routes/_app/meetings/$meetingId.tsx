import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/features/placeholder'

export const Route = createFileRoute('/_app/meetings/$meetingId')({
  component: () => (
    <Placeholder
      title='페이지 B — 회의 상세'
      phase='Phase 4·5·6'
      contract={[
        '사이드바 + 회의 상세. 넓은 왼쪽 결과 영역 + 좁은 오른쪽 전사 교정 영역',
        '왼쪽 상단은 오디오 재생기 — 영상 플레이어가 아니다',
        '왼쪽 본문: 회의 요약 · 결정 사항 · Action Item · 원문 근거 (4개 section)',
        '원문 근거는 전용 조회 영역 + 다른 세 결과의 evidence link 양쪽에서 접근',
        '각 section에 검수 상태 표시 (unreviewed·in_progress·accepted·edited·empty)',
        '전사 확정 전에는 AI 결과를 생성하거나 표시하지 않는다',
        '하나의 route 안에서 상태가 순차 전환된다',
        'transcript_reviewing → documenting → proposed·reviewing·current',
        '전사를 다시 수정하면 새 revision을 열고 기존 AI 결과는 stale',
      ]}
    />
  ),
})
