import { createFileRoute } from '@tanstack/react-router'
import { RecordingPage } from '@/features/recording'

export const Route = createFileRoute('/_app/meetings/new')({
  component: RecordingPage,
})
