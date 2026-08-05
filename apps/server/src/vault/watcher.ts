/**
 * vault 외부 변경 감시 — technical-foundation.md 9절.
 *
 *   "file watcher와 주기 scan으로 외부 변경을 찾는다."
 *
 * 둘 다 필요한 이유: `fs.watch`의 **전달 시점에 상한이 없다.**
 *
 * 실측(2026-08-06, macOS 25.3 / APFS / Node 24):
 *   - 유실은 없었다. 300개 파일을 연달아 써도 300개 이벤트가 전부 왔고,
 *     CPU를 점유한 상태에서도 같았다.
 *   - 그러나 **지연은 컸다.** 테스트를 병렬로 돌려 I/O가 몰리면 단일 이벤트가
 *     5초 안에 오지 않는 경우가 5회 중 2회 재현됐다.
 *
 * 그래서 `fs.watch`는 **빠른 경로일 뿐**이고, 인덱스가 vault와 같아진다는 보장은
 * 전적으로 주기 scan이 진다. 어느 기능도 watch 이벤트의 도착을 전제하면 안 된다.
 * 서버가 꺼져 있는 동안의 편집은 애초에 이벤트가 없다 — `start()`가 즉시 scan한다.
 *
 * 이 파일은 vault에 없는 정보를 만들지 않는다. 무엇이 바뀌었는지는
 * 전부 **디스크의 content hash와 인덱스의 content hash 차이**로 판정한다.
 * 그래서 누가 썼는지(앱인지 사람인지)를 추적할 필요가 없다.
 */

import { type FSWatcher, watch } from 'node:fs'
import * as path from 'node:path'
import type { VaultIndex } from '../index-db/indexer.ts'
import type { VaultStore } from './store.ts'

export type ChangeKind = 'created' | 'updated' | 'deleted'

export type VaultChange = {
  path: string
  kind: ChangeKind
  /** 무엇이 이 변경을 발견했는지. watch가 놓친 양을 관측하기 위해 남긴다 */
  origin: 'watch' | 'scan'
}

export type ChangeListener = (changes: VaultChange[]) => void

/**
 * 색인 대상인지 판별한다.
 *
 * ⛔ `VaultStore.write()`는 원자성을 위해 **같은 디렉토리에** `<파일>.<uuid>.tmp`를
 *    만들고 rename한다. 충돌 시에는 `<파일>.conflict`를 남긴다. 이것들을 색인하면
 *    쓰다 만 문서가 들어오거나 같은 id가 두 경로에 생긴다.
 *    확장자가 정확히 `.md`인 것만 통과시켜 둘 다 걸러낸다.
 */
export function isIndexable(relPath: string): boolean {
  if (!relPath.endsWith('.md')) return false
  // 숨김 파일·숨김 디렉토리(.obsidian, .git, .DS_Store, 에디터 스왑 파일)
  return !relPath.split('/').some((seg) => seg.startsWith('.'))
}

