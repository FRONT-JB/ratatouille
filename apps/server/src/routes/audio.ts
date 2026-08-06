/**
 * 오디오 재생 경로.
 *
 * ⛔ **Range를 지원한다.** 브라우저는 `<audio>`에서 어느 지점으로 가려 할 때
 *    `Range: bytes=...`를 보낸다. 전체를 200으로만 돌려주면 Chrome은 30분짜리
 *    파일을 처음부터 다시 받고, timestamp jump는 사실상 동작하지 않는다.
 *
 * ⚠️ 전체를 메모리에 올리지 않는다. 30분 녹음이 여러 탭에서 열리면 그대로
 *    수백 MB가 된다. 파일 스트림을 그대로 흘려보낸다.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import * as fs from 'node:fs/promises'
import { Hono } from 'hono'
import type { AudioPublisher } from '../audio/publisher.ts'
import { AudioUnavailableError } from '../audio/publisher.ts'
import { SourceNotFoundError, type SourceRepository } from '../sources/repository.ts'

/** `bytes=2-5` / `bytes=6-` 를 해석한다. 못 읽으면 null — 전체를 준다. */
export function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null

  const [, rawStart, rawEnd] = m
  if (!rawStart && !rawEnd) return null

  // `bytes=-500` — 끝에서 500바이트
  if (!rawStart) {
    const len = Number(rawEnd)
    if (!Number.isFinite(len) || len <= 0) return null
    return { start: Math.max(0, size - len), end: size - 1 }
  }

  const start = Number(rawStart)
  // 시작이 파일 밖이면 416이다. 전체를 주면 브라우저는 탐색이 됐다고 믿는다.
  if (!Number.isFinite(start) || start >= size) return 'unsatisfiable'

  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable'
  return { start, end }
}

export function audioRoutes(
  sources: SourceRepository,
  audio: AudioPublisher
): Hono {
  const app = new Hono()

  app.get('/:id/audio', async (c) => {
    const id = c.req.param('id')

    let filePath: string
    try {
      const src = sources.get(id)
      // 회의는 있는데 아직 조각이 다 안 모였다 — 없는 것과는 다른 사실이다
      if (src.state !== 'ready') {
        return c.json(
          {
            error: `아직 수집 중입니다 (${src.state}). 조각이 모두 확인된 뒤에 재생할 수 있습니다.`,
          },
          409
        )
      }
      filePath = await audio.ensure(id, {
        captureMode: src.manifest?.captureMode ?? 'in_person',
        chunks: sources.chunkFiles(id),
      })
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      if (e instanceof AudioUnavailableError) return c.json({ error: e.message }, 409)
      throw e
    }

    const size = (await fs.stat(filePath)).size
    const range = parseRange(c.req.header('range'), size)

    if (range === 'unsatisfiable') {
      return c.body(null, 416, {
        'content-range': `bytes */${size}`,
        'accept-ranges': 'bytes',
      })
    }

    const headers: Record<string, string> = {
      'content-type': 'audio/mp4',
      // 이게 없으면 브라우저가 탐색을 시도조차 하지 않는다
      'accept-ranges': 'bytes',
    }

    if (!range) {
      return c.body(toWeb(createReadStream(filePath)), 200, {
        ...headers,
        'content-length': String(size),
      })
    }

    return c.body(
      toWeb(createReadStream(filePath, { start: range.start, end: range.end })),
      206,
      {
        ...headers,
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'content-length': String(range.end - range.start + 1),
      }
    )
  })

  return app
}

function toWeb(stream: NodeJS.ReadableStream): ReadableStream {
  return Readable.toWeb(stream as Readable) as ReadableStream
}
