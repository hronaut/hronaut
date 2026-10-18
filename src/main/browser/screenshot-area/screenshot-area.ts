import { createNativeSelectionSession } from '../native-selection-session.js'
import { cancelScreenshotAreaScript, screenshotAreaNativeInputScript, screenshotAreaScript } from '../page-scripts.js'
import { isHronautHomeUrl } from '../url.js'
import type { BrowserScreenshotAreaResult, BrowserScreenshotAreaSession, ScreenshotAreaAccess, ScreenshotAreaTab } from './screenshot-area-access.js'

// The same check the element picker and the human input guard make.
function nativeSelectionContextUnavailable(error: unknown): boolean {
  return /context.*destroyed|frame.*removed|navigat/i.test(String(error))
}

/**
 * Lets the person drag an area on a website tab's page and captures it as a
 * PNG, replacing a selection already in progress on that page. Native mouse
 * input reaches the selection overlay through the input queue; the result is
 * canceled when the person cancels, the page goes away, or a newer selection
 * replaces this one.
 */
export async function captureScreenshotArea<Tab extends ScreenshotAreaTab>(access: ScreenshotAreaAccess<Tab>, tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before capturing an area')
  const webContents = tab.webContents
  const existing = access.screenshotAreaSessions().get(webContents.id)
  if (existing) {
    existing.canceled = true
    existing.resolve({ canceled: true })
    await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
  }
  const session = createNativeSelectionSession<BrowserScreenshotAreaResult>() as BrowserScreenshotAreaSession
  tab.nativeInputEnvironmentGeneration += 1
  access.screenshotAreaSessions().set(webContents.id, session)
  try {
    if (access.isHumanInteractionLocked(tab)) await access.syncHumanInteractionInputGuard(tab)
    void webContents.executeJavaScript(screenshotAreaScript(), true)
      .then((selection: BrowserScreenshotAreaResult) => {
        if (selection?.canceled || (selection?.clip && selection?.viewport)) session.resolve(selection)
      })
      .catch((error: unknown) => {
        if (nativeSelectionContextUnavailable(error)) {
          session.resolve({ canceled: true })
        } else {
          session.reject(error)
        }
      })
    const selection = await session.result
    if (session.canceled || access.screenshotAreaSessions().get(webContents.id) !== session || selection.canceled) {
      return { canceled: true }
    }
    await session.inputQueue.catch(() => undefined)
    await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
    const data = await captureScreenshotAreaSelection(access, tab, selection)
    if (session.canceled || access.screenshotAreaSessions().get(webContents.id) !== session) return { canceled: true }
    return { canceled: false, data }
  } finally {
    if (access.screenshotAreaSessions().get(webContents.id) === session) {
      session.canceled = true
      await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
      // Cleanup can finish after a replacement selection starts.
      if (access.screenshotAreaSessions().get(webContents.id) === session) {
        access.screenshotAreaSessions().delete(webContents.id)
        if (access.isHumanInteractionLocked(tab)) await access.syncHumanInteractionInputGuard(tab)
      }
    }
  }
}

/** Cancels the screenshot area selection on a tab's page, resolving whether its overlay was removed. */
export async function cancelScreenshotArea<Tab extends ScreenshotAreaTab>(access: ScreenshotAreaAccess<Tab>, tabId?: string): Promise<boolean> {
  const tab = access.getTab(tabId)
  const session = access.screenshotAreaSessions().get(tab.webContents.id)
  if (session) {
    session.canceled = true
    session.resolve({ canceled: true })
  }
  return tab.webContents.executeJavaScript(cancelScreenshotAreaScript(), true) as Promise<boolean>
}