export type WatcherOptions = {
  /** 이벤트 폭주를 모아서 처리하는 간격 */
  debounceMs?: number
  /** 주기 scan 간격. 0이면 끈다 */
  scanIntervalMs?: number
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private readonly pending = new Set<string>()
  /** 색인 갱신을 직렬화한다 — watch와 scan이 같은 파일을 동시에 잡는 것을 막는다 */
  private queue: Promise<void> = Promise.resolve()
  /**
   * `stop()`이 불릴 때마다 오른다. 진행 중이던 비동기 작업을 취소하는 데 쓴다.
   * scan은 디렉토리를 다 훑는 동안 await가 여러 번 걸리므로, 이게 없으면
   * stop() 뒤에도 남은 작업이 계속 색인을 고치고 이벤트를 낸다.
   */
  private generation = 0
  /**
   * 진행 중인 scan·flush. `stop()`이 기다린다.
   *
   * ⛔ 기다리지 않으면 `stop()` 뒤에 `index.close()`가 실행되고, 그 사이 남아
   *    있던 scan이 닫힌 DB를 건드려 "database connection is not open"으로 죽는다.
   *    scan은 파일을 하나씩 읽으며 await가 여러 번 걸리므로 창이 넓다.
   */
  private inFlight: Promise<unknown> = Promise.resolve()
  private readonly listeners: ChangeListener[] = []
  private readonly debounceMs: number
  private readonly scanIntervalMs: number

  constructor(
    private readonly vault: VaultStore,
    private readonly index: VaultIndex,
    opts: WatcherOptions = {}
  ) {
    this.debounceMs = opts.debounceMs ?? 150
    this.scanIntervalMs = opts.scanIntervalMs ?? 30_000
  }

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener)
  }

  /**
   * 감시를 시작한다.
   *
   * 시작 즉시 한 번 scan한다. 서버가 꺼져 있는 동안 사용자가 Obsidian으로
   * 고친 파일은 이벤트가 오지 않으므로, scan하지 않으면 영영 반영되지 않는다.
   */
  start(): void {
    if (this.watcher) return // 두 번 걸면 같은 변경이 두 번 보고된다

    this.watcher = watch(
      this.vault.root,
      { recursive: true },
      (_event, filename) => {
        if (!filename) return
        this.enqueue(normalizeRel(filename))
      }
    )

    if (this.scanIntervalMs > 0) {
      this.scanTimer = setInterval(() => {
        void this.scanNow()
      }, this.scanIntervalMs)
      this.scanTimer.unref()
    }

    void this.scanNow()
  }

  /**
   * 감시를 멈춘다. **진행 중이던 작업이 끝날 때까지 기다린다.**
   *
   * 호출한 쪽이 곧바로 `index.close()`를 부를 수 있어야 하므로 await 가능해야 한다.
   */
  async stop(): Promise<void> {
    this.generation++
    this.watcher?.close()
    this.watcher = null
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.scanTimer = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.pending.clear()
    await this.inFlight.catch(() => undefined)
  }

  private enqueue(relPath: string): void {
    if (!isIndexable(relPath)) return
    this.pending.add(relPath)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      void this.flush()
    }, this.debounceMs)
    this.flushTimer.unref()
  }

  /** 대기 중인 경로를 지금 처리한다. 테스트와 종료 직전에 쓴다. */
  async flush(): Promise<VaultChange[]> {
    const run = this.doFlush()
    this.track(run)
    return run
  }

  private async doFlush(): Promise<VaultChange[]> {
    const gen = this.generation
    const paths = [...this.pending]
    this.pending.clear()
    const changes: VaultChange[] = []
    for (const p of paths) {
      const c = await this.applyOne(p, 'watch')
      if (gen !== this.generation) return [] // 그 사이 stop()
      if (c) changes.push(c)
    }
    this.emit(changes)
    return changes
  }

  /** 한 경로를 지금 다시 색인한다. 바뀐 게 없으면 null. */
  async reindex(relPath: string): Promise<VaultChange | null> {
    const change = await this.applyOne(normalizeRel(relPath), 'watch')
    this.emit(change ? [change] : [])
    return change
  }

  /**
   * vault와 인덱스를 대조해 어긋난 것을 전부 화해시킨다.
   *
   * watcher가 꺼져 있었거나 이벤트를 놓쳤어도 **이 함수만으로 수렴한다.**
   */
  async scanNow(): Promise<VaultChange[]> {
    const run = this.doScan()
    this.track(run)
    return run
  }

  /** 진행 중인 작업으로 등록한다 — stop()이 이걸 기다린다 */
  private track(p: Promise<unknown>): void {
    const prev = this.inFlight
    this.inFlight = prev.then(
      () => p.catch(() => undefined),
      () => p.catch(() => undefined)
    )
  }

  private async doScan(): Promise<VaultChange[]> {
    const gen = this.generation
    const drift = await this.index.drift(this.vault)
    if (gen !== this.generation) return []
    const changes: VaultChange[] = []
    for (const p of [...drift.missing, ...drift.stale, ...drift.orphaned]) {
      const c = await this.applyOne(normalizeRel(p), 'scan')
      if (gen !== this.generation) return []
      if (c) changes.push(c)
    }
    this.emit(changes)
    return changes
  }

  /**
   * 디스크 상태와 인덱스 상태를 비교해 필요한 만큼만 갱신한다.
   *
   * hash가 같으면 아무 일도 하지 않는다 — 앱이 방금 쓴 파일에 되울리지 않는다.
   */
  private async applyOne(
    relPath: string,
    origin: VaultChange['origin']
  ): Promise<VaultChange | null> {
    // watch 경로와 scan 경로가 같은 파일을 동시에 집으면, 둘 다 "인덱스에 없다"를
    // 보고 각각 created를 낸다. 직렬화해서 하나만 이기게 한다.
    const run = this.queue.then(() => this.applyOneLocked(relPath, origin))
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async applyOneLocked(
    relPath: string,
    origin: VaultChange['origin']
  ): Promise<VaultChange | null> {
    if (!isIndexable(relPath)) return null

    const known = this.index.hashOf(relPath)
    const current = await this.vault.currentHash(relPath)

    if (current === null) {
      if (known === null) return null // 색인한 적 없는 파일이 사라졌다 — 임시 파일 등
      this.index.remove(relPath)
      return { path: relPath, kind: 'deleted', origin }
    }

    if (current === known) return null

    // id가 없는 파일은 색인하지 않는다 (사용자가 손으로 만든 메모)
    const indexed = await this.index.reindexOne(this.vault, relPath)
    if (!indexed) return null

    return { path: relPath, kind: known === null ? 'created' : 'updated', origin }
  }

  private emit(changes: VaultChange[]): void {
    if (changes.length === 0) return
    for (const l of this.listeners) l(changes)
  }
}

/**
 * 경로 표기를 하나로 맞춘다.
 *
 * NFC 정규화는 **예방책이고, 이 환경에서 필요하다고 확인된 것이 아니다.**
 * 실측(2026-08-06, macOS 25.3 / APFS / Node 24): `fs.watch`와 `readdir` 모두
 * `회의록.md`를 완성형(NFC, U+D68C U+C758 U+B85D)으로 돌려줬다.
 *
 * 그래도 남겨두는 이유: HFS+로 포맷된 외장 볼륨은 파일명을 자소 분리(NFD)로
 * 저장한다. vault가 그런 볼륨에 있으면 `fs.watch`가 준 NFD 경로와 앱이 만든
 * NFC 경로가 갈라져 같은 문서가 인덱스에 두 번 들어간다. 비용이 없으므로 건다.
 * ⚠️ HFS+ 볼륨에서의 동작은 아직 확인하지 않았다.
 */
function normalizeRel(p: string): string {
  return p.split(path.sep).join('/').normalize('NFC')
}
