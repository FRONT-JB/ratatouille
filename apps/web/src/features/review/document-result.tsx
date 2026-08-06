import { AlertTriangle, KeyRound, Loader2, Sparkles } from 'lucide-react'
import { UNSET_LABEL, splitCitations } from '@ratatouille/contracts'
import { Button } from '@/components/ui/button'
import {
  type Citation,
  type DocumentView,
  SECTIONS,
  citationsOf,
  describeRunState,
  footnoteNumbers,
  isRunning,
  isStale,
} from './document'
import type { RevisionSegmentView } from './revision'
import { type DocumentDeps, useDocument } from './use-document'

/**
 * AI 정리 결과 — 회의 요약 / 결정 사항 / Action Item / 원문 근거.
 *
 * ⛔ **네 section을 빼거나 하나로 합치지 않는다**(review-contract.md).
 *    화면의 `Action Item`은 내부 `tasks` entity다.
 *
 * ⛔ **각 항목의 근거를 눌러 그 지점의 음성으로 이동할 수 있어야 한다.**
 *    이게 이 화면이 존재하는 이유다 — 근거로 돌아갈 수 없는 요약은 검수할 수 없다.
 *
 * ⛔ **전사를 건드릴 수단이 여기 없다.** 결과 생성이 실패해도 사람이 고친
 *    전사는 그대로 남아야 한다.
 */
export function DocumentResult({
  sourceId,
  revisionId,
  segments,
  onSeek,
  deps,
}: {
  sourceId: string
  /** 지금 확정본. 결과가 다른 교정본에서 나왔으면 오래된 것이다 */
  revisionId: string
  segments: readonly RevisionSegmentView[]
  onSeek: (ms: number) => void
  deps?: DocumentDeps
}) {
  const { view, error, generate } = useDocument(sourceId, deps)

  if (error && !view) {
    return (
      <p className='text-state-danger text-sm' role='alert'>
        {error}
      </p>
    )
  }
  if (!view) {
    return <p className='text-muted-foreground text-sm'>정리 결과를 확인하는 중…</p>
  }

  const state = view.documentRunState
  const running = isRunning(state)
  const stale = isStale(view, revisionId)

  return (
    <div className='flex flex-col gap-4' data-testid='ai-result'>
      <RunHeader
        view={view}
        stale={stale}
        onGenerate={() => void generate()}
      />

      {error && (
        <p className='text-state-danger text-sm' role='alert'>
          {error}
        </p>
      )}

      {state === 'auth_required' && <ReauthNotice onRetry={() => void generate()} />}

      {state === 'failed_retryable' && (
        <FailureNotice view={view} onRetry={() => void generate()} />
      )}

      {view.proposal ? (
        <Sections proposal={view.proposal} segments={segments} onSeek={onSeek} />
      ) : (
        !running && state === null && <Intro />
      )}
    </div>
  )
}

/** 무엇이 나오는지 미리 말한다. 빈 자리를 두면 "곧 나오나 보다"로 읽힌다. */
function Intro() {
  return (
    <section className='border-border text-muted-foreground rounded-lg border border-dashed p-6 text-sm'>
      <p>전사가 확정되었습니다. AI 정리를 시작하면 네 가지가 만들어집니다.</p>
      <ul className='mt-2 list-disc pl-5'>
        {SECTIONS.map((s) => (
          <li key={s.key}>{s.title}</li>
        ))}
      </ul>
    </section>
  )
}

function RunHeader({
  view,
  stale,
  onGenerate,
}: {
  view: DocumentView
  stale: boolean
  onGenerate: () => void
}) {
  const state = view.documentRunState
  const running = isRunning(state)
  const phrase = state ? describeRunState(state) : null

  return (
    <header className='flex flex-wrap items-center gap-2'>
      <h2 className='text-sm font-medium'>AI 정리</h2>

      {phrase && (
        <span
          className={`text-xs ${running ? 'text-muted-foreground' : 'text-state-success'} ${
            // ⛔ 확정되지 않은 문구는 확정된 것처럼 두지 않는다(phrasing.ts).
            phrase.provisional ? 'underline decoration-dotted underline-offset-4' : ''
          }`}
          data-provisional={phrase.provisional || undefined}
          title={phrase.detail ?? undefined}
        >
          {running && <Loader2 className='mr-1 inline size-3 animate-spin' aria-hidden />}
          {phrase.label}
        </span>
      )}

      {stale && (
        // ⛔ 오래됐다고 지우지 않는다. 사람이 보고 다시 만들지 판단한다.
        <span className='text-state-warning rounded border border-current px-1.5 py-0.5 text-xs'>
          재검토 필요 — 전사를 다시 확정했습니다
        </span>
      )}

      {view.elapsedMs !== null && !running && (
        <span className='text-muted-foreground text-xs tabular-nums'>
          {(view.elapsedMs / 1000).toFixed(1)}초
        </span>
      )}

      {/* ⛔ 도는 동안에는 시작 버튼이 아예 없다. 같은 회의를 두 번 돌리지 않는다 */}
      {!running && (
        <Button
          size='sm'
          variant={view.proposal ? 'outline' : 'default'}
          className='ml-auto'
          onClick={onGenerate}
          data-testid='generate'
        >
          <Sparkles className='size-4' aria-hidden />
          {view.proposal || state ? '다시 정리' : 'AI 정리 시작'}
        </Button>
      )}
    </header>
  )
}

