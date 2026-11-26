import { pageScript } from '../../../shared/page-script.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import { PrintDialogOpenError, whenPrintDialogCloses } from '../print-dialog-guard.js'
import { WebsiteDialogOpenError, whenWebsiteDialogCloses } from '../website-dialog-guard.js'
import { humanInteractionWheelGuardInPage } from './human-input-guard.page.js'
import { recordNativeInputBarrier } from './input-lock-state.js'

// The same check the screenshot area and the element picker make. A page
// whose renderer exited has no frames to guard; its next load syncs again.
function nativeSelectionContextUnavailable(error: unknown): boolean {
  return error instanceof RendererExitedError || /context.*destroyed|frame.*removed|navigat/i.test(String(error))
}

/**
 * How long the frames' wheel guards may take inside the page's debugger turn. A page whose main thread is busy, as in
 * an endless script, never answers; waiting for it held that turn, every later debugger call on the page and every
 * later input lock change for good. The native barrier, applied by the browser process, is in place by then.
 */
export const FRAME_GUARD_WAIT_MS = 2_000
/** When a guard the page did not answer, or one Developer Tools kept out, is applied again. */
const FRAME_GUARD_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000]

class FrameGuardTimeoutError extends Error {}

/** Pages with a guard already waiting to be applied again, so repeated lock changes add one retry at most. */
const guardRetries = new WeakSet<BrowserTab>()

function retryGuard(browser: Browser, tab: BrowserTab, attempt: number): void {
  const delay = FRAME_GUARD_RETRY_DELAYS_MS[attempt]
  if (delay === undefined || guardRetries.has(tab)) return
  guardRetries.add(tab)
  setTimeout(() => {
    guardRetries.delete(tab)
    void syncGuard(browser, tab, attempt + 1).catch(() => undefined)
  }, delay).unref?.()
}

/** Settles with the frames' guards, or rejects with FrameGuardTimeoutError once the page has taken too long. */
async function withinFrameGuardWait<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new FrameGuardTimeoutError()), FRAME_GUARD_WAIT_MS)
      timer.unref?.()
    })])
  } finally {
    clearTimeout(timer)
  }
}

/** A frame of the DevTools frame tree, with its child frames. */
interface CdpFrameTreeNode {
  frame: { id: string }
  childFrames?: CdpFrameTreeNode[]
}

/** The ids of the frame and every frame below it. */
function cdpFrameIds(node: CdpFrameTreeNode): string[] {
  return [node.frame.id, ...(node.childFrames ?? []).flatMap(cdpFrameIds)]
}

/**
 * Makes the page ignore the person's native input while their interaction
 * with it is locked and no trusted native selection runs on it, and adds a
 * wheel guard to every frame as a fallback; otherwise lifts both. A page or
 * manager that went away meanwhile is left alone.
 */
export function syncHumanInteractionInputGuard(browser: Browser, tab: BrowserTab): Promise<void> {
  return syncGuard(browser, tab, 0)
}

async function syncGuard(browser: Browser, tab: BrowserTab, attempt: number): Promise<void> {
  if (browser.destroyed || tab.webContents.isDestroyed() || findTab(browser, tab.id) !== tab) return
  try {
    await withDebugger(browser, tab.webContents, async () => {
      const trustedSelectionActive = browser.screenshotAreaSessions.has(tab.webContents.id)
        || browser.elementPickerSessions.has(tab.webContents.id)
      const locked = browser.isHumanInteractionLocked(tab)
        && !trustedSelectionActive
      // Chromium's compositor can apply physical wheel/trackpad scrolling
      // before DOM or Electron cancellation runs. This is the authoritative
      // native-input barrier; the isolated-world wheel listener below remains
      // a fallback for programmatic paths that bypass compositor input.
      await tab.webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: locked })
      recordNativeInputBarrier(tab, locked)
      const result = await tab.webContents.debugger.sendCommand('Page.getFrameTree') as {
        frameTree: CdpFrameTreeNode
      }
      const expression = pageScript(humanInteractionWheelGuardInPage, locked)
      await withinFrameGuardWait(Promise.all(cdpFrameIds(result.frameTree).map(async (frameId) => {
        const isolatedWorld = await tab.webContents.debugger.sendCommand('Page.createIsolatedWorld', {
          frameId,
          worldName: 'hronaut-human-interaction-guard',
          grantUniveralAccess: false
        }) as { executionContextId: number }
        await tab.webContents.debugger.sendCommand('Runtime.evaluate', {
          expression,
          contextId: isolatedWorld.executionContextId,
          returnByValue: true
        })
      })))
    })
  } catch (error) {
    if (
      browser.destroyed
      || tab.webContents.isDestroyed()
      || findTab(browser, tab.id) !== tab
      || nativeSelectionContextUnavailable(error)
    ) return
    if (error instanceof FrameGuardTimeoutError) {
      // The native barrier is in place; the frames' wheel guards, a fallback, follow when the page answers again.
      retryGuard(browser, tab, attempt)
      return
    }
    if (error instanceof LocalizedError && error.key === 'appErrors.pageTools.devToolsOpen') {
      // Developer Tools hold the page's debugger, so the guard follows once they close; locking closes them. A lock
      // change refused for that left every tab as it was, so locking or unlocking all tabs failed while one had them.
      // Ones still opening may not open at all, as on a locked page: try again shortly instead.
      if (!tab.webContents.isDevToolsOpened()) retryGuard(browser, tab, attempt)
      else if (!guardRetries.has(tab)) {
        guardRetries.add(tab)
        tab.webContents.once('devtools-closed', () => {
          guardRetries.delete(tab)
          void syncGuard(browser, tab, 0).catch(() => undefined)
        })
      }
      return
    }
    if (error instanceof PrintDialogOpenError) {
      // The native barrier, which the browser process applies, is in place; the frames' wheel guards follow once the
      // person closes the page's print dialog.
      void whenPrintDialogCloses(tab.webContents).then(() => syncHumanInteractionInputGuard(browser, tab)).catch(() => undefined)
      return
    }
    if (error instanceof WebsiteDialogOpenError) {
      // The same once the person or an agent answers the page's website dialog.
      void whenWebsiteDialogCloses(tab.webContents).then(() => syncHumanInteractionInputGuard(browser, tab)).catch(() => undefined)
      return
    }
    throw error
  }
}
