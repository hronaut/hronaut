import { fireEvent, render, screen, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmulationFrame from '../../src/renderer/src/features/emulation/EmulationFrame.vue'
import { fittedViewport, rotatedViewport } from '../../src/renderer/src/features/emulation/useEmulationFrameController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { EmulationFrameGeometry, HronautEmulationFrameApi } from '../../src/shared/emulation-frame.js'
import type { BrowserState, BrowserViewportEmulation } from '../../src/shared/types.js'

const original = window.hronautEmulationFrame
afterEach(() => { window.hronautEmulationFrame = original })

const desktop: BrowserViewportEmulation = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' }
const frame = (overrides: Partial<EmulationFrameGeometry> = {}): EmulationFrameGeometry => ({
  tabId: 'tab-1', bounds: { x: 354, y: 91, width: 1440, height: 900 }, area: { x: 254, y: 48, width: 1640, height: 986 },
  viewport: desktop, available: { width: 1640, height: 986 }, ...overrides
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(initial: EmulationFrameGeometry[] | Promise<EmulationFrameGeometry[]>) {
  let changed!: (frames: EmulationFrameGeometry[]) => void
  const unsubscribe = vi.fn()
  const api: HronautEmulationFrameApi = { get: vi.fn(async () => initial), onChanged: listener => { changed = listener; return unsubscribe } }
  window.hronautEmulationFrame = api
  let mutation = 0
  let current = 0
  const props = {
    setTabViewport: vi.fn(async (_tabId: string, _viewport: BrowserViewportEmulation | null) => ({}) as BrowserState),
    syncState: vi.fn(async (operation: Promise<BrowserState>) => { await operation }),
    beginMutation: vi.fn(() => (current = ++mutation)),
    isMutationCurrent: vi.fn((sequence: number) => sequence === current),
    onApplied: vi.fn((_tabId: string) => undefined)
  }
  const view = render(EmulationFrame, { props, global: { plugins: [createHronautI18n('en-US')] } })
  return { view, props, changed: (frames: EmulationFrameGeometry[]) => changed(frames), unsubscribe, newerMutation: () => { current = ++mutation } }
}

it('frames a smaller emulated page with its size and one-click viewport actions', async () => {
  const { view, props, unsubscribe } = setup([frame()])
  const bar = await screen.findByRole('group', { name: 'Emulated viewport 1,440 × 900' })
  expect(within(bar).getByText('1,440 × 900 · Desktop')).toBeTruthy()
  expect(screen.getByTestId('emulation-frame')).toHaveStyle({ left: '254px', top: '48px', width: '1640px', height: '986px' })
  // The bar sits above the page, centered on it.
  expect(bar).toHaveStyle({ left: '820px', top: '7px' })

  await fireEvent.click(within(bar).getByRole('button', { name: 'Rotate viewport' }))
  expect(props.setTabViewport).toHaveBeenLastCalledWith('tab-1', { ...desktop, width: 900, height: 1440, orientation: 'portrait' })
  // An open Responsive preview is told, so its Apply does not undo the change.
  await vi.waitFor(() => expect(props.onApplied).toHaveBeenCalledWith('tab-1'))
  await vi.waitFor(() => expect(within(bar).getByRole('button', { name: 'Fit viewport to window' })).toBeEnabled())
  await fireEvent.click(within(bar).getByRole('button', { name: 'Fit viewport to window' }))
  expect(props.setTabViewport).toHaveBeenLastCalledWith('tab-1', { ...desktop, width: 1640, height: 986 })
  await vi.waitFor(() => expect(within(bar).getByRole('button', { name: 'Use window size' })).toBeEnabled())
  await fireEvent.click(within(bar).getByRole('button', { name: 'Use window size' }))
  expect(props.setTabViewport).toHaveBeenLastCalledWith('tab-1', null)
  view.unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('shows mobile conditions, moves the bar below, beside or away when there is no room above', async () => {
  const phone: BrowserViewportEmulation = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' }
  const { changed } = setup([frame({ viewport: phone, bounds: { x: 879, y: 48, width: 390, height: 844 } })])
  const bar = await screen.findByRole('group', { name: 'Emulated viewport 390 × 844' })
  expect(within(bar).getByText('390 × 844 · Mobile · 3× pixel ratio')).toBeTruthy()
  expect(bar).toHaveStyle({ top: '848px' })
  // Only the sides have room: a card beside the page, its right edge a gap away from the page.
  changed([frame({ bounds: { x: 454, y: 48, width: 1240, height: 986 } })])
  const card = await screen.findByRole('group', { name: 'Emulated viewport 1,440 × 900' })
  expect(card).toHaveClass('emulation-frame-bar-side')
  expect(card).toHaveStyle({ left: '20px', top: '4px', width: '176px' })
  expect(card.querySelector('.emulation-frame-caption')?.textContent).toBe('1,440 × 900\nDesktop')
  expect(within(card).getAllByRole('button')).toHaveLength(3)
  // Neither above, below nor beside: no bar; the toolbar still shows the emulation.
  changed([frame({ bounds: { x: 354, y: 48, width: 1440, height: 986 } })])
  await vi.waitFor(() => expect(screen.queryByRole('group')).toBeNull())
  expect(screen.getByTestId('emulation-frame')).toBeTruthy()
  changed([])
  await vi.waitFor(() => expect(screen.queryByTestId('emulation-frame')).toBeNull())
})

it('tells Responsive preview about a change that removed the frame before it settled', async () => {
  const { props, changed } = setup([frame()])
  const bar = await screen.findByRole('group', { name: 'Emulated viewport 1,440 × 900' })
  const applied = deferred<BrowserState>()
  props.setTabViewport.mockReturnValueOnce(applied.promise)
  await fireEvent.click(within(bar).getByRole('button', { name: 'Use window size' }))
  // Main publishes the tab without a frame before the change's own reply.
  changed([])
  applied.resolve({} as BrowserState)
  await vi.waitFor(() => expect(props.onApplied).toHaveBeenCalledWith('tab-1'))
})

it('keeps a newer published frame over a slower first read', async () => {
  const read = deferred<EmulationFrameGeometry[]>()
  const { changed } = setup(read.promise)
  changed([])
  read.resolve([frame()])
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.queryByTestId('emulation-frame')).toBeNull()
})

it('reports a failed change only while no newer viewport change has started', async () => {
  const { props, newerMutation } = setup([frame()])
  const bar = await screen.findByRole('group', { name: 'Emulated viewport 1,440 × 900' })
  const first = deferred<BrowserState>()
  props.setTabViewport.mockReturnValueOnce(first.promise)
  await fireEvent.click(within(bar).getByRole('button', { name: 'Rotate viewport' }))
  // One change at a time per tab.
  expect(within(bar).getByRole('button', { name: 'Use window size' })).toBeDisabled()
  newerMutation()
  first.reject(new Error('superseded'))
  await vi.waitFor(() => expect(within(bar).getByRole('button', { name: 'Use window size' })).toBeEnabled())
  expect(screen.queryByRole('alert')).toBeNull()

  expect(props.onApplied).not.toHaveBeenCalled()

  props.setTabViewport.mockRejectedValueOnce(new Error('Emulation target changed'))
  await fireEvent.click(within(bar).getByRole('button', { name: 'Use window size' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The viewport could not be changed.')
})

it('reports a failure on the other split view pane, and drops it once the viewport changes elsewhere', async () => {
  const second = frame({ tabId: 'tab-2', area: { x: 1000, y: 48, width: 894, height: 986 }, bounds: { x: 1100, y: 91, width: 600, height: 900 } })
  const { props, changed } = setup([frame(), second])
  const bars = await screen.findAllByRole('group')
  expect(bars).toHaveLength(2)
  props.setTabViewport.mockRejectedValueOnce(new Error('Emulation target changed'))
  await fireEvent.click(within(bars[1]).getByRole('button', { name: 'Rotate viewport' }))
  expect(props.setTabViewport).toHaveBeenLastCalledWith('tab-2', expect.objectContaining({ width: 900, height: 1440 }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The viewport could not be changed.')

  // The same viewport republished, such as after a window resize: the error stays.
  changed([frame(), { ...second, area: { ...second.area, height: 900 } }])
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.getByRole('alert')).toBeTruthy()
  // Responsive preview or an agent changed the viewport since: the error no longer applies.
  changed([frame(), { ...second, viewport: { ...desktop, width: 1280, height: 800 } }])
  await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

describe('emulation frame viewports', () => {
  it('rotates width, height and orientation together', () => {
    expect(rotatedViewport({ ...desktop, deviceScaleFactor: 2 })).toEqual({ ...desktop, deviceScaleFactor: 2, width: 900, height: 1440, orientation: 'portrait' })
  })

  it('fits the space while keeping the device conditions, within the sizes Responsive preview accepts', () => {
    const phone: BrowserViewportEmulation = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' }
    expect(fittedViewport(phone, { width: 1640.6, height: 986 })).toEqual({ ...phone, width: 1640, height: 986, orientation: 'landscape' })
    expect(fittedViewport(phone, { width: 120, height: 5000 })).toEqual({ ...phone, width: 200, height: 3840, orientation: 'portrait' })
  })
})
