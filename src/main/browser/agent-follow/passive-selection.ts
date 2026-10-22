import { webContents as electronWebContents } from 'electron'
import type { AgentFollowAccess } from './agent-follow-access.js'

/**
 * Shows the tab an agent works in without activating the window or giving
 * the page keyboard input: a focused window keeps focus in trusted chrome,
 * and a window that was not focused is blurred again if attaching the page
 * focused it.
 */
export function selectTabPassively(access: AgentFollowAccess, tabId: string): void {
  // A tab already in view, the active tab or the other pane of the split
  // view, stays as it is: selecting the other pane would make it the active
  // pane and move keyboard focus out of the person's page.
  if (access.activeTabId() === tabId || access.splitViewContains(tabId)) return
  const windowWasFocused = access.window().isFocused()
  const target = access.getTab(tabId)
  let focusGuardActive = windowWasFocused
  let focusGuardTimer: NodeJS.Timeout | undefined
  const releaseFocusGuard = (): void => {
    if (!focusGuardActive) return
    focusGuardActive = false
    if (focusGuardTimer) clearTimeout(focusGuardTimer)
    target.webContents.removeListener('focus', redirectWebsiteFocus)
  }
  const redirectWebsiteFocus = (): void => {
    releaseFocusGuard()
    // Chromium ignores a re-entrant focus transfer from the WebContents
    // focus callback on some Linux compositors. Restore trusted chrome on
    // the next main-process turn, after the native attachment settles.
    setImmediate(() => {
      if (
        access.window().isDestroyed()
        || !access.window().isFocused()
        || target.webContents.isDestroyed()
        || electronWebContents.getFocusedWebContents()?.id !== target.webContents.id
      ) return
      access.window().webContents.focus()
    })
  }
  if (focusGuardActive) {
    target.webContents.on('focus', redirectWebsiteFocus)
    focusGuardTimer = setTimeout(releaseFocusGuard, 1_000)
    focusGuardTimer.unref()
  }

  // A focused page cannot retain keyboard focus once its view is detached.
  // Move focus into trusted chrome before attaching the agent's page so
  // Electron cannot implicitly hand the page keyboard input during the swap.
  if (windowWasFocused) access.window().webContents.focus()
  try {
    access.selectTab(tabId, { focus: false })
  } catch (error) {
    releaseFocusGuard()
    throw error
  }
  if (access.window().isDestroyed()) return

  // Attaching a WebContentsView can focus it even when selectTab deliberately
  // omits an explicit focus call. Following agent activity is visual-only: it
  // must not activate Hronaut or redirect keyboard input into the agent's page.
  if (!windowWasFocused) {
    if (access.window().isFocused()) access.window().blur()
    return
  }
  if (!access.window().isFocused()) return

  if (electronWebContents.getFocusedWebContents()?.id === target.webContents.id) redirectWebsiteFocus()
}
