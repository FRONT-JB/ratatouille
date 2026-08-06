import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ProcessingPage } from '@/features/processing'

export const Route = createFileRoute('/_app/meetings/$meetingId')({
  component: MeetingRoute,
})

function MeetingRoute() {
  const { meetingId } = Route.useParams()
  const navigate = useNavigate()

  return (
    <ProcessingPage
      meetingId={meetingId}
      // 지운 회의 페이지에 그대로 머물면 "찾을 수 없습니다"만 남는다
      onDeleted={() => void navigate({ to: '/meetings/new' })}
    />
  )
}
