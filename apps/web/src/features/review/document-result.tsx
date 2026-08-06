import {
  AlertTriangle,
  ChevronRight,
  KeyRound,
  ListTree,
  Play,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type DocumentReview,
  type ProposalEdit,
  type ReviewSection,
  type RubricVerdict,
  type SectionReviewState,
  splitCitations,
} from '@ratatouille/contracts'
import { Editable } from './editable'
import { OwnerAndDue } from './owner-due'
import { SectionReviewControl } from './section-review'
import {
  type Citation,
  type DocumentView,
  SECTIONS,
  citationsOf,
  contextAround,
  footnoteNumbers,
  isRunning,
  isStale,
  reviewOf,
} from './document'
import type { RevisionSegmentView } from './revision'

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
 *
 * ⛔ **상태말도 조작 버튼도 여기 없다.** 부모(`ApprovedView`)가 한 줄에 모아
 *    갖는다. 여기서 또 그리면 같은 말이 화면에 두 번 나온다.
 */
export function DocumentResult({
  view,
  error,
  revisionId,
  segments,
  onSeek,
  onPlay,
  onOpenTranscript,
  onRetry,
  onReview,
  onEdit,
}: {
  view: DocumentView | null
  error: string | null
  /** 지금 확정본. 결과가 다른 교정본에서 나왔으면 오래된 것이다 */
  revisionId: string
  segments: readonly RevisionSegmentView[]
  onSeek: (ms: number) => void
  /** 「여기부터 듣기」. ⛔ 이것 말고는 소리를 내지 않는다 */
  onPlay: (ms: number) => void
  /** 「전사에서 보기」 */
  onOpenTranscript: (ms: number) => void
  onRetry: () => void
  onReview: (
    section: ReviewSection,
    patch: { state?: SectionReviewState; rubric?: Record<string, RubricVerdict> }
  ) => void
  onEdit: (edit: ProposalEdit) => void
}) {
  if (error && !view) {
    return (
      <p className='text-state-danger text-sm' role='alert'>
        {error}
      </p>
    )
  }
  // ⛔ 빈 화면을 두지 않는다. 무엇이 어디에 나올지 미리 보여준다.
  if (!view) return <ResultSkeleton />

  const state = view.documentRunState
  const running = isRunning(state)

  return (
    <div className='flex flex-col gap-8' data-testid='ai-result'>
      {error && (
        <p className='text-state-danger text-sm' role='alert'>
          {error}
        </p>
      )}

      {isStale(view, revisionId) && (
        // ⛔ 오래됐다고 지우지 않는다. 사람이 보고 다시 만들지 판단한다.
        <p className='text-state-warning text-sm' data-testid='stale'>
          재검토 필요 — 이 결과가 나온 뒤에 전사를 다시 확정했습니다.
        </p>
      )}

      {state === 'auth_required' && <ReauthNotice onRetry={onRetry} />}
      {state === 'failed_retryable' && (
        <FailureNotice view={view} onRetry={onRetry} />
      )}

      {view.proposal ? (
        <Sections
          proposal={view.proposal}
          segments={segments}
          review={reviewOf(view)}
          locked={view.documentState === 'current'}
          onSeek={onSeek}
          onPlay={onPlay}
          onOpenTranscript={onOpenTranscript}
          onReview={onReview}
          onEdit={onEdit}
        />
      ) : running ? (
        // ⛔ 도는 동안 내용 자리를 비워두지 않는다. 멈춘 것처럼 보인다.
        <ResultSkeleton />
      ) : (
        state === null && <Intro />
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
  review,
  locked,
  onSeek,
  onPlay,
  onOpenTranscript,
  onReview,
  onEdit,
}: {
  proposal: NonNullable<DocumentView['proposal']>
  segments: readonly RevisionSegmentView[]
  review: DocumentReview
  locked: boolean
  onSeek: (ms: number) => void
  onPlay: (ms: number) => void
  onOpenTranscript: (ms: number) => void
  onReview: (
    section: ReviewSection,
    patch: { state?: SectionReviewState; rubric?: Record<string, RubricVerdict> }
  ) => void
  onEdit: (edit: ProposalEdit) => void
}) {
  const numbers = footnoteNumbers(proposal.evidence)
  const notes = citationsOf(
    proposal.evidence.map((e) => e.id),
    proposal.evidence,
    segments
  )
  const byId = new Map(notes.map((c) => [c.id, c]))
  const narrative = proposal.narrative ?? []

  /** section 하나의 검수 줄. 네 곳이 같은 모양이어야 헷갈리지 않는다 */
  const control = (section: ReviewSection, itemCount: number | null) => (
    <SectionReviewControl
      section={section}
      review={review[section]}
      itemCount={itemCount}
      locked={locked}
      onChange={(patch) => onReview(section, patch)}
    />
  )

  /** 본문 한 덩어리. 마커 자리에 각주 번호를 그린다. */
  const body = (text: string) => (
    <Annotated
      text={text}
      numbers={numbers}
      byId={byId}
      segments={segments}
      onSeek={onSeek}
      onPlay={onPlay}
      onOpenTranscript={onOpenTranscript}
    />
  )

  return (
    <div className='flex flex-col gap-10'>
      {/*
        ⚠️ 본문 폭을 따로 좁히지 않는다. 긴 줄이 읽기 힘든 것은 눈이 다음 줄
           첫 글자를 못 찾기 때문인데, 한글은 한 글자가 담는 뜻이 커서 같은
           픽셀 폭에서도 글자 수가 로마자의 절반쯤이다. 이 화면의 본문 폭
           (`max-w-5xl` 안쪽 ≈ 940px)은 한글 58자 남짓이라 그 범위 안에 있다.
           오히려 68ch로 좁히면 오른쪽에 빈 칸이 남아 글이 떠 보였다.

        ⛔ **탭이 바꾸는 것은 「회의 내용 ↔ 요약」뿐이다.** 둘은 같은 회의를
           길게/짧게 말한 것이라 나란히 두면 같은 얘기를 두 번 읽게 된다.

        ⛔ **결정 사항과 Action Item은 탭 밖이다.** 그 둘은 요약의 일부가
           아니라 별개의 산출물이고, 검수 대상이다. 탭 뒤에 숨기면 어느 탭을
           보고 있느냐에 따라 할 일이 보였다 안 보였다 한다.
      */}
      {/* ⛔ 자식마다 margin을 주지 않는다. 부모의 gap 하나로 충분하다 */}
      <Tabs
        defaultValue={narrative.length > 0 ? 'narrative' : 'summary'}
        className='gap-4'
      >
        {/*
          ⛔ 검수 조작이 탭 **줄에** 붙는다. 회의 내용과 요약은 한 검수 상태를
             나눠 가지므로, 그 조작의 자리는 두 탭을 아우르는 이 줄이다.
        */}
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <TabsList>
            <TabsTrigger value='narrative' data-testid='tab-narrative'>
              회의 내용
            </TabsTrigger>
            <TabsTrigger value='summary' data-testid='tab-summary'>
              요약
            </TabsTrigger>
          </TabsList>
          {control('summary', null)}
        </div>

        <TabsContent value='narrative' data-section='narrative'>
          {narrative.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              이 결과에는 회의 내용 정리가 없습니다. 다시 정리하면 만들어집니다.
            </p>
          ) : (
            <div className='flex flex-col gap-6'>
              {narrative.map((n, i) => (
                <section key={i} className='flex flex-col gap-3' data-topic={i}>
                  {/*
                    ⛔ 결정 사항·Action Item의 제목과 **같은 모양**이다.
                       같은 층위인데 하나만 진하고 크면 두 개의 서로 다른
                       화면을 보는 것처럼 읽힌다.
                  */}
                  <SectionLabel>{n.heading}</SectionLabel>
                  <Editable
                    text={n.body}
                    label={n.heading}
                    disabled={locked}
                    onSave={(text) =>
                      onEdit({
                        section: 'summary',
                        kind: 'narrative',
                        index: i,
                        body: text,
                      })
                    }
                  >
                    <p className='text-base whitespace-pre-wrap'>{body(n.body)}</p>
                  </Editable>
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        {/*
          ⛔ 탭 이름이 「요약」인데 안에 또 「회의 요약」이라고 쓰지 않는다.
             같은 말이 두 줄로 겹친다.
        */}
        <TabsContent value='summary' data-section='summary'>
          <Editable
            text={proposal.summary.text}
            label='요약'
            disabled={locked}
            onSave={(text) => onEdit({ section: 'summary', kind: 'text', text })}
          >
            <p className='text-base whitespace-pre-wrap'>
              {body(proposal.summary.text)}
            </p>
          </Editable>
        </TabsContent>
      </Tabs>

      <Section
        key='decisions'
        sectionKey='decisions'
        action={control('decisions', proposal.decisions.length)}
      >
        {proposal.decisions.length === 0 ? (
          <Empty what='결정된 사항' />
        ) : (
          /*
            ⛔ 번호를 매긴다. 검수는 "몇 번째 결정이 틀렸다"고 말할 수 있어야
               하는 일이다. 불릿만 있으면 가리킬 수단이 없다.
          */
          <ol className='flex flex-col gap-3'>
            {proposal.decisions.map((d, i) => (
              <li
                key={i}
                className='grid grid-cols-[1.75rem_1fr] text-base'
                data-decision={i}
              >
                <span className='text-muted-foreground pt-px font-mono text-sm tabular-nums'>
                  {i + 1}
                </span>
                {/*
                  ⛔ 지울 수 있어야 한다. 결함 B(제안을 결정으로 승격)의
                     유일한 시정은 그 항목을 없애는 것이다.
                */}
                <Editable
                  text={d.what}
                  label={`결정 ${i + 1}`}
                  disabled={locked}
                  onSave={(text) =>
                    onEdit({ section: 'decisions', kind: 'text', index: i, text })
                  }
                  onRemove={() =>
                    onEdit({ section: 'decisions', kind: 'remove', index: i })
                  }
                >
                  <span>{body(d.what)}</span>
                </Editable>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        key='tasks'
        sectionKey='tasks'
        action={control('tasks', proposal.tasks.length)}
      >
        {proposal.tasks.length === 0 ? (
          <Empty what='할 일' />
        ) : (
          <ol className='flex flex-col gap-4'>
            {proposal.tasks.map((t, i) => (
              <li
                key={i}
                className='grid grid-cols-[1.75rem_1fr] text-base'
                data-task={i}
              >
                <span className='text-muted-foreground pt-px font-mono text-sm tabular-nums'>
                  {i + 1}
                </span>
                <div>
                  <Editable
                    text={t.action}
                    label={`Action Item ${i + 1}`}
                    disabled={locked}
                    onSave={(text) =>
                      onEdit({ section: 'tasks', kind: 'text', index: i, text })
                    }
                    onRemove={() =>
                      onEdit({ section: 'tasks', kind: 'remove', index: i })
                    }
                  >
                    <p>{body(t.action)}</p>
                  </Editable>
                  {/*
                    ⛔ 담당자·기한이 비어 있는 것을 숨기지 않는다. 화자 분리를
                       접었으므로 "제가 하겠습니다"는 누구인지 알 수 없다.
                       사람이 지정할 자리라는 것을 보여준다.
                  */}
                  <OwnerAndDue
                    task={t}
                    index={i}
                    disabled={locked}
                    onEdit={onEdit}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ⛔ 각주란은 탭 **밖**이다. 두 탭의 각주가 같은 번호를 가리킨다 */}
      <Footnotes
        notes={notes}
        onPlay={onPlay}
        action={control('evidence', notes.length)}
      />
    </div>
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
  segments,
  onSeek,
  onPlay,
  onOpenTranscript,
}: {
  text: string
  numbers: Map<string, number>
  byId: Map<string, Citation>
  segments: readonly RevisionSegmentView[]
  onSeek: (ms: number) => void
  onPlay: (ms: number) => void
  onOpenTranscript: (ms: number) => void
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
            segments={segments}
            onSeek={onSeek}
            onPlay={onPlay}
            onOpenTranscript={onOpenTranscript}
          />
        )
      )}
    </>
  )
}

/**
 * 각주 번호와 그 자리에서 열리는 근거.
 *
 * ⛔ **누른다고 소리가 나오지 않는다.** 예전에는 각주를 누르면 곧바로 재생이
 *    시작됐다. 읽는 중에 소리가 터져 나오는 건 방해다 — 각주를 누르는 것은
 *    "근거가 뭐지"이지 "들려줘"가 아니다. 듣기는 명시적으로 누른다.
 *
 * ⛔ **앞뒤 문맥을 여기서 보여준다.** 인용문 한 줄로는 검수할 수 없고, 매번
 *    1423줄짜리 전사를 여는 것은 읽는 흐름을 끊는다. 흔한 경우는 여기서 끝난다.
 */
function FootnoteMark({
  id,
  n,
  cite,
  segments,
  onSeek,
  onPlay,
  onOpenTranscript,
}: {
  id: string
  n: number | undefined
  cite: Citation | undefined
  segments: readonly RevisionSegmentView[]
  onSeek: (ms: number) => void
  onPlay: (ms: number) => void
  onOpenTranscript: (ms: number) => void
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

  const ms = cite.startMs!
  const lines = contextAround(segments, cite.index)

  return (
    <Popover
      onOpenChange={(open) => {
        // 열기만 해도 재생 위치는 맞춰 둔다. 소리는 나지 않는다.
        if (open) onSeek(ms)
      }}
    >
      <PopoverTrigger asChild>
        <sup>
          <button
            type='button'
            data-cite={id}
            aria-label={`근거 ${n} — ${cite.timestamp} ${cite.quote}`}
            // ⛔ 오른쪽 여백을 주지 않는다. 마커는 문장 끝 마침표 **앞**에 오므로,
            //    양쪽에 여백을 주면 `했다 [5] .`처럼 마침표가 떨어져 나온다.
            /*
              ⛔ `text-primary`를 쓰지 않는다. 이 테마의 primary는 파랑이
                 아니라 **검정**이라(Vercel 시그니처), 각주가 본문과 같은
                 색으로 보인다. 각주는 본문을 방해하지 않아야 하므로
                 조용한 색으로 두고, 가리킬 때만 진해진다.
            */
            className='text-muted-foreground hover:text-foreground hover:bg-accent data-[state=open]:text-foreground data-[state=open]:bg-accent rounded pl-0.5 font-mono text-xs'
          >
            [{n}]
          </button>
        </sup>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-96 p-0' data-testid='footnote-card'>
        <div className='flex flex-col gap-2 p-3'>
          <span className='text-muted-foreground font-mono text-xs'>
            근거 {n} · {cite.timestamp}
          </span>
          <ol className='flex flex-col gap-1 text-sm'>
            {lines.map((l) => (
              <li
                key={l.id}
                className={
                  l.isCited ? 'text-foreground' : 'text-muted-foreground text-xs'
                }
                data-cited={l.isCited || undefined}
              >
                {l.text}
              </li>
            ))}
          </ol>
        </div>
        <Separator />
        <div className='flex gap-1 p-1'>
          <Button
            variant='ghost'
            size='sm'
            className='flex-1 justify-start'
            onClick={() => onPlay(ms)}
            data-testid='play-here'
          >
            <Play className='size-3.5' aria-hidden />
            여기부터 듣기
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='flex-1 justify-start'
            onClick={() => onOpenTranscript(ms)}
            data-testid='open-in-transcript'
          >
            <ListTree className='size-3.5' aria-hidden />
            전사에서 보기
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
  onPlay,
  action,
}: {
  notes: Citation[]
  /** 각주란에서는 목록을 훑는 중이므로 누르면 바로 듣는 편이 맞다 */
  onPlay: (ms: number) => void
  action?: React.ReactNode
}) {
  return (
    /*
     * ⛔ 네이티브 `<details>`를 쓰지 않는다. `<summary>`는 `<details>`의 **첫
     *    자식**이어야 하는데, 오른쪽에 검수 조작을 붙이려고 div로 감쌌더니
     *    브라우저가 자기 기본 라벨(「세부정보」)을 그렸다. 규칙을 어긴 마크업은
     *    조용히 이상하게 렌더된다.
     */
    <Collapsible
      className='border-border rounded-lg border'
      data-section='evidence'
    >
      <div className='flex flex-wrap items-center justify-between gap-2 p-4'>
        <CollapsibleTrigger asChild>
          <button
            type='button'
            className='flex items-center gap-1 text-sm font-medium'
            data-testid='evidence-toggle'
          >
            <ChevronRight
              className='size-4 transition-transform group-data-[state=open]/notes:rotate-90'
              aria-hidden
            />
            <h3 className='text-sm font-medium'>원문 근거</h3>
            <span className='text-muted-foreground ml-1 font-normal'>
              {notes.length}건
            </span>
          </button>
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>
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
                  onClick={() => onPlay(c.startMs!)}
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
      </CollapsibleContent>
    </Collapsible>
  )
}

function Section({
  sectionKey,
  action,
  children,
}: {
  sectionKey: 'decisions' | 'tasks'
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const title = SECTIONS.find((s) => s.key === sectionKey)!.title
  return (
    /*
      ⛔ **카드로 감싸지 않는다.** 네 덩어리를 전부 같은 테두리 상자에 넣으면
         위계가 사라지고 화면이 상자 목록이 된다. 여백과 라벨로 나눈다.
    */
    <section className='flex flex-col gap-3' data-section={sectionKey}>
      {/*
        제목은 **라벨**이지 읽을 글이 아니다. 본문보다 작고 조용하게 둔다 —
        예전에는 제목이 본문과 같은 크기라 어느 쪽이 내용인지 알 수 없었다.
      */}
      <SectionLabel action={action}>{title}</SectionLabel>
      {children}
    </section>
  )
}

/**
 * 결과 덩어리의 제목.
 *
 * ⛔ **한 곳에서만 정한다.** 회의 내용의 주제 제목과 결정 사항·Action Item의
 *    section 제목은 같은 층위다. 각자 스타일을 들면 반드시 갈라지고,
 *    실제로 하나는 진한 16px, 하나는 흐린 14px이 되어 있었다.
 *
 * 제목은 **라벨**이지 읽을 글이 아니다. 본문보다 작고 조용하게 둔다.
 */
function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode
  /**
   * 제목 줄 오른쪽에 붙는 조작.
   *
   * ⛔ **검수 버튼은 제목과 같은 줄에 있어야 한다.** 내용 아래에 홀로 두면
   *    무엇을 확인하는 버튼인지 알 수 없다 — 실제로 그렇게 보였다.
   */
  action?: React.ReactNode
}) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <h3 className='text-muted-foreground text-sm font-medium tracking-wide'>
        {children}
      </h3>
      {action}
    </div>
  )
}

/** ⛔ 없는 것은 오류가 아니다. 회의에 그런 항목이 없었을 뿐이다. */
function Empty({ what }: { what: string }) {
  return <p className='text-muted-foreground text-sm'>{what}이 없습니다.</p>
}

/**
 * 결과가 나올 자리의 뼈대.
 *
 * ⛔ **빈 화면이나 「불러오는 중…」 한 줄로 두지 않는다.** 무엇이 어디에
 *    나올지 미리 보이면 기다림이 짧게 느껴지고, 화면이 멈춘 것과 구분된다.
 */
function ResultSkeleton() {
  return (
    <div className='flex flex-col gap-8' data-testid='result-skeleton'>
      {(['summary', 'decisions', 'tasks'] as const).map((key) => (
        <section key={key} className='flex flex-col gap-3'>
          <Skeleton className='h-4 w-20' />
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-11/12' />
            {key === 'summary' && <Skeleton className='h-4 w-4/6' />}
          </div>
        </section>
      ))}
    </div>
  )
}
