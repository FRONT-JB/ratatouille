import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Mic2,
  MonitorSpeaker,
  Radio,
  Settings2,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { resumeAudio } from './analyser-pool'
import { RecordingControls } from './components/recording-controls'
import {
  LevelMeter,
  RecordingVisualizer,
} from './components/recording-visualizer'
import {
  PreservationStatus,
  RecordingStatus,
  TrackAlerts,
} from './components/status-panels'
import { describeBlocker } from './start-gate'
import { type RecordingDeps, useRecording } from './use-recording'

/**
 * 페이지 A — 녹음 중 (PLAN.md 순서 2).
 *
 * ⛔ **이 화면에 없어야 하는 것**: 실시간 전사 · AI 요약 · 결정 · Action Item · 검수 UI.
 *    회의 중에 결과를 보여주면 사용자가 회의가 아니라 화면을 보게 된다.
 *    전사는 Phase 4, 정리는 Phase 6에서 별도 화면으로 나온다.
 *
 * ⛔ **자동으로 시작하지 않는다.** 마운트만으로 마이크를 켜지 않는다.
 */
export function RecordingPage({
  deps,
  onFinished,
}: {
  deps?: RecordingDeps
  /** 종료가 끝났을 때 route가 페이지 B로 넘긴다. */
  onFinished?: (sourceId: string) => void
} = {}) {
  const r = useRecording(deps)
  const [tabWarning, setTabWarning] = useState<string | null>(null)
  const preparing =
    r.screen.screenState === 'ready' ||
    r.screen.screenState === 'permission_prompt' ||
    r.screen.screenState === 'permission_denied'

  const finished = r.finishedSourceId
  // 권한 상태는 바로 위 전용 상태 패널과 버튼이 이미 설명한다. 같은 문구를
  // blocker로 반복하지 않고, 이 목록에는 별도로 해결할 입력 조건만 둔다.
  const visibleBlockers = r.gate.blockers.filter(
    (blocker) =>
      blocker !== 'mic_permission_missing' &&
      blocker !== 'mic_permission_denied'
  )
  useEffect(() => {
    if (finished) onFinished?.(finished)
  }, [finished, onFinished])

  const requestMic = () => {
    // ⛔ AudioContext는 사용자 제스처 안에서 깨워야 파형이 실제 입력을 읽는다.
    void resumeAudio()
    void r.requestMic()
  }

  return (
    <main
      className='mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 px-4 pt-4 pb-10 sm:gap-8 sm:px-10 sm:pt-7 sm:pb-16'
      data-testid='recording-page'
    >
      <header className='flex min-w-0 items-start gap-3 sm:gap-4'>
        <span className='mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background'>
          <Radio className='size-4' aria-hidden />
        </span>
        <div className='min-w-0'>
          <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
            회의 녹음
          </h1>
          <p className='mt-0.5 max-w-2xl text-sm text-muted-foreground'>
            이 화면은 녹음만 담당합니다. 입력과 보존 상태를 확인하며 회의에
            집중하세요.
          </p>
        </div>
      </header>

      {preparing ? (
        <section className='flex min-w-0 flex-col gap-4' aria-label='녹음 준비'>
          <RecordingStatus
            state={r.screen.screenState}
            elapsedLabel={r.screen.elapsedLabel}
            compact
            testId='preparation-status'
          />

          <div className='min-w-0 overflow-hidden rounded-xl border border-border bg-card'>
            <div className='border-b border-border p-4 sm:p-6'>
              <CaptureModePicker
                mode={r.captureMode}
                onChange={r.setCaptureMode}
              />
            </div>

            <div
              className={cn(
                'grid min-w-0 divide-y lg:divide-y-0',
                r.captureMode === 'online'
                  ? 'lg:grid-cols-2 lg:divide-x'
                  : 'lg:grid-cols-1'
              )}
            >
              <InputSetup
                icon={Mic2}
                title='마이크'
                description='내 목소리와 회의실의 소리를 담습니다.'
                connected={r.micStream !== null}
              >
                {(r.screen.screenState === 'permission_prompt' ||
                  r.screen.screenState === 'permission_denied') && (
                  <Button
                    onClick={requestMic}
                    variant={
                      r.screen.screenState === 'permission_denied'
                        ? 'outline'
                        : 'default'
                    }
                    className='w-full sm:w-fit'
                  >
                    <Mic2 className='size-4' aria-hidden />
                    {r.screen.screenState === 'permission_denied'
                      ? '마이크 권한 다시 확인'
                      : '마이크 권한 요청'}
                  </Button>
                )}

                {r.devices.length > 0 && (
                  <Select
                    value={r.micDeviceId ?? undefined}
                    onValueChange={r.setMicDeviceId}
                  >
                    <SelectTrigger className='w-full' aria-label='마이크 장치'>
                      <SelectValue placeholder='마이크를 선택하세요' />
                    </SelectTrigger>
                    <SelectContent>
                      {r.devices.map((device) => (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                        >
                          {device.label || '이름 없는 장치'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <LevelMeter
                  stream={r.micStream}
                  label='마이크'
                  hint={
                    r.micStream
                      ? '말해보세요'
                      : '권한 허용 후 확인할 수 있습니다'
                  }
                  showLabel={false}
                />
              </InputSetup>

              {r.captureMode === 'online' && (
                <InputSetup
                  icon={MonitorSpeaker}
                  title='탭 오디오'
                  description='온라인 회의의 상대방 목소리를 별도로 담습니다.'
                  connected={r.remoteStream !== null}
                >
                  <Button
                    variant='outline'
                    className='w-full sm:w-fit'
                    onClick={async () => {
                      void resumeAudio()
                      const result = await r.requestTabAudio()
                      setTabWarning(
                        result.ok
                          ? null
                          : result.reason === 'no_audio'
                            ? '선택한 탭의 오디오 공유가 켜져 있지 않습니다. 공유 창에서 "탭 오디오도 공유"를 체크해 주세요.'
                            : '탭 공유가 취소되었습니다.'
                      )
                    }}
                  >
                    <MonitorSpeaker className='size-4' aria-hidden />
                    {r.remoteStream ? '다른 탭 선택' : '탭 오디오 공유'}
                  </Button>
                  {r.remoteLabel && (
                    <p className='text-xs text-muted-foreground'>
                      공유 중: {r.remoteLabel}
                    </p>
                  )}
                  {tabWarning && (
                    <p className='text-sm text-state-warning' role='alert'>
                      {tabWarning}
                    </p>
                  )}
                  <LevelMeter
                    stream={r.remoteStream}
                    label='탭 오디오'
                    hint={
                      r.remoteStream
                        ? '상대방 소리를 확인하세요'
                        : '탭 공유 후 확인할 수 있습니다'
                    }
                    showLabel={false}
                  />
                </InputSetup>
              )}
            </div>

            {visibleBlockers.length > 0 && (
              <div className='border-t border-border bg-muted/40 p-4 sm:p-6'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Settings2
                    className='size-4 text-muted-foreground'
                    aria-hidden
                  />
                  시작 전 확인
                </div>
                <ul
                  className='flex flex-col gap-2'
                  data-testid='start-blockers'
                >
                  {visibleBlockers.map((blocker) => (
                    <li
                      key={blocker}
                      data-testid={`blocker-${blocker}`}
                      role='alert'
                      className='flex items-start gap-2 text-sm'
                    >
                      <AlertTriangle
                        className='mt-0.5 size-4 shrink-0 text-state-warning'
                        aria-hidden
                      />
                      <span>{describeBlocker(blocker)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section
          className='flex min-w-0 flex-col gap-4 sm:gap-5'
          aria-label='녹음 중'
        >
          {finished ? (
            <div
              className='flex flex-col items-start gap-4 rounded-xl border border-state-success/30 bg-state-success/6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'
              data-testid='recording-finished'
              role='status'
            >
              <div className='flex min-w-0 items-start gap-3'>
                <CheckCircle2
                  className='mt-0.5 size-5 shrink-0 text-state-success'
                  aria-hidden
                />
                <div>
                  <p className='font-medium'>녹음이 저장되었습니다.</p>
                  <p className='mt-0.5 text-sm text-muted-foreground'>
                    화면 이동이 시작되지 않으면 회의를 직접 열어 확인할 수
                    있습니다.
                  </p>
                </div>
              </div>
              <Button asChild variant='outline' className='shrink-0'>
                <a href={`/meetings/${finished}`}>
                  회의 열기 <ArrowRight className='size-4' aria-hidden />
                </a>
              </Button>
            </div>
          ) : (
            <>
              <RecordingStatus
                state={r.screen.screenState}
                elapsedLabel={r.screen.elapsedLabel}
              />

              <div
                className={cn(
                  'grid min-w-0 gap-4',
                  r.remoteStream && 'lg:grid-cols-2'
                )}
              >
                <RecordingVisualizer
                  stream={r.micStream}
                  active={r.screen.screenState === 'recording'}
                  label='마이크'
                />
                {r.remoteStream && (
                  <RecordingVisualizer
                    stream={r.remoteStream}
                    active={r.screen.screenState === 'recording'}
                    label='탭 오디오'
                  />
                )}
              </div>

              {/* ⛔ 입력 상태와 보존 상태는 서로 다른 사실이며 독립 패널이다. */}
              <div className='grid min-w-0 gap-4 sm:grid-cols-2'>
                <TrackAlerts alerts={r.screen.trackAlerts} />
                <PreservationStatus preservation={r.screen.preservation} />
              </div>

              {r.screen.screenState === 'stop_failed' && (
                <p
                  className='rounded-xl border border-state-danger/30 bg-state-danger/6 p-4 text-sm'
                  role='alert'
                >
                  종료하지 못했습니다. 녹음은 이 브라우저에 남아 있으니
                  네트워크를 확인한 뒤 다시 시도해 주세요.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {!finished && (
        <RecordingControls
          controls={r.screen.controls}
          onStart={() => {
            void resumeAudio()
            void r.start()
          }}
          onPause={r.pause}
          onResume={r.resume}
          onStop={() => void r.stop()}
        />
      )}
    </main>
  )
}

function InputSetup({
  icon: Icon,
  title,
  description,
  connected,
  children,
}: {
  icon: typeof Mic2
  title: string
  description: string
  connected: boolean
  children: React.ReactNode
}) {
  return (
    <section className='flex min-w-0 flex-col gap-5 p-4 sm:p-6'>
      <div className='flex items-start gap-3'>
        <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-muted'>
          <Icon className='size-4' aria-hidden />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-sm font-medium'>{title}</h2>
            <span
              className={cn(
                'flex items-center gap-1.5 text-xs',
                connected ? 'text-state-success' : 'text-muted-foreground'
              )}
            >
              {connected ? (
                <CheckCircle2 className='size-3.5' aria-hidden />
              ) : (
                <span
                  className='size-2.5 rounded-full border border-muted-foreground'
                  aria-hidden
                />
              )}
              {connected ? '연결됨' : '연결 대기'}
            </span>
          </div>
          <p className='mt-0.5 text-xs text-muted-foreground'>{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function CaptureModePicker({
  mode,
  onChange,
}: {
  mode: 'in_person' | 'online'
  onChange: (mode: 'in_person' | 'online') => void
}) {
  const options = [
    {
      value: 'in_person' as const,
      label: '대면 회의',
      icon: Users,
      hint: '마이크 입력만 녹음',
    },
    {
      value: 'online' as const,
      label: '온라인 회의',
      icon: MonitorSpeaker,
      hint: '마이크와 탭 오디오를 분리 녹음',
    },
  ]

  return (
    <fieldset className='min-w-0'>
      <legend className='mb-3 text-sm font-medium'>회의 방식</legend>
      <div className='grid min-w-0 gap-2 sm:grid-cols-2'>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'relative flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 motion-reduce:transition-none sm:p-4',
              mode === option.value
                ? 'border-foreground bg-foreground text-background'
                : 'border-border hover:bg-muted/60'
            )}
          >
            <input
              type='radio'
              name='capture-mode'
              value={option.value}
              checked={mode === option.value}
              onChange={() => onChange(option.value)}
              className='absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-lg opacity-0'
            />
            <option.icon className='size-4 shrink-0' aria-hidden />
            <span className='flex min-w-0 flex-col'>
              <span className='text-sm font-medium'>{option.label}</span>
              <span
                className={cn(
                  'text-xs',
                  mode === option.value
                    ? 'text-background/70'
                    : 'text-muted-foreground'
                )}
              >
                {option.hint}
              </span>
            </span>
            {mode === option.value && (
              <CheckCircle2 className='ml-auto size-4 shrink-0' aria-hidden />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
