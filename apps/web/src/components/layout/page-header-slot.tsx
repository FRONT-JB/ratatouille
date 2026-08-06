import { createContext, use, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 페이지가 **상단 바에** 내용을 넣는 자리.
 *
 * ⛔ 페이지마다 자기 `<Header>`를 그리게 하지 않는다. 좁은 화면에서 상단 바의
 *    `SidebarTrigger`는 내비게이션의 **유일한 진입점**이라, 한 페이지라도
 *    빠뜨리면 그 화면에서 이동이 막힌다.
 *
 * ⚠️ context에 setState를 effect로 밀어넣지 않는다. 자리 element를 ref
 *    callback으로 받아 portal로 그린다 — 렌더 중 상태를 만지지 않는다.
 */
const SlotContext = createContext<HTMLElement | null>(null)

export function PageHeaderSlotProvider({
  children,
}: {
  children: (slot: (el: HTMLElement | null) => void) => React.ReactNode
}) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  return <SlotContext value={node}>{children(setNode)}</SlotContext>
}

/**
 * 상단 바에 그린다.
 *
 * ⛔ **자리가 없으면 제자리에 그린다.** 셸 없이 페이지만 띄우는 경우(테스트,
 *    다른 레이아웃)에 제목이 통째로 사라지면 안 된다. 사라지는 쪽이 조용해서
 *    더 위험하다.
 */
export function PageHeader({ children }: { children: React.ReactNode }) {
  const node = use(SlotContext)
  return node ? createPortal(children, node) : <>{children}</>
}
