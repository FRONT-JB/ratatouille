import { useEffect, useState } from 'react'
import { AlertTriangle, MonitorSpeaker, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
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
  /**
   * 종료가 끝났을 때 부른다. route가 페이지 B로 넘긴다.
   *
   * ⚠️ 이 컴포넌트가 직접 `useNavigate`를 부르지 않는 이유: router 없이도
   *    렌더할 수 있어야 테스트가 화면 계약을 검증할 수 있다.
   */
  onFinished?: (sourceId: string) => void
} = {}) {
  const r = useRecording(deps)
  const [tabWarning, setTabWarning] = useState<string | null>(null)
  const recording =
    r.screen.screenState !== 'ready' &&
    r.screen.screenState !== 'permission_prompt' &&
    r.screen.screenState !== 'permission_denied'

  // 종료가 끝나면 페이지 B로 넘긴다 (화면 계약: "즉시 페이지 B 로딩 상태로 이동")
  const finished = r.finishedSourceId
  useEffect(() => {
    if (finished) onFinished?.(finished)
  }, [finished, onFinished])

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 sm:p-10'>
      <header className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>회의 녹음</h1>
        <p className='text-muted-foreground text-sm'>
          이 화면은 녹음만 담당합니다. 이후 단계는 녹음을 마친 뒤 별도 화면에서 진행합니다.
        </p>
      </header>

      {!recording && (
        <section className='flex flex-col gap-6' aria-label='녹음 준비'>
          <CaptureModePicker mode={r.captureMode} onChange={r.setCaptureMode} />

          <div className='flex flex-col gap-3'>
            <h2 className='text-sm font-medium'>마이크</h2>
            {r.screen.screenState === 'permission_prompt' && (
              <Button
                onClick={() => {
                  // ⛔ AudioContext는 **사용자 제스처 안에서** 깨워야 한다.
                  //    밖에서 만들면 suspended로 남고 파형이 영영 평평하다.
                  void resumeAudio()
                  void r.requestMic()
                }}
                variant='outline'
                className='w-fit'
              >
                마이크 권한 요청
              </Button>
            )}
            {r.devices.length > 0 && (
              <Select
                value={r.micDeviceId ?? undefined}
                onValueChange={r.setMicDeviceId}
              >
                <SelectTrigger className='w-full max-w-sm' aria-label='마이크 장치'>
                  <SelectValue placeholder='마이크를 선택하세요' />
                </SelectTrigger>
                <SelectContent>
                  {r.devices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || '이름 없는 장치'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* 사전 level meter — 마이크와 탭을 **각각** 본다 */}
            <LevelMeter
              stream={r.micStream}
              label='마이크'
              hint='말해보세요'
              showLabel={false}
            />
          </div>

          {r.captureMode === 'online' && (
            <div className='flex flex-col gap-3'>
              <h2 className='text-sm font-medium'>탭 오디오</h2>
              <Button
                variant='outline'
                className='w-fit'
                onClick={async () => {
                  void resumeAudio()
                  const res = await r.requestTabAudio()
                  setTabWarning(
                    res.ok
                      ? null
                      : res.reason === 'no_audio'
                        ? '선택한 탭의 오디오 공유가 켜져 있지 않습니다. 공유 창에서 "탭 오디오도 공유"를 체크해 주세요.'
                        : '탭 공유가 취소되었습니다.'
                  )
                }}
              >
                {r.remoteStream ? '다른 탭 선택' : '탭 오디오 공유'}
              </Button>
              {r.remoteLabel && (
                <p className='text-muted-foreground text-xs'>공유 중: {r.remoteLabel}</p>
              )}
              {tabWarning && (
                <p className='text-state-warning text-sm' role='alert'>
                  {tabWarning}
                </p>
              )}
              <LevelMeter stream={r.remoteStream} label='탭 오디오' showLabel={false} />
            </div>
          )}

          {/* ⛔ 시작을 막는 이유를 전부 보여준다 */}
          {r.gate.blockers.length > 0 && (
            <ul className='flex flex-col gap-2' data-testid='start-blockers'>
              {r.gate.blockers.map((b) => (
                <li
                  key={b}
                  data-testid={`blocker-${b}`}
                  role='alert'
                  className='border-state-warning/40 bg-state-warning/5 flex items-start gap-2 rounded-md border p-3 text-sm'
                >
                  <AlertTriangle
                    className='text-state-warning mt-0.5 size-4 shrink-0'
                    aria-hidden
                  />
                  <span>{describeBlocker(b)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {recording && (
        <section className='flex flex-col gap-6' aria-label='녹음 중'>
          {/* ⛔ 녹음 상태와 보존 상태는 별개의 요소다 */}
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <RecordingStatus
              state={r.screen.screenState}
              elapsedLabel={r.screen.elapsedLabel}
            />
            <PreservationStatus preservation={r.screen.preservation} />
          </div>

          <TrackAlerts alerts={r.screen.trackAlerts} />

          <div className='grid gap-6 sm:grid-cols-2'>
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

          {finished && (
            /*
             * ⛔ onFinished가 없거나 이동이 실패해도 **갇히지 않는다.**
             *    예전에는 여기에 아무것도 없어서 화면이 "저장 중"에 머물렀다.
             */
            <div
              className='border-state-success/40 bg-state-success/5 flex flex-col gap-2 rounded-md border p-4'
              data-testid='recording-finished'
            >
              <p className='text-sm font-medium'>녹음이 저장되었습니다.</p>
              {/*
                ⛔ 여기서 `<Link>`를 쓰지 않는다. 이 링크는 **자동 이동이 실패했을
                   때의 탈출구**다. router에 의존하면 router가 문제일 때 탈출구도
                   같이 죽는다. (실제로 router 없이 렌더하면 `useLinkProps`가
                   던져서 이 블록 전체가 안 그려졌다.)
              */}
              <a
                href={`/meetings/${finished}`}
                className='text-sm underline underline-offset-4'
              >
                회의 열기
              </a>
            </div>
          )}

          {r.screen.screenState === 'stop_failed' && (
            <p className='text-state-danger text-sm' role='alert'>
              종료하지 못했습니다. 녹음은 이 브라우저에 남아 있으니 네트워크를 확인한 뒤
              다시 시도해 주세요.
            </p>
          )}
        </section>
      )}

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
    </div>
  )
}

function CaptureModePicker({
  mode,
  onChange,
}: {
  mode: 'in_person' | 'online'
  onChange: (m: 'in_person' | 'online') => void
}) {
  const options = [
    { value: 'in_person' as const, label: '대면 회의', icon: Users, hint: '마이크만' },
    {
      value: 'online' as const,
      label: '온라인 회의',
      icon: MonitorSpeaker,
      hint: '마이크 + 탭 오디오',
    },
  ]

  return (
    <fieldset className='flex flex-col gap-3'>
      <legend className='mb-3 text-sm font-medium'>입력 모드</legend>
      <div className='grid gap-3 sm:grid-cols-2'>
        {options.map((o) => (
          <button
            key={o.value}
            type='button'
            role='radio'
            aria-checked={mode === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
              mode === o.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted/50'
            )}
          >
            <o.icon className='mt-0.5 size-5 shrink-0' aria-hidden />
            <span className='flex flex-col'>
              <span className='text-sm font-medium'>{o.label}</span>
              <span className='text-muted-foreground text-xs'>{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
