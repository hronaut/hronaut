import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { PAGE_CARD_GUTTER, PAGE_CARD_RADIUS, pageCardInsets } from '../src/shared/page-card.js'

function pageView() {
  return { setBounds: vi.fn(), setVisible: vi.fn(), setBorderRadius: vi.fn(), getVisible: () => true }
}

function fixture(zoom: number, split = false) {
  const first = { id: 'first', view: pageView() }
  const second = { id: 'second', view: pageView() }
  const shell = { getZoomFactor: () => zoom, isDestroyed: () => false }
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    destroyed: false,
    window: { isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }), webContents: shell },
    tabs: new Map([[first.id, first], [second.id, second]]),
    activeTabId: first.id,
    splitView: split ? { firstTabId: first.id, secondTabId: second.id, orientation: 'vertical', ratio: 0.5 } : null,
    browserContentOccluded: false,
    toolbarHeight: 60,
    contentInsets: { top: 0, right: 10, bottom: 10, left: 280 },
    pageCornerRadii: new WeakMap(),
    occludedPageCards: [],
    occlusionSnapshot: { reconcile: vi.fn(), holdingPages: false, active: false },
    splitDivider: { reconcile: vi.fn() },
    reconcileTabPresentation: vi.fn(),
    scheduleTabOverviewPreview: vi.fn(),
    publishSplitDivider: vi.fn(),
    publishPageGeometry: vi.fn()
  }) as BrowserTabsManager
  return { manager, first, second, shell }
}

it.each([[1, 12], [1.1, 13], [1.25, 15]])('rounds the page in view to the shell page card at %sx interface scale', (zoom, radius) => {
  const { manager, first, second } = fixture(zoom)
  manager.layout()
  expect(first.view.setBorderRadius).toHaveBeenCalledWith(radius)
  expect(Math.round(PAGE_CARD_RADIUS * zoom)).toBe(radius)
  // A tab out of view gets its corners when it is next laid out.
  expect(second.view.setBorderRadius).not.toHaveBeenCalled()
})

it('rounds both pages of a split view and repeats no native call while the radius stays', () => {
  const { manager, first, second, shell } = fixture(1, true)
  manager.layout()
  manager.layout()
  expect(first.view.setBorderRadius).toHaveBeenCalledOnce()
  expect(second.view.setBorderRadius).toHaveBeenCalledOnce()
  shell.getZoomFactor = () => 1.25
  manager.layout()
  expect(first.view.setBorderRadius).toHaveBeenLastCalledWith(15)
  expect(second.view.setBorderRadius).toHaveBeenLastCalledWith(15)
})

it('places a card under each pane in shell pixels, keeps it under a dialog only while the page picture shows, and drops it without a page', () => {
  const single = fixture(1.25)
  // 1440 x 900 window pixels at 1.25: the space below a 60 px toolbar, inside the rail and the gutters.
  expect(single.manager.getPageCards()).toEqual([{ x: 224, y: 48, width: 920, height: 664 }])

  const split = fixture(1, true).manager
  const [left, right] = split.getPageCards()
  expect(left).toMatchObject({ x: 280, y: 60, height: 830 })
  expect(right!.x - (left!.x + left!.width)).toBe(12)
  expect(right!.x + right!.width).toBe(1430)

  const internals = split as unknown as { browserContentOccluded: boolean; occludedPageCards: unknown[]; occlusionSnapshot: { active: boolean }; toolbarHeight: number; activeTabId?: string }
  internals.browserContentOccluded = true
  internals.occludedPageCards = [left]
  expect(split.getPageCards()).toEqual([])
  internals.occlusionSnapshot.active = true
  expect(split.getPageCards()).toEqual([left])

  internals.browserContentOccluded = false
  internals.toolbarHeight = 899
  expect(split.getPageCards()).toEqual([])
  internals.toolbarHeight = 60
  internals.activeTabId = undefined
  expect(split.getPageCards()).toEqual([])
})

it('leaves the gutter at the window edges and beside panels, and none beside the rail or under the toolbar', () => {
  const gutter = PAGE_CARD_GUTTER
  expect(pageCardInsets({ railWidth: 280, dock: 'bottom', dockSize: 0, sidePanelInset: 0 })).toEqual({ top: 0, right: gutter, bottom: gutter, left: 280 })
  expect(pageCardInsets({ railWidth: 0, dock: 'window', dockSize: 0, sidePanelInset: 0 })).toEqual({ top: 0, right: gutter, bottom: gutter, left: gutter })
  expect(pageCardInsets({ railWidth: 280, dock: 'left', dockSize: 400, sidePanelInset: 0 })).toEqual({ top: 0, right: gutter, bottom: gutter, left: 680 + gutter })
  expect(pageCardInsets({ railWidth: 0, dock: 'top', dockSize: 200, sidePanelInset: 0 })).toEqual({ top: 200 + gutter, right: gutter, bottom: gutter, left: gutter })
  expect(pageCardInsets({ railWidth: 0, dock: 'right', dockSize: 300, sidePanelInset: 360 })).toEqual({ top: 0, right: 360 + gutter, bottom: gutter, left: gutter })
})
