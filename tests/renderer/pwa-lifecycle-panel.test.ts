import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import PwaLifecyclePanel from '../../src/renderer/src/components/PwaLifecyclePanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState } from '../../src/shared/types.js'
import type { PwaLifecycleReport } from '../../src/shared/pwa-lifecycle.js'

const original = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => { cleanup(); if (original) Object.defineProperty(window, 'hronaut', original); else Reflect.deleteProperty(window, 'hronaut') })
const tab = (id: string, active = false) => ({ id, pwaLifecycleActive: active }) as BrowserTabState
function report(tabId: string, reason: string): PwaLifecycleReport {
  return { tabId, captureId: tabId, origin: 'https://example.test', active: false, reason, startedAt: 1, stoppedAt: 2, events: [], truncated: false, missingHistory: true, interrupted: true, lastDrainedAt: 1, coverage: 'observed-only', caveats: [] }
}
it('discards a late response from a previously selected tab', async () => {
  let resolve!: (value: PwaLifecycleReport) => void
  const first = new Promise<PwaLifecycleReport>(done => { resolve = done })
  const api = vi.fn().mockReturnValueOnce(first).mockResolvedValue(report('b', 'current-capture'))
  Object.defineProperty(window, 'hronaut', { configurable: true, value: { pwaLifecycle: api } })
  const view = render(PwaLifecyclePanel, { props: { tab: tab('a') }, global: { plugins: [createHronautI18n('en-US')] } })
  await view.rerender({ tab: tab('b') })
  await screen.findByText(/current-capture/)
  resolve(report('a', 'stale-capture'))
  await waitFor(() => expect(screen.queryByText(/stale-capture/)).toBeNull())
})
it('keeps trusted stop available while a refresh is pending', async () => {
  const api = vi.fn().mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValue(report('a', 'stopped'))
  Object.defineProperty(window, 'hronaut', { configurable: true, value: { pwaLifecycle: api } })
  render(PwaLifecyclePanel, { props: { tab: tab('a', true) }, global: { plugins: [createHronautI18n('en-US')] } })
  const stop = screen.getByRole('button', { name: 'Stop observing workers' })
  expect(stop).not.toBeDisabled()
  await fireEvent.click(stop)
  await waitFor(() => expect(api).toHaveBeenLastCalledWith({ tabId: 'a', action: 'stop' }))
  await screen.findByText(/Capture stopped/)
})
