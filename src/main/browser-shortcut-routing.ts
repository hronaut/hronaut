import { pinnedWorkspaceAt } from '../shared/workspace-shortcuts.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { TakeOverOffers } from './take-over-offers.js'
import type { MainWindowRefs } from './windows/main-window.js'
import type { AgentPresenceSnapshot } from '../shared/agent-presence.js'
import type { BrowserShortcutAction } from '../shared/browser-shortcuts.js'

interface BrowserShortcutRoutingHost {
  /** The take over offers, which a page's take over key asks and acts on. */
  takeOvers: Pick<TakeOverOffers, 'available' | 'takeOverFromPage'>
  /** The tab runtime, whose Home tab and workspaces decide which keys a page keeps; null until the window opens. */
  tabs(): Pick<BrowserTabsManager, 'isHomeTab' | 'listMcpTabGroups' | 'exitPageFullscreen'> | null
  /** The agents in each workspace; a page keeps the agent card key while its workspace has none. */
  agentPresenceSnapshot(): AgentPresenceSnapshot
  /** The main window, whose shell runs a shortcut pressed in a page; read when the key is pressed. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
}

/**
 * Browser shortcuts pressed while a page has focus: which of them the page keeps for itself, and handing the others to
 * the shell, or taking the page over when its take over key is pressed there.
 */
export function createBrowserShortcutRouting(host: BrowserShortcutRoutingHost): {
  pageShortcutAvailable(action: BrowserShortcutAction, workspaceId: string | undefined, tabId: string): boolean
  runPageShortcut(action: BrowserShortcutAction, page?: { tabId: string; workspaceId: string | undefined }): void
} {
  /** Whether the browser takes a shortcut pressed in a page; the page keeps the key otherwise. */
  function pageShortcutAvailable(action: BrowserShortcutAction, workspaceId: string | undefined, tabId: string): boolean {
    // Ctrl/Cmd+Shift+O takes the page over only while an agent is working on it; the page keeps it otherwise.
    return action === 'take-over' ? host.takeOvers.available(tabId, workspaceId) !== undefined
      // Ctrl/Cmd+K is a common website key, such as for a site's own search, so websites keep it; Home does not use it.
      : action === 'switch-workspace' ? host.tabs()?.isHomeTab(tabId) === true
      // A page keeps a workspace key while there is no workspace for it to go to.
      : action === 'previous-workspace' ? (host.tabs()?.listMcpTabGroups().some((workspace) => workspace.id !== workspaceId) ?? false)
      : action.startsWith('select-workspace-') ? pinnedWorkspaceAt(host.tabs()?.listMcpTabGroups() ?? [], Number(action.slice(-1))) !== undefined
      : action !== 'agent-card' || (workspaceId !== undefined && (host.agentPresenceSnapshot().workspaces[workspaceId]?.length ?? 0) > 0)
  }

  /** Runs a shortcut the browser took from a page, or while trusted chrome covers it: the shell runs all but take over. */
  function runPageShortcut(action: BrowserShortcutAction, page?: { tabId: string; workspaceId: string | undefined }): void {
    // From a page, the key takes over that page's tab, which may not be the one the shell shows.
    if (action === 'take-over' && page) {
      host.takeOvers.takeOverFromPage(page.tabId, page.workspaceId)
      return
    }
    // A page in full screen covers the toolbar, the Find bar and the shell's other controls, so it leaves full
    // screen first; zooming keeps it there.
    if (!action.startsWith('zoom-')) host.tabs()?.exitPageFullscreen()
    if (host.mainWindowRefs.window && !host.mainWindowRefs.window.webContents.isDestroyed()) {
      // The page WebContentsView owns native focus when a website shortcut is
      // pressed. Move it to trusted chrome before the renderer focuses a
      // field, otherwise the DOM selection is visible while typed keys keep
      // going to the website.
      if (action === 'find' || action === 'find-next' || action === 'find-previous' || action === 'focus-address') {
        host.mainWindowRefs.window.webContents.focus()
      }
      host.mainWindowRefs.window.webContents.send('browser:shortcut-requested', action)
    }
  }

  return { pageShortcutAvailable, runPageShortcut }
}
