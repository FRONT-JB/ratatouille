import { Check, CircleSlash, TriangleAlert } from 'lucide-react'
import {
  RUBRIC,
  type ReviewSection,
  type RubricVerdict,
  type SectionReview,
  type SectionReviewState,
} from '@ratatouille/contracts'
import { Badge } from '@/components/ui/badge'
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
 * ⛔ **루브릭이 「클릭해야 하는 행정 절차」가 되면 아무도 제대로 안 본다.**
 *    그래서 기본 동작은 버튼 **하나**다 — 읽고 「확인함」. 기준별 판정은
 *    문제를 발견했을 때만 펼쳐 쓴다.
 *
 * ⛔ **AI 판정을 사람의 확인으로 치지 않는다.** 여기서 사람이 누르지 않으면
 *    section은 영원히 `unreviewed`이고 문서는 확정되지 않는다.
 */

const STATE_LABEL: Record<SectionReviewState, string> = {
  unreviewed: '확인 전',
  in_progress: '보는 중',
  accepted: '확인함',
  edited: '고침',
  empty: '없음',
}

const VERDICT_LABEL: Record<RubricVerdict, string> = {
  pass: '괜찮음',
  fix_required: '수정 필요',
  uncertain: '확인 필요',
  not_applicable: '해당 없음',
}

/** 확정을 막는 판정. 화면이 판정하지 않고 계약과 같은 값을 본다 */
const BLOCKING: RubricVerdict[] = ['fix_required', 'uncertain']

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
  const done = review.state === 'accepted' || review.state === 'edited'
  const flagged = Object.values(review.rubric).filter((v) =>
    BLOCKING.includes(v)
  ).length

  return (
    <div
      className='flex flex-wrap items-center gap-2'
      data-review-section={section}
      data-review-state={review.state}
    >
      <Badge
        variant={done || review.state === 'empty' ? 'secondary' : 'outline'}
        className={flagged > 0 ? 'text-state-warning' : undefined}
      >
        {STATE_LABEL[review.state]}
      </Badge>

      {flagged > 0 && (
        <span className='text-state-warning flex items-center gap-1 text-xs'>
          <TriangleAlert className='size-3.5' aria-hidden />
          {flagged}건 남음
        </span>
      )}

      {!locked && (
        <>
          <Button
            size='sm'
            variant={done ? 'ghost' : 'secondary'}
            onClick={() => onChange({ state: done ? 'in_progress' : 'accepted' })}
            data-testid={`accept-${section}`}
          >
            <Check className='size-3.5' aria-hidden />
            {done ? '확인 취소' : '확인함'}
          </Button>

          {/*
            ⛔ 「없음」은 항목이 실제로 없을 때만 준다. 항목이 있는데 「없음」을
               고를 수 있게 두면 건너뛰는 길을 만들어 주는 셈이다.
               서버도 막지만, 누를 수 있게 그려놓고 409를 내는 것은 나쁘다.
          */}
          {itemCount === 0 && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => onChange({ state: 'empty' })}
              data-testid={`empty-${section}`}
            >
              <CircleSlash className='size-3.5' aria-hidden />
              회의에 없었음
            </Button>
          )}

          <RubricMenu
            section={section}
            review={review}
            onChange={(rubric) => onChange({ rubric })}
          />
        </>
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
          기준 {criteria.length}개
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-96'>
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
