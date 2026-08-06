/**
 * source 수집 API — 녹음 조각 업로드와 상태 조회.
 *
 * 화면과 내부 상태의 매핑은 여기서 하지 않는다. 서버는 내부 상태명을 그대로
 * 내보내고, 사용자용 문구는 클라이언트가 별도 매핑 테이블로 만든다
 * (PLAN.md 순서 3 완료 조건: "사용자용 문구가 내부 상태와 명시적으로 매핑된다").
 */

import {
  type ManifestViolation,
  RuleViolationError,
  describeManifestViolation,
} from '@ratatouille/contracts'
import { Hono } from 'hono'
import { type DeleteDeps, SourceBusyError, deleteSource } from '../sources/delete.ts'
import {
  ChunkConflictError,
  type SourceRecord,
  SourceNotFoundError,
  type SourceRepository,
} from '../sources/repository.ts'

/** 내부 상태를 그대로 노출한다 — 클라이언트가 어느 객체의 상태인지 추적할 수 있어야 한다 */
function toDto(s: SourceRecord) {
  return {
    id: s.id,
    // 어느 객체의 상태인지 이름에 박아둔다. 다른 머신과 섞이지 않게.
    sourceState: s.state,
    sourceHash: s.sourceHash,
    chunkCount: s.chunks.length,
    manifest: s.manifest,
    violations: s.violations.map((v: ManifestViolation) => ({
      kind: v.kind,
      message: describeManifestViolation(v),
    })),
    canStartTranscription: s.state === 'ready',
  }
}

/**
 * ready가 된 source를 vault에 발행하는 콜백.
 *
 * 선택 사항으로 둔다. 수집 API의 테스트는 vault 없이도 돌아야 하고,
 * 발행이 실패해도 **이미 받은 조각이 사라지면 안 된다.**
 */
export type PublishFn = (src: SourceRecord) => Promise<void>

export function sourcesRoutes(
  repo: SourceRepository,
  publish?: PublishFn,
  deleteDeps?: DeleteDeps
): Hono {
  const app = new Hono()

  /** 녹음 시작 — manifest를 기록한다 (PLAN.md 순서 2) */
  app.post('/', async (c) => {
    const manifest = await c.req.json()
    if (!manifest?.sourceId) {
      return c.json({ error: 'sourceId가 필요하다' }, 400)
    }
    if (repo.has(manifest.sourceId)) {
      // 재접속 — 중복 생성하지 않고 현재 상태를 돌려준다
      return c.json(toDto(repo.get(manifest.sourceId)), 200)
    }
    return c.json(toDto(await repo.create(manifest)), 201)
  })

  app.get('/:id', (c) => {
    try {
      return c.json(toDto(repo.get(c.req.param('id'))))
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      throw e
    }
  })

  /**
   * 재개 질의 — "어디까지 받았나".
   * 클라이언트는 빠진 순번만 다시 보낸다. 전체를 다시 올리지 않는다.
   */
  app.get('/:id/missing', (c) => {
    try {
      return c.json({ missing: repo.missing(c.req.param('id')) })
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      throw e
    }
  })

  /**
   * 조각 업로드. 멱등하다.
   *
   * 본문은 raw bytes다 — base64로 감싸면 33% 부풀고, 30분 녹음이면
   * 29MB → 39MB가 된다. Hermes HTTP endpoint가 base64 25MB 제한에 걸린 이유이기도 하다.
   */
  app.put('/:id/chunks/:track/:seq', async (c) => {
    const track = c.req.param('track')
    if (track !== 'mic' && track !== 'remote') {
      return c.json({ error: `알 수 없는 track: ${track}` }, 400)
    }
    const seq = Number(c.req.param('seq'))
    if (!Number.isInteger(seq) || seq < 0) {
      return c.json({ error: '순번은 0 이상의 정수여야 한다' }, 400)
    }

    const body = new Uint8Array(await c.req.arrayBuffer())
    if (body.byteLength === 0) {
      return c.json({ error: '빈 조각은 받지 않는다' }, 400)
    }

    try {
      const r = await repo.putChunk(c.req.param('id'), { track, seq, bytes: body })
      // 재전송은 200, 새 조각은 201 — 클라이언트가 구분할 수 있게
      return c.json({ ...r, track, seq }, r.duplicate ? 200 : 201)
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      if (e instanceof ChunkConflictError) {
        // 409: 같은 순번에 다른 내용. 클라이언트가 재시도해도 소용없다.
        return c.json({ error: e.message, track, seq }, 409)
      }
      throw e
    }
  })

  /**
   * 녹음 종료 → 검증 → ready 또는 Inbox 잔류.
   *
   * 위반이 있으면 200으로 돌려주되 `sourceState`가 `finalizing`에 머문다.
   * 오류(4xx/5xx)가 아니다 — 불완전한 source도 정상적인 상태다.
   */
  app.post('/:id/finalize', async (c) => {
    try {
      // 클라이언트가 종료 시점에 조각 개수를 선언한다. 본문이 없어도 된다
      // (선언 없음은 verifyManifest가 count_undeclared로 잡는다).
      const declared = await c.req.json().catch(() => undefined)
      const src = await repo.finalize(c.req.param('id'), declared)
      if (src.state === 'ready' && publish) {
        // 발행 실패가 수집 결과를 되돌리지 않는다. source는 이미 ready이고
        // 조각도 디스크에 있다. vault 쓰기는 나중에 다시 시도할 수 있다.
        try {
          await publish(src)
        } catch (e) {
          console.error(`[sources] ${src.id} vault 발행 실패:`, e)
          return c.json({ ...toDto(src), publishError: String(e) })
        }
      }
      return c.json(toDto(src))
    } catch (e) {
      if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
      // 불변 필드를 고치려는 시도는 서버 잘못이 아니라 요청 충돌이다
      if (e instanceof RuleViolationError) {
        return c.json({ error: e.message, rule: e.rule }, 409)
      }
      throw e
    }
  })

  /**
   * 회의 삭제 — 소거가 아니라 휴지통 이동.
   *
   * ⛔ **되돌릴 수 없는 조작이므로 화면이 반드시 확인을 받는다.** 서버는 그
   *    확인을 대신해 주지 않지만, 응답에 옮긴 자리를 실어 되찾을 길을 남긴다.
   *
   * `deleteDeps`가 없으면 이 경로 자체가 열리지 않는다 — 휴지통 자리를 모르는
   * 앱이 지우기 시작하면 그게 소거다.
   */
  if (deleteDeps) {
    app.delete('/:id', async (c) => {
      try {
        return c.json(await deleteSource(c.req.param('id'), deleteDeps))
      } catch (e) {
        if (e instanceof SourceNotFoundError) return c.json({ error: e.message }, 404)
        if (e instanceof SourceBusyError) return c.json({ error: e.message }, 409)
        throw e
      }
    })
  }

  /** 불완전해서 Inbox에 남은 source들 */
  app.get('/', (c) => {
    return c.json({
      sources: repo.list().map(toDto),
      inbox: repo.inbox().map((s) => s.id),
    })
  })

  return app
}
