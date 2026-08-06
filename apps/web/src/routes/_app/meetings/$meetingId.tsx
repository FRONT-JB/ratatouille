import { createFileRoute } from '@tanstack/react-router'
import { ProcessingPage } from '@/features/processing'

export const Route = createFileRoute('/_app/meetings/$meetingId')({
  component: MeetingRoute,
})

function MeetingRoute() {
  const { meetingId } = Route.useParams()
  return <ProcessingPage meetingId={meetingId} />
}
