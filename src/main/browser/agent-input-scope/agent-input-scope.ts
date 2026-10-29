import { webContents as electronWebContents, type WebContents } from 'electron'
import { clearRendererAgentInputFlag, NativeInputCleanupError } from '../native-input-cleanup.js'
import { printDialogHolds, whenPrintDialogCloses } from '../print-dialog-guard.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import { beginAgentFocusIsolation, restoreHumanFocusAfterAgentInput } from './focus-isolation.js'

/**
 * Runs an agent's input to a page. The outermost run isolates window focus,
 * remembers where the person's focus was and marks the page's renderer as
 * receiving agent input (unless deferred); nested runs only count. When the
 * outermost run ends it clears the renderer flag, restores the native input
 * guard of a locked tab, puts the person's focus back and releases focus
 * isolation, reporting cleanup failures through onCleanupFailure.
 */
export async function withAgentInput<T>(
  browser: Browser,
  webContents: WebContents,
  operation: () => Promise<T>,
  options: { deferRendererFlag?: boolean; onCleanupFailure?: () => void } = {}
): Promise<T> {
  const depth = (browser.agentInputWebContents.get(webContents.id) ?? 0) + 1
  if (depth === 1) {
    const mainWindowFocused = browser.window.isFocused()
    browser.agentInputFocusGuardReleases.set(webContents.id, beginAgentFocusIsolation(browser))
    browser.agentInputFocusSnapshots.set(webContents.id, {
      mainWindowFocused,
      focusedWebContentsId: electronWebContents.getFocusedWebContents()?.id ?? null
    })
  }
  browser.agentInputWebContents.set(webContents.id, depth)
  let nativeCleanupFailure: NativeInputCleanupError | undefined
  try {
    if (depth === 1 && !options.deferRendererFlag && !webContents.isDestroyed()) {
      // Without a user gesture: marking the page must not give it a person's activation, which a hover or a scroll
      // never gives in Chrome. A click, a key or typing gives the page its own activation.
      await webContents.executeJavaScript('window.__hronautAgentInputActive = true', false).catch(() => undefined)
    }
    return await operation()
  } catch (error) {
    if (error instanceof NativeInputCleanupError) nativeCleanupFailure = error
    throw error
  } finally {
    try {
      const remaining = Math.max(0, (browser.agentInputWebContents.get(webContents.id) ?? 1) - 1)
      if (remaining > 0) {
        browser.agentInputWebContents.set(webContents.id, remaining)
      } else {
        browser.agentInputWebContents.delete(webContents.id)
        const focusSnapshot = browser.agentInputFocusSnapshots.get(webContents.id)
        browser.agentInputFocusSnapshots.delete(webContents.id)
        try {
          if (!webContents.isDestroyed()) {
            await clearRendererAgentInputFlag(webContents, options.onCleanupFailure)
            if (printDialogHolds(webContents)) {
              // The page's print dialog kept the flag from being cleared. Without it, the person's own pointer input
              // to Hronaut's element picker and screenshot area on this page would still read as an agent's.
              void whenPrintDialogCloses(webContents).then(async () => {
                if (!webContents.isDestroyed() && !browser.agentInputWebContents.has(webContents.id)) await clearRendererAgentInputFlag(webContents)
              })
            }
            const tabId = browser.webContentsToTab.get(webContents.id)
            const tab = tabId ? findTab(browser, tabId) : undefined
            if (!webContents.isDestroyed() && tab && browser.isHumanInteractionLocked(tab)) {
              try {
                await browser.syncHumanInteractionInputGuard(tab)
              } catch (error) {
                options.onCleanupFailure?.()
                // Preserve acknowledged input uncertainty, but otherwise keep
                // restoration failures visible after focus cleanup runs.
                if (!nativeCleanupFailure) throw error
              }
            }
          }
        } finally {
          try {
            restoreHumanFocusAfterAgentInput(browser, webContents, focusSnapshot)
          } finally {
            const releaseFocusGuard = browser.agentInputFocusGuardReleases.get(webContents.id)
            browser.agentInputFocusGuardReleases.delete(webContents.id)
            releaseFocusGuard?.()
          }
        }
      }
    } catch (error) {
      options.onCleanupFailure?.()
      throw error
    }
  }
}