/**
 * ⛔ 인증 만료는 재시도가 아니라 **재인증**이다.
 *
 * 재시도 버튼만 주면 사용자는 눌러도 안 되는 버튼을 반복해서 누른다.
 * 무엇을 해야 하는지 말한다.
 */
function ReauthNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      className='border-state-warning flex flex-col items-start gap-2 rounded-lg border p-4 text-sm'
      data-testid='reauth'
      role='alert'
    >
      <span className='flex items-center gap-2 font-medium'>
        <KeyRound className='size-4' aria-hidden />
        모델 로그인이 만료되었습니다
      </span>
      <p className='text-muted-foreground'>
        터미널에서 <code className='font-mono'>hermes</code>에 다시 로그인한 뒤
        시도해 주세요. 전사와 교정 내용은 그대로 남아 있습니다.
      </p>
      <Button size='sm' variant='outline' onClick={onRetry}>
        다시 시도
      </Button>
    </section>
  )
}

/** ⛔ 실패 이유와 위반을 그대로 보여준다. 못 보면 고칠 수 없다. */
function FailureNotice({
  view,
  onRetry,
}: {
  view: DocumentView
  onRetry: () => void
}) {
  return (
    <section
      className='border-state-danger flex flex-col items-start gap-2 rounded-lg border p-4 text-sm'
      role='alert'
    >
      <span className='flex items-center gap-2 font-medium'>
        <AlertTriangle className='size-4' aria-hidden />
        정리하지 못했습니다
      </span>
      {view.error && <p className='text-muted-foreground'>{view.error}</p>}
      {view.violations.length > 0 && (
        <ul className='text-muted-foreground list-disc pl-5'>
          {view.violations.map((v, i) => (
            <li key={`${v.kind}-${i}`}>{v.message}</li>
          ))}
        </ul>
      )}
      <Button size='sm' variant='outline' onClick={onRetry}>
        다시 시도
      </Button>
    </section>
  )
}

