import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CaptureSession, pickMimeType } from './capture'
import { ChunkStore } from './chunk-store'

let store: ChunkStore
let dbName: string
let n = 0
let ctx: AudioContext | null = null
let session: CaptureSession | null = null

beforeEach(async () => {
  dbName = `rat-cap-test-${Date.now()}-${n++}`
  store = new ChunkStore(dbName)
  await store.open()
})

afterEach(async () => {
  await session?.stop().catch(() => undefined)
  session = null
  await ctx?.close().catch(() => undefined)
  ctx = null
  store.close()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

/** 실제 소리가 흐르는 MediaStream */
async function toneStream(freq = 440): Promise<MediaStream> {
  const audio = ctx ?? new AudioContext()
  ctx = audio
  if (audio.state === 'suspended') await audio.resume()
  const osc = audio.createOscillator()
  osc.frequency.value = freq
  const g = audio.createGain()
  g.gain.value = 0.4
  const dest = audio.createMediaStreamDestination()
  osc.connect(g).connect(dest)
  osc.start()
  return dest.stream
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('형식 선택', () => {
  it('브라우저가 지원하는 형식을 고른다', () => {
    expect(pickMimeType()).toMatch(/^audio\//)
  })
})

describe('⛔ 조각을 로컬에 먼저 쓴다', () => {
  it('녹음하면 IndexedDB에 조각이 쌓인다', async () => {
    session = new CaptureSession('s1', store)
    session.start([{ kind: 'mic', stream: await toneStream() }])

    // 조각 길이는 5초지만 stop()이 남은 데이터를 즉시 내보낸다
    await wait(300)
    await session.stop()

    const chunks = await store.list('s1')
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].track).toBe('mic')
    expect(chunks[0].size).toBeGreaterThan(0)
  })

  it('조각마다 hash가 붙는다', async () => {
    session = new CaptureSession('s1', store)
    session.start([{ kind: 'mic', stream: await toneStream() }])
    await wait(300)
    await session.stop()

    for (const c of await store.list('s1')) {
      expect(c.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it('순번이 0부터 이어진다', async () => {
    session = new CaptureSession('s1', store)
    session.start([{ kind: 'mic', stream: await toneStream() }])
    await wait(300)
    await session.stop()

    const seqs = (await store.list('s1')).map((c) => c.seq)
    expect(seqs).toEqual(seqs.map((_, i) => i))
  })

  it('조각이 생길 때마다 알려준다 — 화면의 보존 상태가 따라간다', async () => {
    const seen: number[] = []
    session = new CaptureSession('s1', store, {
      onChunk: (i) => seen.push(i.total),
    })
    session.start([{ kind: 'mic', stream: await toneStream() }])
    await wait(300)
    await session.stop()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen).toEqual(seen.map((_, i) => i + 1))
  })
})

describe('⛔ 두 track을 동시에 다룬다 — Phase 0.4', () => {
  // 편측 시작·정지는 295ms 드리프트를 만든다. 그만큼 화자 정렬이 어긋난다.

  it('mic과 remote가 각각 저장된다', async () => {
    session = new CaptureSession('s1', store)
    session.start([
      { kind: 'mic', stream: await toneStream(440) },
      { kind: 'remote', stream: await toneStream(880) },
    ])
    await wait(300)
    await session.stop()

    const chunks = await store.list('s1')
    expect(chunks.some((c) => c.track === 'mic')).toBe(true)
    expect(chunks.some((c) => c.track === 'remote')).toBe(true)
  })

  it('종료 시 track별 조각 수를 알려준다 — finalize에서 선언할 값', async () => {
    session = new CaptureSession('s1', store)
    session.start([
      { kind: 'mic', stream: await toneStream(440) },
      { kind: 'remote', stream: await toneStream(880) },
    ])
    await wait(300)
    await session.stop()

    const counts = session.chunkCounts()
    const stored = await store.list('s1')
    expect(counts.mic).toBe(stored.filter((c) => c.track === 'mic').length)
    expect(counts.remote).toBe(stored.filter((c) => c.track === 'remote').length)
  })

  it('일시정지가 두 track에 함께 적용된다', async () => {
    session = new CaptureSession('s1', store)
    session.start([
      { kind: 'mic', stream: await toneStream(440) },
      { kind: 'remote', stream: await toneStream(880) },
    ])
    await wait(150)
    session.pause()
    const during = await store.list('s1')

    await wait(300)
    const afterPause = await store.list('s1')

    // 일시정지 중에는 양쪽 다 늘지 않는다
    expect(afterPause.length).toBe(during.length)

    session.resume()
    await wait(200)
    await session.stop()
    expect((await store.list('s1')).length).toBeGreaterThanOrEqual(during.length)
  })
})

describe('track 종료 감지', () => {
  it('⛔ 어느 track이 끝났는지 구분해서 알려준다', async () => {
    // 탭 공유 중단과 마이크 분리를 화면이 다르게 표시하려면
    // 여기서부터 구분되어 올라와야 한다.
    const ended: string[] = []
    const micStream = await toneStream(440)
    const remoteStream = await toneStream(880)

    session = new CaptureSession('s1', store, {
      onTrackEnded: (t) => ended.push(t),
    })
    session.start([
      { kind: 'mic', stream: micStream },
      { kind: 'remote', stream: remoteStream },
    ])
    await wait(100)

    // 사용자가 탭 공유를 중단한 상황
    for (const t of remoteStream.getAudioTracks()) t.stop()
    // track.stop()은 ended를 발화시키지 않으므로 직접 보낸다
    for (const t of remoteStream.getAudioTracks()) {
      t.dispatchEvent(new Event('ended'))
    }
    await wait(50)

    expect(ended).toEqual(['remote'])
  })
})

describe('종료', () => {
  it('⛔ 마지막 조각까지 저장하고 끝난다', async () => {
    session = new CaptureSession('s1', store)
    session.start([{ kind: 'mic', stream: await toneStream() }])
    await wait(200)
    await session.stop()

    // stop() 직후 바로 세도 마지막 조각이 들어 있어야 한다.
    // 안 그러면 회의 마지막 5초가 사라진다.
    const counts = session.chunkCounts()
    expect((await store.list('s1')).length).toBe(counts.mic)
  })

  it('두 번 멈춰도 안전하다', async () => {
    session = new CaptureSession('s1', store)
    session.start([{ kind: 'mic', stream: await toneStream() }])
    await wait(100)
    await session.stop()
    await expect(session.stop()).resolves.toBeUndefined()
  })

  it('종료 후 stream track이 정리된다 — 브라우저 녹음 표시가 사라진다', async () => {
    const stream = await toneStream()
    session = new CaptureSession('s1', store)
    session.start([{ kind: 'mic', stream }])
    await wait(100)
    await session.stop()

    expect(stream.getAudioTracks().every((t) => t.readyState === 'ended')).toBe(true)
  })
})
