import { BrowserWindow, webContents as electronWebContents, type WebContents } from 'electron'
import type { Browser } from '../browser.js'

/**
 * Starts keeping the window from taking focus during an agent's work while
 * the person is elsewhere: whenever the window is in the background, now or
 * after a later blur, it becomes unfocusable until the returned release runs.
 * Releasing twice does nothing.
 */
export function beginAgentFocusIsolation(browser: Browser): () => void {
  let guardingBackgroundFocus = false
  let released = false
  const guardWhenBackgrounded = (): void => {
    if (
      released
      || guardingBackgroundFocus
      || browser.destroyed
      || browser.window.isDestroyed()
      || browser.window.isFocused()
    ) return
    guardingBackgroundFocus = true
    beginBackgroundAgentInputFocusGuard(browser)
  }
  browser.window.on('blur', guardWhenBackgrounded)
  guardWhenBackgrounded()
  return () => {
    if (released) return
    released = true
    if (!browser.window.isDestroyed()) browser.window.removeListener('blur', guardWhenBackgrounded)
    if (!guardingBackgroundFocus) return
    if (!browser.window.isDestroyed() && browser.window.isFocused()) browser.window.blur()
    endBackgroundAgentInputFocusGuard(browser)
  }
}

/** Makes the window unfocusable when the first background guard begins, remembering whether it was focusable. */
function beginBackgroundAgentInputFocusGuard(browser: Browser): void {
  browser.backgroundAgentInputFocusGuardDepth += 1
  if (browser.backgroundAgentInputFocusGuardDepth !== 1 || browser.window.isDestroyed()) return
  browser.mainWindowFocusableBeforeAgentInput = browser.window.isFocusable()
  if (browser.mainWindowFocusableBeforeAgentInput) browser.window.setFocusable(false)
}

/** Runs an operation with focus isolation, releasing it however the operation ends. */
export async function withBackgroundAgentFocusGuard<T>(browser: Browser, operation: () => Promise<T>): Promise<T> {
  const releaseFocusGuard = beginAgentFocusIsolation(browser)
  try {
    return await operation()
  } finally {
    releaseFocusGuard()
  }
}

/**
 * When the last background guard ends, restores the window's focusability and
 * returns focus to the window that holds it now, or blurs the window if
 * restoring focusability activated it.
 */
function endBackgroundAgentInputFocusGuard(browser: Browser): void {
  browser.backgroundAgentInputFocusGuardDepth = Math.max(0, browser.backgroundAgentInputFocusGuardDepth - 1)
  if (browser.backgroundAgentInputFocusGuardDepth !== 0) return
  const restoreFocusable = browser.mainWindowFocusableBeforeAgentInput
  browser.mainWindowFocusableBeforeAgentInput = true
  const currentFocusOwner = BrowserWindow.getFocusedWindow()
  if (restoreFocusable && !browser.window.isDestroyed() && !browser.window.isFocusable()) {
    browser.window.setFocusable(true)
  }
  // No focused Electron window means the human may have switched to another
  // application. Never revive an owner captured before the operation.
  const focusOwner = currentFocusOwner
  if (focusOwner && focusOwner !== browser.window && !focusOwner.isDestroyed()) {
    focusOwner.focus()
  } else if (!browser.window.isDestroyed() && browser.window.isFocused()) {
    // Re-enabling focusability can activate the window on some Linux window
    // managers. An external application's window is not addressable through
    // Electron, so blur Hronaut and let the desktop restore its prior owner.
    browser.window.blur()
  }
}

/**
 * Puts focus back where the person had it before an agent's input to the
 * page, unless the person moved it meanwhile; it never activates the window
 * when the person was working elsewhere.
 */
export function restoreHumanFocusAfterAgentInput(
  browser: Browser,
  targetWebContents: WebContents,
  snapshot: {
    mainWindowFocused: boolean
    focusedWebContentsId: number | null
  } | undefined
): void {
  // Agent input must not activate Hronaut when the human is working in
  // another window, or overwrite a newer focus change made while the tool
  // was running.
  if (!snapshot) return
  if (!snapshot.mainWindowFocused) {
    if (browser.window.isFocused()) browser.window.blur()
    return
  }
  if (!browser.window.isFocused()) return
  const current = electronWebContents.getFocusedWebContents()
  if (current && current.id !== targetWebContents.id && current.id !== snapshot.focusedWebContentsId) return
  if (snapshot.focusedWebContentsId === null || current?.id === snapshot.focusedWebContentsId) return
  const previous = electronWebContents.fromId(snapshot.focusedWebContentsId)
  if (previous && !previous.isDestroyed()) previous.focus()
}
