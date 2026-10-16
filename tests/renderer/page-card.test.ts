import { render } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PageCard from '../../src/renderer/src/components/PageCard.vue'
import type { HronautPageCardApi, PageCardGeometry } from '../../src/shared/page-card.js'

const original = window.hronautPageCard
afterEach(() => { window.hronautPageCard = original })

function setup(initial: Promise<PageCardGeometry[]>) {
  let changed!: (cards: PageCardGeometry[]) => void
  const unsubscribe = vi.fn()
  const api: HronautPageCardApi = { get: vi.fn(() => initial), onChanged: (listener) => { changed = listener; return unsubscribe } }
  window.hronautPageCard = api
  const view = render(PageCard)
  return { view, unsubscribe, changed: (cards: PageCardGeometry[]) => changed(cards) }
}

const cards = (view: ReturnType<typeof render>) => [...view.container.querySelectorAll<HTMLElement>('.page-card')]
  .map((card) => [card.style.left, card.style.top, card.style.width, card.style.height])

it('draws one card under each page where the main process placed it, and none without a page', async () => {
  const { view, changed, unsubscribe } = setup(Promise.resolve([{ x: 280, y: 60, width: 1150, height: 830 }]))
  await vi.waitFor(() => expect(cards(view)).toEqual([['280px', '60px', '1150px', '830px']]))
  expect(view.container.querySelector('.page-card')?.getAttribute('aria-hidden')).toBe('true')

  // Split view: a card for each pane, with the gap between them left bare.
  changed([{ x: 280, y: 60, width: 569, height: 830 }, { x: 861, y: 60, width: 569, height: 830 }])
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
  changed([{ x: 10, y: 104, width: 1420, height: 786 }])
  resolve([{ x: 0, y: 105, width: 1440, height: 795 }])
  await new Promise((done) => setTimeout(done))
  expect(cards(view)).toEqual([['10px', '104px', '1420px', '786px']])
})
