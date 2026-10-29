import type { Rectangle } from 'electron'
import type { EmulationFrameGeometry } from '../../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../../shared/page-card.js'
import { SPLIT_VIEW_GAP, splitViewBounds } from '../../../shared/split-view.js'
import type { PageGeometryAccess, PageGeometryTab } from './page-geometry-access.js'

/**
 * Tabs emulating a viewport smaller than their space, for the renderer to
 * frame. Their pages keep the emulated size, centered in that space.
 */
export function getEmulationFrames<Tab extends PageGeometryTab>(access: PageGeometryAccess<Tab>): EmulationFrameGeometry[] {
  if (access.isDestroyed() || access.window().isDestroyed() || access.window().webContents.isDestroyed() || !access.activeTabId()
    || access.toolbarHeight() >= access.window().getContentBounds().height - 1) return []
  if (access.browserContentOccluded()) return access.occlusionSnapshot().active ? access.occludedEmulationFrames() : []
  const area = access.browserViewBounds()
  const scale = access.window().webContents.getZoomFactor?.() ?? 1
  const first = access.splitView() ? access.findTab(access.splitView()!.firstTabId) : undefined
  const second = access.splitView() ? access.findTab(access.splitView()!.secondTabId) : undefined
  const split = access.splitView() && first && second
    ? splitViewBounds(area, access.splitView()!.orientation, access.splitView()!.ratio, Math.round(SPLIT_VIEW_GAP * scale))
    : undefined
  const panes: Array<[Tab | undefined, Rectangle]> = split
    ? [[first, split.first], [second, split.second]]
    : [[access.findTab(access.activeTabId()!), area]]
  const cssBounds = (rect: Rectangle): Rectangle => ({
    x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale
  })
  const frames: EmulationFrameGeometry[] = []
  for (const [tab, space] of panes) {
    const viewport = tab?.emulation.viewport
    // A tab whose page is out of the window, such as one closing behind its beforeunload check, has no frame.
    if (!tab || !viewport || !tab.emulationViewSize || !access.window().contentView.children.includes(tab.view)) continue
    const bounds = access.tabViewBounds(tab, space)
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
export function getPageCards<Tab extends PageGeometryTab>(access: PageGeometryAccess<Tab>): PageCardGeometry[] {
  if (access.isDestroyed() || access.window().isDestroyed() || access.window().webContents.isDestroyed() || !access.activeTabId()
    || access.toolbarHeight() >= access.window().getContentBounds().height - 1) return []
  // While a picture stands in for the pages, their cards name no tab: the edge light waits for the live page.
  if (access.browserContentOccluded()) {
    return access.occlusionSnapshot().active ? access.occludedPageCards().map(({ x, y, width, height }) => ({ x, y, width, height })) : []
  }
  const area = access.browserViewBounds()
  const scale = access.window().webContents.getZoomFactor?.() ?? 1
  const first = access.splitView() ? access.findTab(access.splitView()!.firstTabId) : undefined
  const second = access.splitView() ? access.findTab(access.splitView()!.secondTabId) : undefined
  const split = access.splitView() && first && second
    ? splitViewBounds(area, access.splitView()!.orientation, access.splitView()!.ratio, Math.round(SPLIT_VIEW_GAP * scale))
    : undefined
  const panes = split && first && second
    ? [{ tab: first, space: split.first }, { tab: second, space: split.second }]
    : [{ tab: access.findTab(access.activeTabId()!), space: area }]
  return panes.filter(({ space }) => space.width > 0 && space.height > 0).map(({ tab, space }) => ({
    x: space.x / scale, y: space.y / scale, width: space.width / scale, height: space.height / scale,
    // A page out of the window, such as one closing behind its beforeunload check, is not the one in its card.
    ...(tab && access.window().contentView.children.includes(tab.view) ? { tabId: tab.id } : {})
  }))
}

/** Tells the shell where the page cards and the frames around emulated pages are now. */
export function publishPageGeometry<Tab extends PageGeometryTab>(access: PageGeometryAccess<Tab>): void {
  // A destroyed window has no webContents to read.
  if (access.window().isDestroyed() || access.window().webContents.isDestroyed()) return
  const frames = getEmulationFrames(access)
  const serializedFrames = JSON.stringify(frames)
  if (serializedFrames !== access.lastEmulationFrames()) {
    access.setLastEmulationFrames(serializedFrames)
    access.window().webContents.send('emulation-frame:changed', frames)
  }
  const cards = getPageCards(access)
  const serializedCards = JSON.stringify(cards)
  if (serializedCards !== access.lastPageCards()) {
    access.setLastPageCards(serializedCards)
    access.window().webContents.send('page-card:changed', cards)
  }
}