function Sections({
  proposal,
  segments,
  onSeek,
}: {
  proposal: NonNullable<DocumentView['proposal']>
  segments: readonly RevisionSegmentView[]
  onSeek: (ms: number) => void
}) {
  const numbers = footnoteNumbers(proposal.evidence)
  const notes = citationsOf(
    proposal.evidence.map((e) => e.id),
    proposal.evidence,
    segments
  )
  const byId = new Map(notes.map((c) => [c.id, c]))

  /** 본문 한 덩어리. 마커 자리에 각주 번호를 그린다. */
  const body = (text: string) => (
    <Annotated text={text} numbers={numbers} byId={byId} onSeek={onSeek} />
  )

  return (
    <>
      <Section key='summary' sectionKey='summary'>
        <p className='text-sm whitespace-pre-wrap'>
          {body(proposal.summary.text)}
        </p>
      </Section>

      <Section key='decisions' sectionKey='decisions'>
        {proposal.decisions.length === 0 ? (
          <Empty what='결정된 사항' />
        ) : (
          <ul className='flex flex-col gap-2'>
            {proposal.decisions.map((d, i) => (
              <li key={i} className='text-sm' data-decision={i}>
                {body(d.what)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section key='tasks' sectionKey='tasks'>
        {proposal.tasks.length === 0 ? (
          <Empty what='할 일' />
        ) : (
          <ul className='flex flex-col gap-3'>
            {proposal.tasks.map((t, i) => (
              <li key={i} className='text-sm' data-task={i}>
                <p>{body(t.action)}</p>
                {/*
                  ⛔ 담당자·기한이 비어 있는 것을 숨기지 않는다. 화자 분리를
                     접었으므로 "제가 하겠습니다"는 누구인지 알 수 없다.
                     사람이 지정할 자리라는 것을 보여준다.
                */}
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  담당 {t.owner ?? UNSET_LABEL} · 기한 {t.due ?? UNSET_LABEL}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Footnotes notes={notes} onSeek={onSeek} />
    </>
  )
}

/*
 * ⚠️ **`leading-relaxed`를 쓰지 않는다.** 이 프로젝트의 theme은 행간을 전역
 *    1.618로 통일하면서 Tailwind의 `--leading-*` 기본값을 두지 않았다.
 *    그래서 `leading-relaxed`는 `--tw-leading`을 무효값으로 만들고, 그 안의
 *    `text-[임의값]`이 `line-height: 0`으로 무너진다. 실제로 각주 번호가
 *    높이 0이 되어 **눌리지 않았다.** 정의된 크기(`text-xs`)만 쓴다.
 */

/**
 * 본문 + 각주 번호.
 *
 * ⛔ **근거는 그 문장에 붙어 있어야 한다.** 항목 끝에 몰아 달면 `[1][2]…[10]`이
 *    되어 어느 근거가 어느 주장을 받치는지 알 수 없다. 검수는 "이 문장이 맞나"를
 *    묻는 일이다.
 */
function Annotated({
  text,
  numbers,
  byId,
  onSeek,
}: {
  text: string
  numbers: Map<string, number>
  byId: Map<string, Citation>
  onSeek: (ms: number) => void
}) {
  return (
    <>
      {splitCitations(text).map((part, i) =>
        part.kind === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <FootnoteMark
            key={i}
            id={part.id}
            n={numbers.get(part.id)}
            cite={byId.get(part.id)}
            onSeek={onSeek}
          />
        )
      )}
    </>
  )
}

function FootnoteMark({
  id,
  n,
  cite,
  onSeek,
}: {
  id: string
  n: number | undefined
  cite: Citation | undefined
  onSeek: (ms: number) => void
}) {
  /*
   * ⛔ 닿지 못하는 근거를 누를 수 있게 그리지 않는다 — 눌러도 아무 데도 가지
   *    않는 각주는 없는 것만 못하다. 그렇다고 조용히 지우지도 않는다.
   *    지우면 무엇이 잘못됐는지 검수할 수 없다.
   */
  if (!cite?.resolved || n === undefined) {
    return (
      <sup className='text-state-danger font-mono text-xs' data-cite-broken={id}>
        [{id}?]
      </sup>
    )
  }
  return (
    <sup>
      <button
        type='button'
        data-cite={id}
        onClick={() => onSeek(cite.startMs!)}
        aria-label={`${cite.timestamp}부터 듣기 — ${cite.quote}`}
        title={`${cite.timestamp} ${cite.quote}`}
        // ⛔ 오른쪽 여백을 주지 않는다. 마커는 문장 끝 마침표 **앞**에 오므로,
        //    양쪽에 여백을 주면 `했다 [5] .`처럼 마침표가 떨어져 나온다.
        className='text-primary hover:bg-primary/10 rounded pl-0.5 font-mono text-xs hover:underline'
      >
        [{n}]
      </button>
    </sup>
  )
}

/**
 * 각주란 — `원문 근거` section.
 *
 * ⛔ **없앨 수 없다.** review-contract가 요구하는 "evidence ID와 timestamp가 있는
 *    전용 조회 영역"이고, 환각 방지 계약의 한쪽이다.
 *
 * 기본은 접어 둔다. 90건이 늘 펼쳐져 있으면 결과를 읽는 데 방해가 된다.
 */
function Footnotes({
  notes,
  onSeek,
}: {
  notes: Citation[]
  onSeek: (ms: number) => void
}) {
  return (
    <details className='border-border rounded-lg border' data-section='evidence'>
      <summary className='cursor-pointer p-4 text-sm font-medium'>
        {/* ⛔ `<summary>` 안에 heading을 둔다 — 접혀 있어도 목차에서 찾을 수 있다 */}
        <h3 className='inline text-sm font-medium'>원문 근거</h3>
        <span className='text-muted-foreground ml-2 font-normal'>
          {notes.length}건
        </span>
      </summary>
      <ol className='flex flex-col gap-1 px-4 pb-4'>
        {notes.map((c, i) =>
          c.resolved ? (
            <li key={c.id} className='flex gap-2 text-sm'>
              <span className='text-muted-foreground shrink-0 font-mono text-xs'>
                [{i + 1}]
              </span>
              <button
                type='button'
                data-cite={c.id}
                onClick={() => onSeek(c.startMs!)}
                aria-label={`${c.timestamp}부터 듣기 — ${c.quote}`}
                className='hover:text-primary text-left'
              >
                <span className='text-muted-foreground mr-2 font-mono text-xs'>
                  {c.timestamp}
                </span>
                {c.quote}
              </button>
            </li>
          ) : (
            <li
              key={c.id}
              className='text-state-danger font-mono text-xs'
              data-cite-broken={c.id}
            >
              [{i + 1}] {c.id} — 전사문에서 찾을 수 없습니다
            </li>
          )
        )}
      </ol>
    </details>
  )
}

function Section({
  sectionKey,
  children,
}: {
  sectionKey: 'summary' | 'decisions' | 'tasks'
  children: React.ReactNode
}) {
  const title = SECTIONS.find((s) => s.key === sectionKey)!.title
  return (
    <section
      className='border-border flex flex-col gap-2 rounded-lg border p-4'
      data-section={sectionKey}
    >
      <h3 className='text-sm font-medium'>{title}</h3>
      {children}
    </section>
  )
}

/** ⛔ 없는 것은 오류가 아니다. 회의에 그런 항목이 없었을 뿐이다. */
function Empty({ what }: { what: string }) {
  return <p className='text-muted-foreground text-sm'>{what}이 없습니다.</p>
}
