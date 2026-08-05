import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkStore } from './chunk-store'
import { ChunkUploader, ChunkRejectedError } from './uploader'

let store: ChunkStore
let dbName: string
let n = 0
let calls: Array<{ method: string; url: string }>

beforeEach(async () => {
  dbName = `rat-up-test-${Date.now()}-${n++}`
  store = new ChunkStore(dbName)
  await store.open()
  calls = []
})

afterEach(async () => {
  store.close()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

const blob = (fill: number) => new Blob([new Uint8Array(32).fill(fill)])

/** 서버를 흉내낸다. 어떤 요청이 왔는지 기록한다. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url })
    return handler(url, init)
  }
}

const ok = (body: unknown = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

async function seed(seqs: number[]) {
  for (const seq of seqs) {
    await store.put({ sourceId: 's1', track: 'mic', seq, blob: blob(seq + 1) })
  }
}

describe('업로드', () => {
  it('대기 중인 조각을 순서대로 올린다', async () => {
    await seed([0, 1, 2])
    const up = new ChunkUploader(store, { fetch: fakeFetch(() => ok({ seq: 0 }, 201)) })

    await up.flush('s1')

    expect(calls.map((c) => c.url)).toEqual([
      '/api/sources/s1/chunks/mic/0',
      '/api/sources/s1/chunks/mic/1',
      '/api/sources/s1/chunks/mic/2',
    ])
  })

  it('올린 조각을 업로드됨으로 표시한다', async () => {
    await seed([0, 1])
    const up = new ChunkUploader(store, { fetch: fakeFetch(() => ok({}, 201)) })

    await up.flush('s1')

    expect(await store.counts('s1')).toEqual({ persisted: 2, uploaded: 2 })
  })

  it('이미 올린 조각은 다시 보내지 않는다', async () => {
    await seed([0, 1])
    const up = new ChunkUploader(store, { fetch: fakeFetch(() => ok({}, 201)) })
    await up.flush('s1')
    calls = []

    await up.flush('s1')

    expect(calls).toEqual([])
  })

  it('서버가 duplicate라고 답해도 성공으로 친다 — 재전송은 정상이다', async () => {
    await seed([0])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => ok({ duplicate: true }, 200)),
    })

    await up.flush('s1')

    expect((await store.pending('s1')).length).toBe(0)
  })
})

describe('⛔ 실패해도 로컬 조각을 버리지 않는다', () => {
  it('네트워크가 끊기면 대기 상태로 남는다', async () => {
    await seed([0, 1])
    const up = new ChunkUploader(store, {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      retries: 0,
    })

    const r = await up.flush('s1')

    expect(r.uploaded).toBe(0)
    expect(r.failed).toBe(1) // 첫 실패에서 멈춘다 — 순서를 지킨다
    expect((await store.pending('s1')).length).toBe(2)
  })

  it('네트워크가 돌아오면 이어서 올린다', async () => {
    await seed([0, 1])
    let online = false
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => {
        if (!online) throw new TypeError('Failed to fetch')
        return ok({}, 201)
      }),
      retries: 0,
    })

    await up.flush('s1')
    online = true
    await up.flush('s1')

    expect(await store.counts('s1')).toEqual({ persisted: 2, uploaded: 2 })
  })

  it('5xx는 재시도한다', async () => {
    await seed([0])
    let attempts = 0
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => {
        attempts++
        return attempts < 3 ? ok({ error: 'boom' }, 503) : ok({}, 201)
      }),
      retries: 3,
      backoffMs: 0,
    })

    await up.flush('s1')

    expect(attempts).toBe(3)
    expect((await store.pending('s1')).length).toBe(0)
  })

  it('⛔ 순서를 건너뛰지 않는다 — 앞 조각이 실패하면 뒤를 올리지 않는다', async () => {
    // 서버의 재개 질의(`missing`)는 순번 기반이다. 구멍을 내면서 올리면
    // 무엇이 빠졌는지 판단이 복잡해지고, 부분 업로드를 완료로 오인할 수 있다.
    await seed([0, 1, 2])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch((url) => {
        if (url.endsWith('/1')) return ok({ error: 'boom' }, 503)
        return ok({}, 201)
      }),
      retries: 0,
    })

    await up.flush('s1')

    expect(calls.map((c) => c.url)).toEqual([
      '/api/sources/s1/chunks/mic/0',
      '/api/sources/s1/chunks/mic/1',
    ])
    expect((await store.pending('s1')).map((c) => c.seq)).toEqual([1, 2])
  })
})

describe('⛔ 409는 재시도하지 않는다', () => {
  it('같은 순번에 다른 내용이라는 응답은 즉시 실패다', async () => {
    // 재시도해봐야 결과가 같다. 데이터 오염이므로 사람이 봐야 한다.
    await seed([0])
    let attempts = 0
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => {
        attempts++
        return ok({ error: '충돌' }, 409)
      }),
      retries: 5,
      backoffMs: 0,
    })

    await expect(up.flush('s1')).rejects.toThrow(ChunkRejectedError)
    expect(attempts).toBe(1)
  })

  it('400도 재시도하지 않는다', async () => {
    await seed([0])
    let attempts = 0
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => {
        attempts++
        return ok({ error: '잘못된 요청' }, 400)
      }),
      retries: 5,
      backoffMs: 0,
    })

    await expect(up.flush('s1')).rejects.toThrow(ChunkRejectedError)
    expect(attempts).toBe(1)
  })
})

describe('재개 — 서버에 무엇이 있는지 물어본다', () => {
  it('서버가 이미 가진 조각은 다시 올리지 않는다', async () => {
    // 탭이 죽었다 살아나면 로컬 `uploaded` 표시가 서버 실제와 어긋날 수 있다.
    await seed([0, 1, 2])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch((url) => {
        if (url.endsWith('/missing')) return ok({ missing: { mic: [2] } })
        return ok({}, 201)
      }),
    })

    await up.resume('s1')

    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => c.url)).toEqual(['/api/sources/s1/chunks/mic/2'])
  })

  it('서버가 아무것도 못 받았으면 전부 올린다', async () => {
    await seed([0, 1])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch((url) => {
        if (url.endsWith('/missing')) return ok({ missing: { mic: [0, 1] } })
        return ok({}, 201)
      }),
    })

    await up.resume('s1')

    expect(calls.filter((c) => c.method === 'PUT').length).toBe(2)
  })

  it('로컬에 없는 조각을 서버가 요구하면 그 사실을 알려준다', async () => {
    // 복구 불가능한 구멍이다. 조용히 finalize하면 불완전한 녹음이 ready가 된다.
    await seed([0])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch((url) => {
        if (url.endsWith('/missing')) return ok({ missing: { mic: [0, 1, 2] } })
        return ok({}, 201)
      }),
    })

    const r = await up.resume('s1')

    expect(r.unrecoverable).toEqual([{ track: 'mic', seq: 1 }, { track: 'mic', seq: 2 }])
  })
})

describe('진행 상황 보고', () => {
  it('조각마다 알려준다 — 화면의 보존 상태가 따라간다', async () => {
    await seed([0, 1, 2])
    const seen: number[] = []
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => ok({}, 201)),
      onProgress: (p) => seen.push(p.uploaded),
    })

    await up.flush('s1')

    expect(seen).toEqual([1, 2, 3])
  })
})

describe('종료', () => {
  it('남은 조각을 다 올린 뒤 finalize한다', async () => {
    await seed([0, 1])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch((url) =>
        url.endsWith('/finalize') ? ok({ sourceState: 'ready' }) : ok({}, 201)
      ),
    })

    const r = await up.finalize('s1', { mic: 2 })

    expect(calls.at(-1)?.url).toBe('/api/sources/s1/finalize')
    expect(r.sourceState).toBe('ready')
  })

  it('⛔ 올리지 못한 조각이 있으면 finalize하지 않는다', async () => {
    await seed([0, 1])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch((url) => {
        if (url.endsWith('/1')) throw new TypeError('Failed to fetch')
        return ok({}, 201)
      }),
      retries: 0,
    })

    await expect(up.finalize('s1', { mic: 2 })).rejects.toThrow(/업로드/)
    expect(calls.some((c) => c.url.endsWith('/finalize'))).toBe(false)
  })

  it('expectedChunks를 함께 보낸다 — 서버가 완결성을 검증할 근거', async () => {
    await seed([0, 1])
    let sent: unknown = null
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(async (url, init) => {
        if (url.endsWith('/finalize')) {
          sent = init?.body ? JSON.parse(init.body as string) : null
          return ok({ sourceState: 'ready' })
        }
        return ok({}, 201)
      }),
    })

    await up.finalize('s1', { mic: 2 })

    expect(sent).toEqual({ expectedChunks: { mic: 2 } })
  })
})

describe('녹음 시작', () => {
  it('manifest를 서버에 보내 source를 연다', async () => {
    const up = new ChunkUploader(store, { fetch: fakeFetch(() => ok({}, 201)) })
    const m = {
      sourceId: 's1',
      captureMode: 'in_person' as const,
      startedAt: 'T',
      devices: { mic: '마이크' },
      tracks: ['mic' as const],
      expectedChunks: {},
      pauses: [],
      chunkDurationMs: 5000,
    }

    await up.start(m)

    expect(calls[0]).toEqual({ method: 'POST', url: '/api/sources' })
  })

  it('⛔ 서버가 죽어 있어도 녹음을 막지 않는다', async () => {
    // 로컬 우선이다. source를 못 열어도 조각은 IndexedDB에 쌓이고
    // 나중에 resume으로 따라잡는다. 여기서 던지면 녹음 자체가 시작되지 않는다.
    const up = new ChunkUploader(store, {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      retries: 0,
    })

    await expect(
      up.start({
        sourceId: 's1',
        captureMode: 'in_person',
        startedAt: 'T',
        devices: {},
        tracks: ['mic'],
        expectedChunks: {},
        pauses: [],
        chunkDurationMs: 5000,
      })
    ).resolves.toMatchObject({ serverReady: false })
  })
})

describe('취소', () => {
  it('중단하면 남은 조각을 올리지 않는다', async () => {
    await seed([0, 1, 2])
    const up = new ChunkUploader(store, {
      fetch: fakeFetch(() => ok({}, 201)),
    })
    const spy = vi.fn()
    up.abort()

    await up.flush('s1').catch(spy)

    expect(calls.length).toBe(0)
  })
})
