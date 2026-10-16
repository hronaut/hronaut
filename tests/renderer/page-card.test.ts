import { render } from '@testing-library/vue'
import type { BrowserTabState, UserAttentionRequest } from '../../src/shared/types.js'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PageCard from '../../src/renderer/src/components/PageCard.vue'
import type { HronautPageCardApi, PageCardGeometry } from '../../src/shared/page-card.js'

const original = window.hronautPageCard
afterEach(() => { window.hronautPageCard = original })

function setup(initial: Promise<PageCardGeometry[]>, props: { userAttention?: Pick<UserAttentionRequest, 'id' | 'tabId' | 'workspaceId'> | null; tabs?: Pick<BrowserTabState, 'id' | 'mcpGroupId'>[] } = {}) {
  let changed!: (cards: PageCardGeometry[]) => void
  const unsubscribe = vi.fn()
  const api: HronautPageCardApi = { get: vi.fn(() => initial), onChanged: (listener) => { changed = listener; return unsubscribe } }
  window.hronautPageCard = api
  const view = render(PageCard, { props })
  return { view, unsubscribe, changed: (cards: PageCardGeometry[]) => changed(cards) }
}

const cards = (view: ReturnType<typeof render>) => [...view.container.querySelectorAll<HTMLElement>('.page-card')]
  .map((card) => [card.style.left, card.style.top, card.style.width, card.style.height])

it('draws one card under each page where the main process placed it, and none without a page', async () => {
  const { view, changed, unsubscribe } = setup(Promise.resolve([{ x: 280, y: 60, width: 1150, height: 830, tabId: 'tab-1' }]))
  await vi.waitFor(() => expect(cards(view)).toEqual([['280px', '60px', '1150px', '830px']]))
  expect(view.container.querySelector('.page-card')?.getAttribute('aria-hidden')).toBe('true')

  // Split view: a card for each pane, with the gap between them left bare.
  changed([{ x: 280, y: 60, width: 569, height: 830, tabId: 'tab-1' }, { x: 861, y: 60, width: 569, height: 830, tabId: 'tab-2' }])
  await nextTick()
  expect(cards(view)).toEqual([['280px', '60px', '569px', '830px'], ['861px', '60px', '569px', '830px']])

  changed([])
  await nextTick()
  expect(cards(view)).toEqual([])
  view.unmount()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('keeps a change that arrives before the first read instead of the older read', async () => {
  let resolve!: (value: PageCardGeometry[]) => void
  const { view, changed } = setup(new Promise((done) => { resolve = done }))
  changed([{ x: 10, y: 104, width: 1420, height: 786, tabId: 'tab-1' }])
  resolve([{ x: 0, y: 105, width: 1440, height: 795, tabId: 'tab-1' }])
  await new Promise((done) => setTimeout(done))
  expect(cards(view)).toEqual([['10px', '104px', '1420px', '786px']])
})

it('lights the page that needs you, or the pages of the workspace that does, until the request ends', async () => {
  const split = [{ x: 280, y: 60, width: 569, height: 830, tabId: 'tab-1' }, { x: 861, y: 60, width: 569, height: 830, tabId: 'tab-2' }]
  const tabs = [{ id: 'tab-1', mcpGroupId: 'checkout' }, { id: 'tab-2', mcpGroupId: 'admin' }]
  const { view } = setup(Promise.resolve(split), { userAttention: { id: 'request-1', tabId: 'tab-2', workspaceId: 'admin' }, tabs })
  const lit = () => [...view.container.querySelectorAll<HTMLElement>('.page-card')].map((card) => card.classList.contains('needs-you'))
  await vi.waitFor(() => expect(lit()).toEqual([false, true]))
  // A request for a whole workspace lights each of its pages in view.
  await view.rerender({ userAttention: { id: 'request-2', workspaceId: 'checkout' }, tabs })
  expect(lit()).toEqual([true, false])
  // A new request on a lit page draws its light again, so it swells once more.
  const before = view.container.querySelector('.page-card.needs-you')
  await view.rerender({ userAttention: { id: 'request-3', workspaceId: 'checkout' }, tabs })
  expect(lit()).toEqual([true, false])
  expect(view.container.querySelector('.page-card.needs-you')).not.toBe(before)
  // The light holds until the request ends, and a request elsewhere lights nothing here.
  await view.rerender({ userAttention: { id: 'request-4', tabId: 'tab-9', workspaceId: 'admin' }, tabs })
  expect(lit()).toEqual([false, false])
  await view.rerender({ userAttention: null, tabs })
  expect(lit()).toEqual([false, false])
})
