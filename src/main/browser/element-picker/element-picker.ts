import { formatElementInspectionForAgent, normalizeElementInspection } from '../../../shared/element-inspection.js'
import type { BrowserElementInspection } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { createElementPickerSession } from '../native-selection-session.js'
import {
  cancelElementPickerScript,
  elementPickerInspectionAtPointScript,
  elementPickerNativeInputScript,
  elementPickerScript
} from '../page-scripts.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import { isHronautHomeUrl } from '../url.js'
import type {
  BrowserElementPickerResult,
  BrowserElementPickerScriptResult,
  BrowserElementPickerSession,
  ElementPickerAccess,
  ElementPickerTab
} from './element-picker-access.js'

// A copy of the tab manager's world, which its locator generation keeps using.
const ELEMENT_INSPECTION_WORLD_ID = ISOLATED_WORLDS.elementInspection

// The same check the screenshot area and the human input guard make.
function nativeSelectionContextUnavailable(error: unknown): boolean {
  return error instanceof RendererExitedError || /context.*destroyed|frame.*removed|navigat/i.test(String(error))
}

/** Lets the person pick an element on a website tab's page and returns its inspection formatted for an agent. */
export async function pickElement<Tab extends ElementPickerTab>(access: ElementPickerAccess<Tab>, tabId?: string): Promise<BrowserElementPickerResult> {
  const report = await selectElement(access, tabId)
  if (!report) return { canceled: true }
  return { canceled: false, content: formatElementInspectionForAgent(report) }
}

/** Lets the person pick an element on a website tab's page and captures a screenshot of it. */
export async function captureElementScreenshot<Tab extends ElementPickerTab>(access: ElementPickerAccess<Tab>, tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
  const report = await selectElement(access, tabId)
  if (!report) return { canceled: true }
  const screenshot = await access.screenshot({ tabId: report.tabId, selector: report.selector })
  return { canceled: false, data: screenshot.data }
}

/**
 * Lets the person pick an element on a website tab's page, replacing a picker
 * already in progress there, and normalizes its inspection. It resolves null
 * when the person cancels, the page goes away, or a newer picker replaces
 * this one.
 */
async function selectElement<Tab extends ElementPickerTab>(access: ElementPickerAccess<Tab>, tabId?: string): Promise<BrowserElementInspection | null> {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before selecting an element')
  const webContents = tab.webContents
  const existing = access.elementPickerSessions().get(webContents.id)
  if (existing) {
    existing.canceled = true
    existing.resolve({ canceled: true })
    await webContents.executeJavaScript(cancelElementPickerScript(), true).catch(() => false)
  }
  const session = createElementPickerSession<BrowserElementPickerScriptResult>()
  tab.nativeInputEnvironmentGeneration += 1
  access.elementPickerSessions().set(webContents.id, session)
  try {
    if (access.isHumanInteractionLocked(tab)) await access.syncHumanInteractionInputGuard(tab)
    void webContents.executeJavaScript(elementPickerScript(), true)
      .then((selected: BrowserElementPickerScriptResult) => {
        if (selected?.canceled || selected?.inspection) session.resolve(selected)
      })
      .catch((error: unknown) => {
        if (nativeSelectionContextUnavailable(error)) {
          session.resolve({ canceled: true })
        } else {
          session.reject(error)
        }
      })
    const selected = await session.result
    if (session.canceled || access.elementPickerSessions().get(webContents.id) !== session || selected.canceled || !selected.inspection) {
      return null
    }
    return normalizeElementInspection({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      raw: selected.inspection
    })
  } finally {
    if (access.elementPickerSessions().get(webContents.id) === session) {
      session.canceled = true
      await webContents.executeJavaScript(cancelElementPickerScript(), true).catch(() => false)
      // Cleanup can finish after a replacement selection starts.
      if (access.elementPickerSessions().get(webContents.id) === session) {
        access.elementPickerSessions().delete(webContents.id)
        if (access.isHumanInteractionLocked(tab)) await access.syncHumanInteractionInputGuard(tab)
      }
    }
  }
}

/** Cancels the element picker on a tab's page, resolving whether its overlay was removed. */
export async function cancelElementPicker<Tab extends ElementPickerTab>(access: ElementPickerAccess<Tab>, tabId?: string): Promise<boolean> {
  const tab = access.getTab(tabId)
  const session = access.elementPickerSessions().get(tab.webContents.id)
  if (session) {
    session.canceled = true
    session.resolve({ canceled: true })
  }
  return tab.webContents.executeJavaScript(cancelElementPickerScript(), true) as Promise<boolean>
}

/**
 * Forwards one native mouse event to the page's element picker overlay in
 * order; a release after a press inspects the element at that point and
 * picks it.
 */
export function queueElementPickerMouseInput<Tab extends ElementPickerTab>(
  access: ElementPickerAccess<Tab>,
  tab: Tab,
  session: BrowserElementPickerSession,
  type: 'down' | 'move' | 'up',
  mouse: Electron.MouseInputEvent
): void {
  const bounds = tab.view.getBounds()
  if (type === 'down') session.pointerDown = true
  const shouldSelect = type === 'up' && session.pointerDown
  if (type === 'up') session.pointerDown = false
  const queued = session.inputQueue.catch(() => undefined).then(async () => {
    if (session.canceled || access.elementPickerSessions().get(tab.webContents.id) !== session) return
    await tab.webContents.executeJavaScript(elementPickerNativeInputScript(
      type,
      mouse.x,
      mouse.y,
      Math.max(1, bounds.width),
      Math.max(1, bounds.height)
    ), true).catch(() => false)
    if (!shouldSelect || session.settled || session.canceled) return
    const inspection = await tab.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_INSPECTION_WORLD_ID,
      [{ code: elementPickerInspectionAtPointScript(
        mouse.x,
        mouse.y,
        Math.max(1, bounds.width),
        Math.max(1, bounds.height)
      ) }],
      false
    )
    if (!session.canceled && access.elementPickerSessions().get(tab.webContents.id) === session) {
      session.resolve({ canceled: false, inspection })
    }
  })
  session.inputQueue = queued
  void queued.catch((error) => {
    if (!session.canceled && access.elementPickerSessions().get(tab.webContents.id) === session) {
      console.error('[browser] Could not forward element picker input:', error)
    }
  })
}
