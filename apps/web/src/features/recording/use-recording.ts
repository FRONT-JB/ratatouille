/**
 * 녹음 화면의 상태와 부수 효과를 한 곳에 모은다.
 *
 * 판단은 전부 순수 모듈에 있다(`start-gate`·`screen-state`). 여기서는
 * 브라우저 API를 부르고 그 결과를 그 모듈들에 넘길 뿐이다. 그래서 8종 화면
 * 상태와 gate 규칙은 브라우저 없이도 전부 검증된다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureMode, TrackKind } from '@ratatouille/contracts'
import { CaptureSession } from './capture'
import { ChunkStore, requestPersistentStorage } from './chunk-store'
import {
  type RecordingInput,
  type RecordingPhase,
  type TrackHealth,
  deriveScreen,
} from './screen-state'
import {
  type MicPermission,
  type StartSelection,
  buildManifest,
  canStartRecording,
} from './start-gate'
import { ChunkUploader } from './uploader'

export type RecordingDeps = {
  store?: ChunkStore
  uploader?: ChunkUploader
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  getDisplayMedia?: (c: DisplayMediaStreamOptions) => Promise<MediaStream>
  newSourceId?: () => string
  now?: () => number
}

export function useRecording(deps: RecordingDeps = {}) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('in_person')
  const [micPermission, setMicPermission] = useState<MicPermission>('prompt')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [remoteLabel, setRemoteLabel] = useState<string | null>(null)

  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [tracks, setTracks] = useState<Record<'mic' | 'remote', TrackHealth>>({
    mic: 'live',
    remote: 'absent',
  })
  const [elapsedMs, setElapsedMs] = useState(0)
  const [counts, setCounts] = useState({ captured: 0, persisted: 0, uploaded: 0 })
  const [storagePersisted, setStoragePersisted] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  /** 종료까지 끝난 source. 이 값이 서면 화면은 더 이상 "저장 중"이 아니다. */
  const [finishedSourceId, setFinishedSourceId] = useState<string | null>(null)

  const sessionRef = useRef<CaptureSession | null>(null)
  const storeRef = useRef<ChunkStore | null>(deps.store ?? null)
  const uploaderRef = useRef<ChunkUploader | null>(deps.uploader ?? null)
  const startedAtRef = useRef<number>(0)
  const pausedAccumRef = useRef<number>(0)
  const pausedAtRef = useRef<number | null>(null)

  // 매 렌더마다 새 함수가 생기면 아래 useCallback들이 전부 다시 만들어진다
  const now = useMemo(() => deps.now ?? (() => Date.now()), [deps.now])
  const gum = useMemo(
    () => deps.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)),
    [deps.getUserMedia]
  )
  const gdm = useMemo(
    () =>
      deps.getDisplayMedia ??
      ((c: DisplayMediaStreamOptions) => navigator.mediaDevices.getDisplayMedia(c)),
    [deps.getDisplayMedia]
  )

  const micDeviceLabel = useMemo(
    () => devices.find((d) => d.deviceId === micDeviceId)?.label ?? null,
    [devices, micDeviceId]
  )

  const selection: StartSelection = useMemo(
    () => ({
      captureMode,
      micDeviceId,
      micDeviceLabel,
      micPermission,
      remoteTrackSelected: remoteStream !== null,
      remoteTrackLabel: remoteLabel,
    }),
    [captureMode, micDeviceId, micDeviceLabel, micPermission, remoteStream, remoteLabel]
  )

  const gate = canStartRecording(selection)

  const input: RecordingInput = {
    phase,
    micPermission,
    tracks,
    elapsedMs,
    chunksCaptured: counts.captured,
    chunksPersisted: counts.persisted,
    chunksUploaded: counts.uploaded,
    storagePersisted,
    startBlocked: !gate.canStart,
    stopError,
  }
  const screen = deriveScreen(input)

  /** 마이크 권한을 **사용자 조작으로만** 요청한다. 자동 시작 금지. */
  const requestMic = useCallback(async () => {
    try {
      const stream = await gum({ audio: true })
      setMicStream(stream)
      setMicPermission('granted')
      // 권한을 받아야 장치 라벨이 채워진다
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list.filter((d) => d.kind === 'audioinput')
      setDevices(inputs)
      setMicDeviceId((cur) => cur ?? inputs[0]?.deviceId ?? null)
      setStoragePersisted(await requestPersistentStorage())
    } catch {
      setMicPermission('denied')
    }
  }, [gum])

  /** 탭 오디오 공유. 온라인 모드에서만 의미가 있다. */
  const requestTabAudio = useCallback(async () => {
    try {
      const stream = await gdm({ video: true, audio: true })
      const audio = stream.getAudioTracks()
      if (audio.length === 0) {
        // 사용자가 "탭 오디오 공유"를 켜지 않고 화면만 공유한 경우.
        // 조용히 통과시키면 상대방 목소리 없는 녹음이 된다.
        for (const t of stream.getTracks()) t.stop()
        setRemoteStream(null)
        setRemoteLabel(null)
        return { ok: false as const, reason: 'no_audio' as const }
      }
      // 비디오는 필요 없다 — 오디오만 남기고 끈다
      for (const t of stream.getVideoTracks()) t.stop()
      setRemoteStream(new MediaStream(audio))
      setRemoteLabel(audio[0]?.label || '공유한 탭')
      return { ok: true as const }
    } catch {
      return { ok: false as const, reason: 'cancelled' as const }
    }
  }, [gdm])

  const start = useCallback(async () => {
    if (!gate.canStart || !micStream) return

    const id = deps.newSourceId?.() ?? `src_${now().toString(36)}`
    const manifest = buildManifest(selection, {
      sourceId: id,
      startedAt: new Date(now()).toISOString(),
    })

    const store = storeRef.current ?? new ChunkStore()
    if (!storeRef.current) {
      await store.open()
      storeRef.current = store
    }
    const uploader = uploaderRef.current ?? new ChunkUploader(store)
    uploaderRef.current = uploader

    // 서버가 죽어 있어도 녹음은 시작한다 — 조각은 로컬에 쌓인다
    await uploader.start(manifest)

    const session = new CaptureSession(id, store, {
      onChunk: () => {
        void store.counts(id).then((c) => {
          setCounts((prev) => ({ ...prev, ...c, captured: c.persisted }))
        })
        void uploader.flush(id).then(() => {
          void store.counts(id).then((c) =>
            setCounts((prev) => ({ ...prev, ...c, captured: c.persisted }))
          )
        })
      },
      onTrackEnded: (t) => setTracks((prev) => ({ ...prev, [t]: 'lost' })),
    })

    const capture = [{ kind: 'mic' as TrackKind, stream: micStream }]
    if (remoteStream) capture.push({ kind: 'remote' as TrackKind, stream: remoteStream })

    sessionRef.current = session
    setSourceId(id)
    setTracks({ mic: 'live', remote: remoteStream ? 'live' : 'absent' })
    startedAtRef.current = now()
    pausedAccumRef.current = 0
    pausedAtRef.current = null
    setPhase('recording')
    session.start(capture)
  }, [gate.canStart, micStream, remoteStream, selection, deps, now])

  const pause = useCallback(() => {
    sessionRef.current?.pause()
    pausedAtRef.current = now()
    setPhase('paused')
  }, [now])

  const resume = useCallback(() => {
    sessionRef.current?.resume()
    if (pausedAtRef.current !== null) {
      pausedAccumRef.current += now() - pausedAtRef.current
      pausedAtRef.current = null
    }
    setPhase('recording')
  }, [now])

  /**
   * 녹음을 끝낸다.
   *
   * ⛔ **성공하면 `finishedSourceId`를 세운다.** 예전에는 `phase`를 `stopping`으로
   *    바꾸고 끝이라, 서버가 이미 `ready`인데도 화면이 "저장 중"에 영원히 갇혔다.
   *    화면 계약은 "녹음 종료 후 **즉시 페이지 B 로딩 상태로 이동**"이다.
   */
  const stop = useCallback(async () => {
    const session = sessionRef.current
    const uploader = uploaderRef.current
    if (!session || !sourceId) return

    setPhase('stopping')
    setStopError(null)
    try {
      await session.stop()
      await uploader?.finalize(sourceId, session.chunkCounts())
      sessionRef.current = null
      setFinishedSourceId(sourceId)
      return { ok: true as const, sourceId }
    } catch (e) {
      // 실패해도 조각은 로컬에 남아 있다. 그 사실을 문구에 담는다.
      setStopError(e instanceof Error ? e.message : String(e))
      return { ok: false as const, sourceId }
    }
  }, [sourceId])

  // 경과 시간. 일시정지 구간은 빼고 센다.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => {
      setElapsedMs(now() - startedAtRef.current - pausedAccumRef.current)
    }, 250)
    return () => clearInterval(id)
  }, [phase, now])

  // 컴포넌트가 사라져도 마이크가 켜져 있으면 안 된다
  useEffect(() => {
    return () => {
      for (const s of [micStream, remoteStream]) {
        for (const t of s?.getTracks() ?? []) t.stop()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    screen,
    gate,
    selection,
    captureMode,
    setCaptureMode,
    devices,
    micDeviceId,
    setMicDeviceId,
    micStream,
    remoteStream,
    remoteLabel,
    sourceId,
    finishedSourceId,
    requestMic,
    requestTabAudio,
    start,
    pause,
    resume,
    stop,
  }
}
