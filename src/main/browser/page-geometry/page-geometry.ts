import type { Rectangle } from 'electron'
import type { EmulationFrameGeometry } from '../../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../../shared/page-card.js'
import { SPLIT_VIEW_GAP, splitViewBounds } from '../../../shared/split-view.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserViewBounds } from '../window-layout/content-area.js'

/**
 * Tabs emulating a viewport smaller than their space, for the renderer to
 * frame. Their pages keep the emulated size, centered in that space.
 */
export function getEmulationFrames(browser: Browser): EmulationFrameGeometry[] {
  if (browser.destroyed || browser.window.isDestroyed() || browser.window.webContents.isDestroyed() || !browser.activeTabId
    || browser.toolbarHeight >= browser.window.getContentBounds().height - 1) return []
  if (browser.browserContentOccluded) return browser.occlusionSnapshot.active ? browser.occludedEmulationFrames : []
  const area = browserViewBounds(browser)
  const scale = browser.window.webContents.getZoomFactor?.() ?? 1
  const first = browser.splitView ? findTab(browser, browser.splitView!.firstTabId) : undefined
  const second = browser.splitView ? findTab(browser, browser.splitView!.secondTabId) : undefined
  const split = browser.splitView && first && second
    ? splitViewBounds(area, browser.splitView!.orientation, browser.splitView!.ratio, Math.round(SPLIT_VIEW_GAP * scale))
    : undefined
  const panes: Array<[BrowserTab | undefined, Rectangle]> = split
    ? [[first, split.first], [second, split.second]]
    : [[findTab(browser, browser.activeTabId!), area]]
  const cssBounds = (rect: Rectangle): Rectangle => ({
    x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale
  })
  const frames: EmulationFrameGeometry[] = []
  for (const [tab, space] of panes) {
    const viewport = tab?.emulation.viewport
    // A tab whose page is out of the window, such as one closing behind its beforeunload check, has no frame.
    if (!tab || !viewport || !tab.emulationViewSize || !browser.window.contentView.children.includes(tab.view)) continue
    const bounds = browser.tabViewBounds(tab, space)
    if (bounds.width === space.width && bounds.height === space.height) continue
    frames.push({
      tabId: tab.id, bounds: cssBounds(bounds), area: cssBounds(space),
      viewport: { ...viewport }, available: { width: space.width, height: space.height }
    })
  }
  return frames
}

/**
 * The pages' spaces in shell CSS pixels, one per pane, for the shell to draw
 * each page's card under it. An emulated page's card is its whole space,
 * which its frame fills.
 */
export function getPageCards(browser: Browser): PageCardGeometry[] {
  if (browser.destroyed || browser.window.isDestroyed() || browser.window.webContents.isDestroyed() || !browser.activeTabId
    || browser.toolbarHeight >= browser.window.getContentBounds().height - 1) return []
  // While a picture stands in for the pages, their cards name no tab: the edge light waits for the live page.
  if (browser.browserContentOccluded) {
    return browser.occlusionSnapshot.active ? browser.occludedPageCards.map(({ x, y, width, height }) => ({ x, y, width, height })) : []
  }
  const area = browserViewBounds(browser)
  const scale = browser.window.webContents.getZoomFactor?.() ?? 1
  const first = browser.splitView ? findTab(browser, browser.splitView!.firstTabId) : undefined
  const second = browser.splitView ? findTab(browser, browser.splitView!.secondTabId) : undefined
  const split = browser.splitView && first && second
    ? splitViewBounds(area, browser.splitView!.orientation, browser.splitView!.ratio, Math.round(SPLIT_VIEW_GAP * scale))
    : undefined
  const panes = split && first && second
    ? [{ tab: first, space: split.first }, { tab: second, space: split.second }]
    : [{ tab: findTab(browser, browser.activeTabId!), space: area }]
  return panes.filter(({ space }) => space.width > 0 && space.height > 0).map(({ tab, space }) => ({
    x: space.x / scale, y: space.y / scale, width: space.width / scale, height: space.height / scale,
    // A page out of the window, such as one closing behind its beforeunload check, is not the one in its card.
    ...(tab && browser.window.contentView.children.includes(tab.view) ? { tabId: tab.id } : {})
  }))
}

/** Tells the shell where the page cards and the frames around emulated pages are now. */
export function publishPageGeometry(browser: Browser): void {
  // A destroyed window has no webContents to read.
  if (browser.window.isDestroyed() || browser.window.webContents.isDestroyed()) return
  const frames = getEmulationFrames(browser)
  const serializedFrames = JSON.stringify(frames)
  if (serializedFrames !== browser.lastEmulationFrames) {
    browser.lastEmulationFrames = serializedFrames
    browser.window.webContents.send('emulation-frame:changed', frames)
  }
  const cards = getPageCards(browser)
  const serializedCards = JSON.stringify(cards)
  if (serializedCards !== browser.lastPageCards) {
    browser.lastPageCards = serializedCards
    browser.window.webContents.send('page-card:changed', cards)
  }
}
