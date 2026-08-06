import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RecordingPage } from '@/features/recording'

export const Route = createFileRoute('/_app/meetings/new')({
  component: NewMeetingRoute,
})

function NewMeetingRoute() {
  const navigate = useNavigate()
  return (
    <RecordingPage
      // 녹음이 끝나면 페이지 B 로딩 상태로 넘긴다 (PLAN.md 순서 3)
      onFinished={(meetingId) =>
        void navigate({ to: '/meetings/$meetingId', params: { meetingId } })
      }
    />
  )
}
