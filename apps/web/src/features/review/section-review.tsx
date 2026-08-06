import { Check, CircleSlash, TriangleAlert } from 'lucide-react'
import {
  RUBRIC,
  type ReviewSection,
  type RubricVerdict,
  type SectionReview,
  type SectionReviewState,
} from '@ratatouille/contracts'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * section 하나의 검수 조작.
 *
 * ⛔ **하나의 사실을 두 컨트롤로 쪼개지 않는다.** 예전에는 상태 배지(`확인 전`)와
 *    버튼(`확인함`)이 따로 있었다. 같은 것을 두 번 말하면서, 정작 그 버튼이
 *    무엇을 확인하는 것인지는 알 수 없었다 — 내용 아래에 홀로 떠 있었기 때문이다.
 *    지금은 **제목 줄에 붙은 토글 하나**다: 생김새가 상태고, 누르면 뒤집힌다.
 *
 * ⛔ **루브릭이 「클릭해야 하는 행정 절차」가 되면 아무도 제대로 안 본다.**
 *    기본 동작은 버튼 하나 — 읽고 「확인함」. 기준별 판정은 문제를 발견했을
 *    때만 펼쳐 쓴다.
 *
 * ⛔ **AI 판정을 사람의 확인으로 치지 않는다.** 여기서 사람이 누르지 않으면
 *    section은 영원히 `unreviewed`이고 문서는 확정되지 않는다.
 */

const VERDICT_LABEL: Record<RubricVerdict, string> = {
  pass: '괜찮음',
  fix_required: '수정 필요',
  uncertain: '확인 필요',
  not_applicable: '해당 없음',
}

/** 확정을 막는 판정. 계약과 같은 값을 본다 — 화면이 따로 판정하지 않는다 */
const BLOCKING: RubricVerdict[] = ['fix_required', 'uncertain']

/** 이 상태는 «사람이 봤다»로 친다 */
function isDone(state: SectionReviewState): boolean {
  return state === 'accepted' || state === 'edited' || state === 'empty'
}

function label(state: SectionReviewState): string {
  if (state === 'edited') return '고침'
  if (state === 'empty') return '회의에 없었음'
  return '확인함'
}

export function SectionReviewControl({
  section,
  review,
  /** 이 section에 실제 항목이 있나. 「없음」이 정직한지 판단하는 근거 */
  itemCount,
  locked,
  onChange,
}: {
  section: ReviewSection
  review: SectionReview
  itemCount: number | null
  /** 확정된 문서는 흔들지 않는다 */
  locked: boolean
  onChange: (patch: {
    state?: SectionReviewState
    rubric?: Record<string, RubricVerdict>
  }) => void
}) {
  const done = isDone(review.state)
  const flagged = Object.values(review.rubric).filter((v) =>
    BLOCKING.includes(v)
  ).length

  return (
    <div
      className='flex shrink-0 items-center gap-1'
      data-review-section={section}
      data-review-state={review.state}
    >
      {flagged > 0 && (
        <span
          className='text-state-warning flex items-center gap-1 text-xs'
          title='이 판정이 남아 있으면 문서를 확정할 수 없습니다'
        >
          <TriangleAlert className='size-3.5' aria-hidden />
          {flagged}
        </span>
      )}

      {/*
        ⛔ 하나의 토글이다. 생김새가 상태고, 누르면 뒤집힌다.
           `aria-pressed`가 있어야 스크린리더도 «눌린 상태»로 읽는다.
      */}
      <Button
        size='sm'
        variant={done ? 'secondary' : 'outline'}
        aria-pressed={done}
        disabled={locked}
        title={
          locked
            ? '확정된 문서입니다. 확정을 해제한 뒤 다시 검수할 수 있습니다.'
            : done
              ? '누르면 확인을 취소합니다'
              : undefined
        }
        onClick={() => onChange({ state: done ? 'in_progress' : 'accepted' })}
        data-testid={`accept-${section}`}
      >
        {done && <Check className='size-3.5' aria-hidden />}
        {label(review.state)}
      </Button>

      {/*
        ⛔ 「없음」은 항목이 실제로 없을 때만 준다. 항목이 있는데 고를 수 있게
           두면 건너뛰는 길을 만들어 주는 셈이다. 서버도 막지만, 누를 수 있게
           그려놓고 409를 내는 것은 나쁘다.
      */}
      {!locked && itemCount === 0 && review.state !== 'empty' && (
        <Button
          size='sm'
          variant='ghost'
          className='text-muted-foreground'
          onClick={() => onChange({ state: 'empty' })}
          data-testid={`empty-${section}`}
        >
          <CircleSlash className='size-3.5' aria-hidden />
          회의에 없었음
        </Button>
      )}

      {!locked && (
        <RubricMenu
          section={section}
          review={review}
          onChange={(rubric) => onChange({ rubric })}
        />
      )}
    </div>
  )
}

/**
 * 기준별 판정.
 *
 * ⛔ **AI가 `pass`로 표시한 기준도 사람이 뒤집을 수 있다.** 뒤집을 수 없으면
 *    루브릭은 AI의 자기 채점이 된다 — Phase 0 결함 B가 그렇게 통과했다.
 */
function RubricMenu({
  section,
  review,
  onChange,
}: {
  section: ReviewSection
  review: SectionReview
  onChange: (rubric: Record<string, RubricVerdict>) => void
}) {
  const criteria = RUBRIC[section]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant='ghost'
          className='text-muted-foreground'
          data-testid={`rubric-${section}`}
        >
          기준 {criteria.length}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='w-[min(24rem,calc(100vw-2rem))]'
      >
        {criteria.map((c) => {
          const current = review.rubric[c.id]
          return (
            <DropdownMenuItem
              key={c.id}
              // 메뉴가 닫히면 다음 기준을 보려고 다시 열어야 한다
              onSelect={(e) => e.preventDefault()}
              className='flex-col items-start gap-2'
            >
              <span className='text-sm'>{c.question}</span>
              <div className='flex flex-wrap gap-1'>
                {(Object.keys(VERDICT_LABEL) as RubricVerdict[]).map((v) => (
                  <Button
                    key={v}
                    size='sm'
                    variant={current === v ? 'secondary' : 'ghost'}
                    className='h-7 px-2 text-xs'
                    aria-pressed={current === v}
                    onClick={() => onChange({ [c.id]: v })}
                    data-testid={`verdict-${c.id}-${v}`}
                  >
                    {VERDICT_LABEL[v]}
                  </Button>
                ))}
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
