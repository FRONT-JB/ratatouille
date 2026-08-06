/**
 * 재생용 오디오.
 *
 * ⛔ **전사용 오디오와 다른 파일이다.** 전사용은 16kHz PCM WAV에 mic·remote를
 *    **좌/우 채널로 분리**한다 — `whisper-cli -di`가 채널로 화자를 가르기
 *    때문이다(Phase 0.5c, 98.2%). 그걸 그대로 사람에게 들려주면 한쪽 귀에서
 *    내 목소리만, 다른 귀에서 상대 목소리만 나온다. 재생용은 **섞는다.**
 *
 * ⛔ **조각을 그냥 이어 붙인 것을 내보내지 않는다.** MediaRecorder webm에는
 *    duration도 Cues도 없어서 브라우저가 **탐색을 못 한다.** timestamp를 눌러
 *    그 지점으로 가는 것이 Phase 5의 완료 조건이므로, 탐색 불가는 곧 실패다.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AudioPublisher } from '../src/audio/publisher.ts'
import { buildPlaybackArgs } from '../src/audio/args.ts'

let root: string
/** ffmpeg이 몇 번 불렸는지 — 캐시 검증에 쓴다 */
let calls: { bin: string; args: string[] }[]

function fakeFfmpeg(opts: { fail?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((bin: string, args: string[]) => {
    calls.push({ bin, args })
    const emitter = new EventEmitter() as any
    emitter.stdout = new EventEmitter()
    emitter.stderr = new EventEmitter()
    emitter.kill = () => undefined
    void (async () => {
      await Promise.resolve()
      if (opts.fail) {
        emitter.stderr.emit('data', 'ffmpeg 폭발')
        emitter.emit('close', 1)
        return
      }
      // 마지막 인자가 출력 경로다
      await writeFile(args[args.length - 1]!, 'FAKE-M4A-BYTES')
      emitter.emit('close', 0)
    })()
    return emitter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

async function chunkFile(name: string, body: string): Promise<string> {
  const p = path.join(root, name)
  await writeFile(p, body)
  return p
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rat-audio-'))
  calls = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('⛔ 재생용은 섞는다 — 전사용 채널 분리를 그대로 쓰지 않는다', () => {
  it('온라인 모드는 amix로 섞는다', () => {
    const args = buildPlaybackArgs({
      captureMode: 'online',
      micPath: '/m.raw',
      remotePath: '/r.raw',
      outPath: '/out.m4a',
    })
    expect(args.join(' ')).toContain('amix')
  })

  it('⛔ 재생용에 join(채널 분리)을 쓰지 않는다 — 한쪽 귀에 한 사람만 들린다', () => {
    const args = buildPlaybackArgs({
      captureMode: 'online',
      micPath: '/m.raw',
      remotePath: '/r.raw',
      outPath: '/out.m4a',
    })
    expect(args.join(' ')).not.toContain('join=inputs')
  })

  it('⛔ 섞기 전에 track별 음량을 맞춘다 — 안 그러면 작은 쪽이 안 들린다', () => {
    // 실측: 마이크 mean −48.7 dB vs 탭 mean −20.0 dB. 29 dB 차이를 그대로
    // 섞으면 내 목소리가 −54 dB가 되어 회의의 절반이 안 들린다.
    const args = buildPlaybackArgs({
      captureMode: 'online',
      micPath: '/m.raw',
      remotePath: '/r.raw',
      outPath: '/out.m4a',
    })
    const filter = args[args.indexOf('-filter_complex') + 1]!
    // 두 입력 **각각**에 걸려야 한다. 섞은 뒤에 걸면 이미 묻힌 소리는 안 돌아온다.
    expect(filter.match(/dynaudnorm/g)).toHaveLength(2)
    expect(filter.indexOf('dynaudnorm')).toBeLessThan(filter.indexOf('amix'))
  })

  it('대면 모드는 track이 하나라 섞을 것이 없다', () => {
    const args = buildPlaybackArgs({
      captureMode: 'in_person',
      micPath: '/m.raw',
      outPath: '/out.m4a',
    })
    expect(args.join(' ')).not.toContain('amix')
    expect(args).toContain('/m.raw')
  })

  it('온라인인데 탭 조각이 없으면 있는 것만 쓴다 — 재생은 막지 않는다', () => {
    // 전사는 상대 목소리가 없으면 거부한다. 재생은 다르다 —
    // 내 목소리라도 들려주는 편이 아무것도 못 듣는 것보다 낫다.
    const args = buildPlaybackArgs({
      captureMode: 'online',
      micPath: '/m.raw',
      remotePath: null,
      outPath: '/out.m4a',
    })
    expect(args.join(' ')).not.toContain('amix')
  })
})

describe('⛔ 탐색할 수 있는 형식으로 만든다', () => {
  it('faststart로 moov를 앞에 둔다 — 없으면 전체를 받기 전에는 탐색이 안 된다', () => {
    const args = buildPlaybackArgs({
      captureMode: 'in_person',
      micPath: '/m.raw',
      outPath: '/out.m4a',
    })
    expect(args.join(' ')).toContain('faststart')
  })

  it('⛔ 조각 원본을 그대로 내보내지 않는다 — 재인코딩한다', () => {
    const args = buildPlaybackArgs({
      captureMode: 'in_person',
      micPath: '/m.raw',
      outPath: '/out.m4a',
    })
    // `-c:a copy`면 webm 컨테이너 문제를 그대로 물려받는다
    expect(args.join(' ')).not.toContain('copy')
  })
})

describe('만들고 캐시한다', () => {
  const publisher = () =>
    new AudioPublisher({
      cacheRoot: path.join(root, 'cache'),
      workRoot: path.join(root, 'work'),
      spawnFn: fakeFfmpeg(),
    })

  it('조각에서 재생용 파일을 만든다', async () => {
    const mic = await chunkFile('c0.webm', 'aaa')
    const out = await publisher().ensure('src_01', {
      captureMode: 'in_person',
      chunks: { mic: [mic] },
    })

    expect(await readFile(out, 'utf8')).toBe('FAKE-M4A-BYTES')
    expect(calls).toHaveLength(1)
  })

  it('⛔ 두 번째 재생에서 다시 인코딩하지 않는다 — 30분 녹음이면 매번 기다린다', async () => {
    const mic = await chunkFile('c0.webm', 'aaa')
    const p = publisher()
    await p.ensure('src_01', { captureMode: 'in_person', chunks: { mic: [mic] } })
    await p.ensure('src_01', { captureMode: 'in_person', chunks: { mic: [mic] } })

    expect(calls).toHaveLength(1)
  })

  it('동시에 두 번 요청해도 한 번만 인코딩한다', async () => {
    const mic = await chunkFile('c0.webm', 'aaa')
    const p = publisher()
    await Promise.all([
      p.ensure('src_01', { captureMode: 'in_person', chunks: { mic: [mic] } }),
      p.ensure('src_01', { captureMode: 'in_person', chunks: { mic: [mic] } }),
    ])

    expect(calls).toHaveLength(1)
  })

  it('조각이 없으면 던진다 — 빈 파일을 재생 가능한 척하지 않는다', async () => {
    await expect(
      publisher().ensure('src_01', { captureMode: 'in_person', chunks: { mic: [] } })
    ).rejects.toThrow()
  })

  it('⛔ ffmpeg이 실패하면 반쪽 파일을 캐시에 남기지 않는다', async () => {
    const mic = await chunkFile('c0.webm', 'aaa')
    const p = new AudioPublisher({
      cacheRoot: path.join(root, 'cache'),
      workRoot: path.join(root, 'work'),
      spawnFn: fakeFfmpeg({ fail: true }),
    })

    await expect(
      p.ensure('src_01', { captureMode: 'in_person', chunks: { mic: [mic] } })
    ).rejects.toThrow()

    // 다음 요청이 캐시된 쓰레기를 재생하면 원인을 찾을 수 없다
    await expect(stat(path.join(root, 'cache/src_01.m4a'))).rejects.toThrow()
  })
})
