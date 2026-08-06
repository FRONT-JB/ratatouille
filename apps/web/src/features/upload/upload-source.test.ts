import { describe, expect, it } from 'vitest'
import {
  buildUploadManifest,
  chunkCountFor,
  isAcceptedAudio,
  uploadFile,
} from './upload-source'

const audio = (name = 'meeting.mp3', size = 5000, type = 'audio/mpeg') =>
  new File([new Uint8Array(size)], name, { type })

type Call = { method: string; url: string }

function server(over: { finalize?: unknown; chunkStatus?: number; createStatus?: number } = {}) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url })
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    if (url.endsWith('/api/sources')) {
      return json({}, over.createStatus ?? 201)
    }
    if (url.includes('/chunks/')) {
      return json({}, over.chunkStatus ?? 201)
    }
    return json(over.finalize ?? { sourceState: 'ready' })
  }
  return { calls, fetchFn }
}

describe('파일 종류 판별', () => {
  it.each(['audio/mpeg', 'audio/wav', 'audio/webm'])('%s를 받는다', (type) => {
    expect(isAcceptedAudio({ type, name: 'a' })).toBe(true)
  })

  it('브라우저가 type을 못 채워도 확장자로 받는다', () => {
    expect(isAcceptedAudio({ type: '', name: '회의.m4a' })).toBe(true)
  })

  it('오디오가 아니면 거부한다', () => {
    expect(isAcceptedAudio({ type: 'application/pdf', name: 'a.pdf' })).toBe(false)
  })
})

describe('조각 나누기', () => {
  it('크기에 맞춰 개수를 정한다', () => {
    expect(chunkCountFor(10, 4)).toBe(3)
  })

  it('작은 파일도 최소 하나다', () => {
    expect(chunkCountFor(1, 1024)).toBe(1)
  })
})

describe('manifest', () => {
  it('파일 이름을 장치 라벨에 남긴다 — 어디서 왔는지 알 수 있어야 한다', () => {
    const m = buildUploadManifest({
      sourceId: 'up_1',
      fileName: '회의.mp3',
      startedAt: 'T',
    })
    expect(m.devices.mic).toContain('회의.mp3')
  })

  it('⛔ 업로드 파일에 화자 분리를 켜지 않는다', () => {
    // -di는 스테레오 2track 녹음에만 의미가 있다. 업로드 파일이 그런 구조라는
    // 보장이 없고, 잘못 켜면 없는 화자를 만들어낸다.
    const m = buildUploadManifest({ sourceId: 'up_1', fileName: 'a.mp3', startedAt: 'T' })
    expect(m.captureMode).toBe('in_person')
    expect(m.tracks).toEqual(['mic'])
  })

  it('조각 길이를 0으로 둔다 — 시간이 아니라 바이트로 자른다', () => {
    expect(
      buildUploadManifest({ sourceId: 'up_1', fileName: 'a.mp3', startedAt: 'T' })
        .chunkDurationMs
    ).toBe(0)
  })
})

describe('⛔ 녹음과 같은 수집 경로를 탄다', () => {
  it('같은 chunk API로 올린다', async () => {
    const { calls, fetchFn } = server()
    await uploadFile(audio('a.mp3', 10), { fetch: fetchFn, chunkBytes: 4 })

    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => c.url)).toEqual([
      expect.stringContaining('/chunks/mic/0'),
      expect.stringContaining('/chunks/mic/1'),
      expect.stringContaining('/chunks/mic/2'),
    ])
  })

  it('manifest로 source를 먼저 연다', async () => {
    const { calls, fetchFn } = server()
    await uploadFile(audio(), { fetch: fetchFn })
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/sources' })
  })

  it('종료 시 조각 수를 선언한다', async () => {
    const { calls, fetchFn } = server()
    await uploadFile(audio('a.mp3', 10), { fetch: fetchFn, chunkBytes: 4 })
    expect(calls.at(-1)?.url).toContain('/finalize')
  })
})

describe('⛔ 업로드 완료와 ready를 구분한다 — 완료 조건 2', () => {
  it('업로드 중에는 uploading이다', async () => {
    const seen: string[] = []
    const { fetchFn } = server()
    await uploadFile(audio('a.mp3', 10), {
      fetch: fetchFn,
      chunkBytes: 4,
      onProgress: (s) => seen.push(s.phase),
    })
    expect(seen).toContain('uploading')
  })

  it('⛔ 마지막 조각을 보낸 뒤 verifying을 거친다', async () => {
    // 조각을 다 보냈다고 ready가 아니다. 서버가 검증해야 한다.
    const seen: string[] = []
    const { fetchFn } = server()
    await uploadFile(audio(), { fetch: fetchFn, onProgress: (s) => seen.push(s.phase) })
    expect(seen.indexOf('verifying')).toBeGreaterThan(seen.indexOf('uploading'))
    expect(seen.indexOf('ready')).toBeGreaterThan(seen.indexOf('verifying'))
  })

  it('검증을 통과해야 ready다', async () => {
    const { fetchFn } = server()
    expect((await uploadFile(audio(), { fetch: fetchFn })).phase).toBe('ready')
  })

  it('⛔ 서버 검증에 실패하면 ready가 아니다', async () => {
    const { fetchFn } = server({
      finalize: {
        sourceState: 'finalizing',
        violations: [{ message: 'mic: 순번 2가 빠졌다' }],
      },
    })
    const s = await uploadFile(audio(), { fetch: fetchFn })
    expect(s.phase).toBe('failed')
    expect(s.violations).toEqual(['mic: 순번 2가 빠졌다'])
  })

  it('진행률은 업로드만의 값이다', async () => {
    const seen: number[] = []
    const { fetchFn } = server()
    await uploadFile(audio('a.mp3', 12), {
      fetch: fetchFn,
      chunkBytes: 4,
      onProgress: (s) => {
        if (s.phase === 'uploading') seen.push(s.progress)
      },
    })
    expect(seen.at(-1)).toBe(1)
  })
})

describe('거부와 실패', () => {
  it('오디오가 아니면 올리지 않는다', async () => {
    const { calls, fetchFn } = server()
    const s = await uploadFile(
      new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }),
      { fetch: fetchFn }
    )
    expect(s.phase).toBe('rejected')
    expect(calls).toEqual([])
  })

  it('빈 파일을 거부한다', async () => {
    const { fetchFn } = server()
    const s = await uploadFile(audio('a.mp3', 0), { fetch: fetchFn })
    expect(s.phase).toBe('rejected')
    expect(s.error).toMatch(/빈 파일/)
  })

  it('조각 업로드가 깨지면 실패한다', async () => {
    const { fetchFn } = server({ chunkStatus: 500 })
    const s = await uploadFile(audio(), { fetch: fetchFn })
    expect(s.phase).toBe('failed')
    expect(s.error).toMatch(/500/)
  })

  it('source를 못 열면 실패한다', async () => {
    const { fetchFn } = server({ createStatus: 500 })
    const s = await uploadFile(audio(), { fetch: fetchFn })
    expect(s.phase).toBe('failed')
  })

  it('네트워크 오류를 삼키지 않는다', async () => {
    const s = await uploadFile(audio(), {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(s.phase).toBe('failed')
    expect(s.error).toMatch(/fetch/)
  })
})