/** Captures the selected area of the tab's rendered page, scaled from its viewport to the view, as a PNG. */
async function captureScreenshotAreaSelection<Tab extends ScreenshotAreaTab>(access: ScreenshotAreaAccess<Tab>, tab: Tab, selection: BrowserScreenshotAreaResult): Promise<Buffer> {
  const { clip, viewport } = selection
  if (!clip || !viewport) throw new Error('The selected screenshot area was incomplete; try selecting it again')
  if ([clip.x, clip.y, clip.width, clip.height, viewport.width, viewport.height]
    .some((value) => !Number.isFinite(value))) {
    throw new Error('Could not determine a finite screenshot area')
  }
  if (clip.width < 2 || clip.height < 2 || viewport.width < 1 || viewport.height < 1) {
    throw new Error('Drag a larger screenshot area')
  }
  const webContents = tab.webContents

  return access.withRenderableTab(tab, async () => {
    const bounds = tab.view.getBounds()
    const scaleX = bounds.width / viewport.width
    const scaleY = bounds.height / viewport.height
    const captureRect = {
      x: Math.max(0, Math.floor(clip.x * scaleX)),
      y: Math.max(0, Math.floor(clip.y * scaleY)),
      width: Math.max(1, Math.min(bounds.width, Math.ceil(clip.width * scaleX))),
      height: Math.max(1, Math.min(bounds.height, Math.ceil(clip.height * scaleY)))
    }
    captureRect.width = Math.min(captureRect.width, Math.max(1, bounds.width - captureRect.x))
    captureRect.height = Math.min(captureRect.height, Math.max(1, bounds.height - captureRect.y))
    const image = await webContents.capturePage(captureRect)
    if (image.isEmpty()) throw new Error('The selected website area did not produce an image')
    return image.toPNG()
  })
}

/**
 * Forwards one native mouse event to the page's screenshot area overlay in
 * order, tracking the drag so a release that the overlay misses still
 * selects the dragged area.
 */
export function queueScreenshotAreaMouseInput<Tab extends ScreenshotAreaTab>(
  access: ScreenshotAreaAccess<Tab>,
  tab: Tab,
  session: BrowserScreenshotAreaSession,
  type: 'down' | 'move' | 'up',
  mouse: Electron.MouseInputEvent
): void {
  const bounds = tab.view.getBounds()
  const point = {
    x: Math.max(0, Math.min(bounds.width, Number(mouse.x))),
    y: Math.max(0, Math.min(bounds.height, Number(mouse.y)))
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
  if (type === 'down') {
    session.start = point
    session.current = point
  } else if (session.start) {
    session.current = point
  }
  let fallbackSelection: BrowserScreenshotAreaResult | undefined
  if (type === 'up' && session.start && session.current) {
    const left = Math.floor(Math.min(session.start.x, session.current.x))
    const top = Math.floor(Math.min(session.start.y, session.current.y))
    const right = Math.ceil(Math.max(session.start.x, session.current.x))
    const bottom = Math.ceil(Math.max(session.start.y, session.current.y))
    const clip = { x: left, y: top, width: right - left, height: bottom - top }
    if (clip.width >= 2 && clip.height >= 2) {
      fallbackSelection = {
        canceled: false,
        clip,
        viewport: { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
        url: tab.url
      }
    }
    session.start = undefined
    session.current = undefined
  }
  const queued = session.inputQueue.catch(() => undefined).then(async () => {
    if (session.canceled || access.screenshotAreaSessions().get(tab.webContents.id) !== session) return
    await tab.webContents.executeJavaScript(screenshotAreaNativeInputScript(
      type,
      mouse.x,
      mouse.y,
      Math.max(1, bounds.width),
      Math.max(1, bounds.height)
    ), true)
  })
  session.inputQueue = queued
  if (fallbackSelection) {
    const selection = fallbackSelection
    void queued.catch(() => undefined).then(() => {
      if (!session.canceled && access.screenshotAreaSessions().get(tab.webContents.id) === session) {
        session.resolve(selection)
      }
    })
  }
  void queued.catch((error) => {
    if (!session.canceled && access.screenshotAreaSessions().get(tab.webContents.id) === session) {
      console.error('[browser] Could not forward screenshot selection input:', error)
    }
  })
}
