import { useState } from 'react'
import { UNSET_LABEL, stripCitations } from '@ratatouille/contracts'
import { Replace, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  type DecisionDeps,
  type DecisionView,
  useDecisions,
} from './use-decisions'

/**
 * 결정 이력 — GOAL 6.10 「화면 연결」.
 *
 * ⛔ **검수 화면의 「결정 사항」 section과 다른 것이다.** 저쪽은 *이번 실행이
 *    뽑아낸 결정이 맞는가*를 묻는 검수 자리이고, 여기는 *확정된 결정이 아직
 *    유효한가*를 보는 이력이다. 둘을 한 자리에 합치면 검수 계약의 네 section이
 *    다섯이 되고, 검수 중인 제안과 확정된 기록이 같은 목록에 섞인다.
 *
 * ⛔ **대체·뒤집힌 결정을 감추지 않는다.** 바뀐 결론만 남기면 「왜 바뀌었나」가
 *    사라진다 — 결정을 회의록 안 문단이 아니라 entity로 둔 이유가 그것이다.
 */
export function DecisionHistory({
  sourceId,
  deps,
}: {
  sourceId: string
  deps?: DecisionDeps
}) {
  const { decisions, error, busy, annotate, supersede, reverse } = useDecisions(
    sourceId,
    deps
  )
  /*
   * 확인 창은 **목록 하나에 하나**다. 줄마다 창을 두면 같은 마크업이 결정 수만큼
   * 생기고, 열려 있는 창이 목록 갱신으로 다시 만들어지면서 닫힌다.
   */
  const [ask, setAsk] = useState<{
    kind: 'reverse' | 'supersede'
    id: string
  } | null>(null)

  // ⛔ 불러오지 못한 것을 빈 목록으로 보여주지 않는다 — 「결정이 없다」와 구분되지 않는다
  if (error && !decisions) {
    return (
      <p className='text-sm text-state-danger' role='alert'>
        {error}
      </p>
    )
  }
  // ⛔ 「불러오는 중…」 한 줄로 두지 않는다. 멈춘 화면과 구분되어야 한다
  if (!decisions) return <HistorySkeleton />

  const target = decisions.find((d) => d.decisionId === ask?.id) ?? null
  /*
   * 대체 후보는 **`active`인 다른 결정**뿐이다.
   * ⛔ 화면이 거르지 않으면 계약이 409로 거절한다. 누를 수 있는 버튼이 반드시
   *    실패하는 것은 화면이 사용자에게 거짓말을 한 것이다.
   */
  const candidates = decisions.filter(
    (d) => d.decisionState === 'active' && d.decisionId !== ask?.id
  )

  return (
    /* ⛔ 높이를 못박지 않는다. 서랍 안에서는 남은 높이를 채우고 목록만 스크롤한다 */
    <div
      className='flex min-h-0 flex-1 flex-col gap-3'
      data-testid='decision-history'
    >
      {error && (
        <p className='text-sm text-state-danger' role='alert'>
          {error}
        </p>
      )}

      {decisions.length === 0 ? (
        <Empty />
      ) : (
        <ol className='min-h-0 flex-1 overflow-y-auto pr-1'>
          {decisions.map((d, i) => (
            <Row
              key={d.decisionId}
              decision={d}
              index={i}
              all={decisions}
              onAnnotate={(patch) => void annotate(d.decisionId, patch)}
              onAsk={(kind) => setAsk({ kind, id: d.decisionId })}
            />
          ))}
        </ol>
      )}

      {target && (
        <AskDialog
          /* ⛔ 창을 바꿔 열면 고른 것이 따라오지 않는다 — 다른 결정에 걸릴 수 있다 */
          key={`${ask!.kind}:${ask!.id}`}
          kind={ask!.kind}
          decision={target}
          candidates={candidates}
          busy={busy}
          error={error}
          onClose={() => setAsk(null)}
          onConfirm={async (previousId) => {
            const done =
              ask!.kind === 'reverse'
                ? await reverse(target.decisionId)
                : await supersede(target.decisionId, previousId!)
            // ⛔ 실패했을 때 닫지 않는다. 닫으면 거절 이유를 읽을 자리가 사라진다
            if (done) setAsk(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * ⋮ 메뉴에서 여는 서랍.
 *
 * ⛔ **결과 화면 안에 다섯 번째 덩어리로 두지 않는다.** 검수 계약의 네 section은
 *    고정이고, 이력은 검수하는 동안 읽는 것이 아니라 「그때 뭘 정했더라」를
 *    물을 때 여는 것이다. 전사 원문과 같은 층위의 참고 자료다.
 */
export function DecisionHistorySheet({
  open,
  onOpenChange,
  sourceId,
  deps,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceId: string
  deps?: DecisionDeps
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='flex w-full flex-col gap-3 p-4 sm:max-w-md'
        data-testid='decision-drawer'
      >
        <SheetHeader className='gap-1 p-0'>
          <SheetTitle className='text-sm font-medium'>결정 이력</SheetTitle>
          <SheetDescription className='text-xs'>
            확정할 때마다 쌓입니다. 대체·뒤집힌 결정도 지워지지 않습니다.
          </SheetDescription>
        </SheetHeader>
        {/* ⛔ 닫혀 있을 때는 마운트하지 않는다 — 열지도 않은 서랍이 요청을 보낸다 */}
        {open && <DecisionHistory sourceId={sourceId} deps={deps} />}
      </SheetContent>
    </Sheet>
  )
}

/**
 * 결정 한 줄.
 *
 * ⛔ **상자로 감싸지 않는다.** 결정마다 카드를 두르면 목록이 상자 더미가 되고
 *    어느 것이 유효한지가 테두리에 묻힌다. 상태는 배지가, 구분은 선이 맡는다.
 */
function Row({
  decision,
  index,
  all,
  onAnnotate,
  onAsk,
}: {
  decision: DecisionView
  index: number
  /** 역방향 관계를 파생하는 데 쓴다. ⛔ 서버는 한 방향만 저장한다(9절) */
  all: DecisionView[]
  onAnnotate: (patch: { who?: string | null; why?: string | null }) => void
  onAsk: (kind: 'reverse' | 'supersede') => void
}) {
  const id = decision.decisionId
  const active = decision.decisionState === 'active'
  const previous = all.find((d) => d.decisionId === decision.supersedes) ?? null
  const replacement = all.find((d) => d.supersedes === id) ?? null
  /*
   * ⛔ 이미 다른 결정을 대체한 결정은 또 대체할 수 없다(계약). 한 결정이 둘을
   *    대체하면 「무엇을 대체했나」가 흐려진다.
   */
  const canSupersede =
    active &&
    decision.supersedes === null &&
    all.some((d) => d.decisionState === 'active' && d.decisionId !== id)

  return (
    <li className='flex flex-col gap-2 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0'>
      <div className='flex flex-wrap items-center gap-2'>
        <StateBadge state={decision.decisionState} />
        <span className='text-xs text-muted-foreground tabular-nums'>
          {formatDecidedAt(decision.decidedAt)}
        </span>
      </div>

      {/*
        ⛔ 근거 마커(`[seg_1]`)를 문장에 그대로 두지 않는다. 여기에는 각주를
           그릴 재료(전사 segment)가 없으므로 마커는 읽는 것을 방해할 뿐이다.
           근거 id는 아래에 따로 밝힌다 — 없애지는 않는다.
      */}
      <p className={cn('text-sm', !active && 'text-muted-foreground')}>
        {stripCitations(decision.what)}
      </p>

      {(previous || replacement) && (
        <p
          className='text-xs text-muted-foreground'
          data-testid={`relation-${id}`}
        >
          {replacement
            ? `이 뒤에 「${stripCitations(replacement.what)}」로 바뀌었습니다`
            : `「${stripCitations(previous!.what)}」를 대체한 결정입니다`}
        </p>
      )}

      {decision.evidence.length > 0 && (
        <p className='font-mono text-xs text-muted-foreground'>
          근거 {decision.evidence.join(' · ')}
        </p>
      )}

      {/*
        ⛔ **`active`가 아니면 고칠 수 없다.** 계약이 409로 거절하므로, 입력 칸을
           내주면 사용자는 채우고 나서야 막힌 것을 안다. 값은 그대로 보여준다.
      */}
      {active ? (
        <Fields decision={decision} index={index} onAnnotate={onAnnotate} />
      ) : (
        <p className='text-sm text-muted-foreground'>
          결정자 {decision.who ?? UNSET_LABEL} · 이유{' '}
          {decision.why ?? UNSET_LABEL}
        </p>
      )}

      {active && (
        <div className='flex flex-wrap gap-1'>
          {canSupersede && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => onAsk('supersede')}
              data-testid={`supersede-${id}`}
            >
              <Replace className='size-3.5' aria-hidden />
              이전 결정 대체
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            className='text-state-danger'
            onClick={() => onAsk('reverse')}
            data-testid={`reverse-${id}`}
          >
            <Undo2 className='size-3.5' aria-hidden />
            뒤집기
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * 사람이 채우는 두 칸.
 *
 * ⛔ **비어 있는 것을 감추지 않는다.** 모델이 채우지 못하는 값이라, 이 자리가
 *    없으면 영영 비어 있다. 「미입력」은 보이는 말이고 저장되는 값은 `null`이다 —
 *    그런 이름의 사람은 없고, 그런 이유도 없다.
 */
function Fields({
  decision,
  index,
  onAnnotate,
}: {
  decision: DecisionView
  index: number
  onAnnotate: (patch: { who?: string | null; why?: string | null }) => void
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <span>결정자</span>
        <Field
          key={`who:${decision.who ?? ''}`}
          value={decision.who}
          label={`결정 ${index + 1} 결정자`}
          onSave={(value) => onAnnotate({ who: value })}
        />
      </div>
      <div className='flex flex-col gap-1 text-sm text-muted-foreground'>
        <span>이유</span>
        <Field
          key={`why:${decision.why ?? ''}`}
          value={decision.why}
          label={`결정 ${index + 1} 이유`}
          multiline
          onSave={(value) => onAnnotate({ why: value })}
        />
      </div>
    </div>
  )
}

/**
 * 한 칸.
 *
 * 입력이 멈출 때가 아니라 **포커스를 떠날 때** 보낸다 — 이름은 짧아서 타이핑
 * 도중에 보내면 부분 문자열이 저장된다.
 *
 * ⛔ **밖의 값을 effect로 복사하지 않는다.** 저장 뒤 목록을 다시 읽으므로
 *    응답이 오는 순간 쓰던 글자가 되돌아간다. 값이 바뀌면 부모가 `key`로 다시 만든다.
 */
function Field({
  value,
  label,
  multiline,
  onSave,
}: {
  value: string | null
  label: string
  multiline?: boolean
  onSave: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim()
    if (next !== value) onSave(next)
  }

  const shared = {
    value: draft,
    onBlur: commit,
    'aria-label': label,
    placeholder: UNSET_LABEL,
  }

  if (multiline) {
    return (
      <Textarea
        {...shared}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // ⚠️ 여러 줄 칸에서 Enter는 줄바꿈이다. 되돌리기만 받는다
          if (e.key === 'Escape') {
            setDraft(value ?? '')
            e.currentTarget.blur()
          }
        }}
        rows={2}
        className='min-h-0 resize-none text-sm'
      />
    )
  }

  return (
    <Input
      {...shared}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value ?? '')
          e.currentTarget.blur()
        }
      }}
      className='h-7 w-40 px-2 text-sm'
    />
  )
}

/**
 * 되돌릴 수 없는 조작의 확인 창.
 *
 * ⛔ **대체와 뒤집기는 다른 것이다.** 대체는 「다른 결론으로 바꿨다」이고
 *    뒤집기는 「없던 일로 했다」다. 확인 창의 말이 그 차이를 말해야 한다 —
 *    같은 문구로 뭉치면 사용자가 아무거나 고르고, 되살리는 전이는 없다.
 */
function AskDialog({
  kind,
  decision,
  candidates,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  kind: 'reverse' | 'supersede'
  decision: DecisionView
  candidates: DecisionView[]
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (previousId: string | null) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const what = stripCitations(decision.what)

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind === 'reverse'
              ? '이 결정을 뒤집을까요?'
              : '어느 결정을 대체하나요?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'reverse' ? (
              <>
                「{what}」를 없던 일로 표시합니다. 기록은 남지만 되살릴 수
                없습니다 — 다시 유효하게 하려면 새 결정을 남겨야 합니다.
              </>
            ) : (
              <>
                고른 결정이 「대체됨」이 되고, 「{what}」가 그 자리를 잇습니다.
                되돌릴 수 없습니다.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {kind === 'supersede' && (
          /*
            ⛔ **무엇을 대체하는지 모르는 확인은 확인이 아니다.** 고르기 전에는
               확인 버튼이 눌리지 않는다.
          */
          <ul className='flex max-h-56 flex-col gap-1 overflow-y-auto'>
            {candidates.map((c) => (
              <li key={c.decisionId}>
                <button
                  type='button'
                  aria-pressed={picked === c.decisionId}
                  onClick={() => setPicked(c.decisionId)}
                  data-testid={`candidate-${c.decisionId}`}
                  className={cn(
                    'w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent',
                    picked === c.decisionId && 'border-primary bg-accent'
                  )}
                >
                  {stripCitations(c.what)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
          {/*
            ⛔ `AlertDialogAction`을 쓰지 않는다. 누르는 순간 창을 닫아버려서
               서버가 거절해도 닫히고, 거절 이유를 보여줄 자리가 사라진다.
          */}
          <Button
            onClick={() => onConfirm(picked)}
            disabled={busy || (kind === 'supersede' && !picked)}
            className={
              kind === 'reverse' ? 'bg-state-danger text-white' : undefined
            }
            data-testid={
              kind === 'reverse' ? 'confirm-reverse' : 'confirm-supersede'
            }
          >
            {kind === 'reverse' ? '뒤집기' : '대체'}
          </Button>
        </AlertDialogFooter>

        {error && (
          <p className='text-sm text-state-danger' role='alert'>
            {error}
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** ⛔ 상태 이름을 사람 말로 옮긴다. `superseded`는 화면에 그대로 내지 않는다 */
function StateBadge({ state }: { state: DecisionView['decisionState'] }) {
  if (state === 'active') {
    return (
      <Badge variant='outline' className='text-state-success'>
        유효
      </Badge>
    )
  }
  if (state === 'superseded') return <Badge variant='secondary'>대체됨</Badge>
  return (
    <Badge variant='outline' className='text-state-danger'>
      뒤집힘
    </Badge>
  )
}

/** ⛔ 비어 있는 이유를 말한다. 「없음」만 두면 고장난 것처럼 보인다 */
function Empty() {
  return (
    <p className='text-sm text-muted-foreground'>
      아직 확정된 결정이 없습니다. 문서를 확정하면 결정 하나하나가 여기에
      이력으로 쌓입니다.
    </p>
  )
}

function HistorySkeleton() {
  return (
    <div className='flex flex-col gap-4' data-testid='decision-skeleton'>
      {[0, 1].map((i) => (
        <div key={i} className='flex flex-col gap-2'>
          <Skeleton className='h-4 w-16' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-8/12' />
        </div>
      ))}
    </div>
  )
}

/**
 * 언제 정해졌나.
 *
 * ⚠️ 저장된 값은 UTC ISO다. 그대로 자르면 하루가 어긋나므로 보는 사람의
 *    시간대로 옮긴다.
 */
function formatDecidedAt(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at)
}
