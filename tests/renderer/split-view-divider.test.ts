import { render, screen, fireEvent } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import SplitViewDivider from '../../src/renderer/src/components/SplitViewDivider.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { HronautSplitDividerApi, SplitDividerGeometry } from '../../src/shared/split-view.js'

const original = window.hronautSplitDivider
afterEach(() => { window.hronautSplitDivider = original })
it('renders the native gutter geometry and accessible keyboard/reset actions', async () => {
  const geometry: SplitDividerGeometry = { revision: 4, firstTabId: 'a', secondTabId: 'b', orientation: 'horizontal', ratio: .6, bounds: { x: 30, y: 400, width: 700, height: 12 }, area: { x: 30, y: 80, width: 700, height: 620 }, gap: 12, scale: 1.25 }
  let changed!: (next: SplitDividerGeometry | null) => void
  const unsubscribe = vi.fn()
  const setRatio = vi.fn(async () => geometry)
  const api: HronautSplitDividerApi = { get: vi.fn(async () => geometry), begin: vi.fn(async () => null), update: vi.fn(async () => null), finish: vi.fn(async () => null), setRatio, onChanged: listener => { changed = listener; return unsubscribe } }
  window.hronautSplitDivider = api
  const view = render(SplitViewDivider, { global: { plugins: [createHronautI18n('en-US')] } })
  const divider = await screen.findByRole('separator', { name: 'Resize split view' })
  expect(divider).toHaveAttribute('aria-orientation', 'horizontal')
  expect(divider).toHaveAttribute('aria-valuenow', '60')
  expect(divider).toHaveAttribute('aria-valuetext', '60% for the first pane')
  expect(divider).toHaveAttribute('tabindex', '0')
  expect(divider).toHaveStyle({ left: '30px', top: '400px', height: '12px', width: '700px' })
  await fireEvent.keyDown(divider, { key: 'ArrowUp' })
  expect(setRatio).toHaveBeenCalledWith(4, .59)
  await fireEvent.dblClick(divider)
  expect(setRatio).toHaveBeenLastCalledWith(4, .5)
  changed(null)
  await view.rerender({})
  expect(screen.queryByRole('separator')).toBeNull()
  view.unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
