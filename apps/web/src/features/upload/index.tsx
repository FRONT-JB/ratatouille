import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, FileAudio, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ACCEPTED_AUDIO,
  INITIAL_UPLOAD,
  type UploadDeps,
  type UploadState,
  uploadFile,
} from './upload-source'

/**
 * 파일 업로드 — PLAN.md 순서 3.
 *
 * ⛔ **페이지 A(녹음)를 거치지 않고** 같은 처리 경로에 합류한다.
 *    ready가 되면 곧바로 페이지 B 로딩 상태로 보낸다.
 */
export function UploadPage({ deps }: { deps?: UploadDeps } = {}) {
  const [state, setState] = useState<UploadState>(INITIAL_UPLOAD)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const busy = state.phase === 'uploading' || state.phase === 'verifying'

  async function handle(file: File) {
    const result = await uploadFile(file, { ...deps, onProgress: setState })
    if (result.phase === 'ready' && result.sourceId) {
      // 페이지 B 로딩 상태로 이동한다. 녹음 경로와 같은 목적지다.
      void navigate({
        to: '/meetings/$meetingId',
        params: { meetingId: result.sourceId },
      })
    }
  }

  return (
    <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 sm:p-10'>
      <header className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>파일 업로드</h1>
        <p className='text-muted-foreground text-sm'>
          이미 가지고 있는 회의 음성 파일을 올립니다.
        </p>
      </header>

      <div
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border'
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) void handle(f)
        }}
        data-testid='upload-dropzone'
      >
        <FileAudio className='text-muted-foreground size-8' aria-hidden />
        <p className='text-sm'>파일을 여기에 끌어다 놓거나</p>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload /> 파일 선택
        </Button>
        <input
          ref={inputRef}
          type='file'
          accept={ACCEPTED_AUDIO.join(',')}
          className='sr-only'
          aria-label='회의 음성 파일'
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handle(f)
          }}
        />
      </div>

      {state.phase !== 'idle' && (
        <UploadProgress state={state} />
      )}
    </div>
  )
}

/**
 * ⛔ 업로드 진행률 · 서버 검증 · ready 도달을 **각각 다르게** 보여준다.
 *    하나로 뭉치면 "다 올렸는데 왜 안 넘어가지"를 사용자가 이해할 수 없다.
 */
function UploadProgress({ state }: { state: UploadState }) {
  const LABEL: Record<UploadState['phase'], string> = {
    idle: '',
    uploading: '업로드 중',
    verifying: '서버가 파일을 확인하는 중',
    ready: '준비 완료 — 전사로 넘어갑니다',
    rejected: '올릴 수 없는 파일입니다',
    failed: '업로드하지 못했습니다',
  }
  const bad = state.phase === 'rejected' || state.phase === 'failed'

  return (
    <section
      className='flex flex-col gap-3'
      data-testid='upload-progress'
      data-phase={state.phase}
      aria-live='polite'
    >
      <div className='flex items-center gap-2'>
        {bad && (
          <AlertTriangle className='text-state-danger size-4 shrink-0' aria-hidden />
        )}
        <span className={cn('text-sm font-medium', bad && 'text-state-danger')}>
          {LABEL[state.phase]}
        </span>
      </div>

      {state.phase === 'uploading' && (
        <div
          className='bg-muted h-2 w-full overflow-hidden rounded-full'
          role='progressbar'
          aria-valuenow={Math.round(state.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label='업로드 진행률'
        >
          <div
            className='bg-primary h-full rounded-full transition-[width]'
            style={{ width: `${state.progress * 100}%` }}
          />
        </div>
      )}

      {state.phase === 'uploading' && (
        <p className='text-muted-foreground text-xs tabular-nums'>
          조각 {state.sentChunks} / {state.totalChunks}
        </p>
      )}

      {state.error && (
        <p className='text-state-danger text-sm' role='alert'>
          {state.error}
        </p>
      )}

      {state.violations.length > 0 && (
        <ul className='text-muted-foreground flex flex-col gap-1 text-sm'>
          {state.violations.map((v) => (
            <li key={v}>· {v}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
