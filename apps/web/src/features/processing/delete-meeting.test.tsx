/**
 * 회의 삭제 UI.
 *
 * ⛔ **왜 필요한가:** 녹음 중 브라우저가 죽으면 그 회의는 「수집 중」인 채로
 *    사이드바에 영원히 남았다. 실제로 3건이 쌓였고, 사용자가 화면에서는
 *    치울 수 없어 터미널로 지워야 했다.
 *
 * ⛔ **되돌릴 수 없는 조작이므로 반드시 확인을 받는다.** 51분짜리 녹음이
 *    한 번의 오클릭으로 사라지면 안 된다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DeleteMeeting } from './delete-meeting'

afterEach(() => vi.restoreAllMocks())

/** `body`가 아니라 `payload`다 — `Response.body`는 ReadableStream이라 타입이 충돌한다. */
function fetchStub(
  res: { ok?: boolean; status?: number; payload?: unknown } = {}
) {
  return vi.fn(
    async () =>
      ({
        ok: res.ok ?? true,
        status: res.status ?? 200,
        json: async () =>
          res.payload ?? { trashPath: '/d/.data/trash/src_01__x', moved: ['blobs'] },
      }) as unknown as Response
  )
}

const setup = async (over: Partial<Parameters<typeof DeleteMeeting>[0]> = {}) => {
  const fetchFn = over.fetchFn ?? fetchStub()
  const onDeleted = over.onDeleted ?? vi.fn()
  const screen = await render(
    <DeleteMeeting
      sourceId='src_01'
      label='08/06 12:19'
      fetchFn={fetchFn as never}
      onDeleted={onDeleted}
      {...over}
    />
  )
  return { screen, fetchFn, onDeleted }
}

describe('⛔ 확인 없이 지우지 않는다', () => {
  it('버튼만 눌러서는 요청이 나가지 않는다', async () => {
    const { screen, fetchFn } = await setup()

    await screen.getByRole('button', { name: '회의 삭제' }).click()

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('확인 창에 무엇이 사라지는지 이름이 나온다', async () => {
    const { screen } = await setup()
    await screen.getByRole('button', { name: '회의 삭제' }).click()

    // 어느 회의를 지우는지 모르면 확인이 아니다
    await expect.element(screen.getByText(/08\/06 12:19/)).toBeInTheDocument()
  })

  it('취소하면 아무 요청도 나가지 않는다', async () => {
    const { screen, fetchFn } = await setup()
    await screen.getByRole('button', { name: '회의 삭제' }).click()
    await screen.getByRole('button', { name: '취소' }).click()

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('확인해야 DELETE가 나간다', async () => {
    const { screen, fetchFn } = await setup()
    await screen.getByRole('button', { name: '회의 삭제' }).click()
    await screen.getByRole('button', { name: '삭제' }).click()

    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    expect(fetchFn).toHaveBeenCalledWith('/api/sources/src_01', { method: 'DELETE' })
  })
})

describe('⛔ 소거가 아니라는 것을 화면이 밝힌다', () => {
  // 서버는 휴지통으로 옮긴다. 화면이 "완전히 삭제됩니다"라고 하면 거짓이고,
  // 아무 말도 안 하면 사용자는 디스크가 비었다고 착각한다.

  it('확인 창이 휴지통으로 간다고 말한다', async () => {
    const { screen } = await setup()
    await screen.getByRole('button', { name: '회의 삭제' }).click()

    await expect.element(screen.getByText(/휴지통/)).toBeInTheDocument()
  })

  it('⛔ "완전히 삭제"라고 쓰지 않는다 — 사실이 아니다', async () => {
    const { screen } = await setup()
    await screen.getByRole('button', { name: '회의 삭제' }).click()

    expect(document.body.textContent).not.toContain('완전히 삭제')
    expect(document.body.textContent).not.toContain('영구')
  })
})

describe('결과를 알린다', () => {
  it('성공하면 onDeleted를 부른다', async () => {
    const { screen, onDeleted } = await setup()
    await screen.getByRole('button', { name: '회의 삭제' }).click()
    await screen.getByRole('button', { name: '삭제' }).click()

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith('src_01'))
  })

  it('⛔ 실패하면 사라진 척하지 않는다', async () => {
    const fetchFn = fetchStub({
      ok: false,
      status: 409,
      payload: { error: 'src_01는 지금 전사 중이라 삭제할 수 없습니다.' },
    })
    const { screen, onDeleted } = await setup({ fetchFn: fetchFn as never })

    await screen.getByRole('button', { name: '회의 삭제' }).click()
    await screen.getByRole('button', { name: '삭제' }).click()

    // 서버가 거절한 이유를 그대로 보여준다
    await expect.element(screen.getByRole('alert')).toBeInTheDocument()
    expect(document.body.textContent).toContain('전사 중이라')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('네트워크가 끊겨도 화면이 무반응으로 끝나지 않는다', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('연결 실패')
    })
    const { screen, onDeleted } = await setup({ fetchFn: fetchFn as never })

    await screen.getByRole('button', { name: '회의 삭제' }).click()
    await screen.getByRole('button', { name: '삭제' }).click()

    await expect.element(screen.getByRole('alert')).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
