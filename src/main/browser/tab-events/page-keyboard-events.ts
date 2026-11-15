import type { Input, WebContents } from 'electron'
import {
  browserShortcutAction,
  primaryWebsiteKeptAction,
  websiteKeptShortcutAction,
  type BrowserShortcutAction,
  type BrowserShortcutInput
} from '../../../shared/browser-shortcuts.js'
import { shortcutKey } from '../../../shared/shortcut-key.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { consumeExpectedAgentKeyboardInput } from '../agent-input-authorization/agent-input-authorization.js'
import { scheduleTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'
import { pageShortcut } from '../take-over.js'
import { cancelElementPicker } from '../element-picker/element-picker.js'
import { cancelScreenshotArea } from '../screenshot-area/screenshot-area.js'
import { noteShellHeldKey } from './shell-held-keys.js'

/**
 * Whether the key toggles the window's full screen, as the View menu's item does: F11, or Ctrl+Cmd+F on macOS, whose F
 * is the key that types it, as for the menu, or the F key's place with a layout of another script.
 */
function fullScreenKey(input: Pick<Input, 'key' | 'code' | 'control' | 'meta' | 'alt' | 'shift'>): boolean {
  if (process.platform === 'darwin') return shortcutKey(input) === 'f' && input.control && input.meta && !input.alt && !input.shift
  return input.key === 'F11' && !input.control && !input.meta && !input.alt && !input.shift
}

/**
 * Toggles the window's full screen for the full screen key the page did not get. Its repeats toggle nothing, and stay
 * out of the page once the window left full screen.
 */
function toggleFullScreenFromPage(browser: Browser, input: Input): void {
  if (input.isAutoRepeat) return
  noteShellHeldKey(browser.shellHeldKeys, input)
  browser.options.onUserInteraction?.()
  browser.window.setFullScreen(!browser.window.isFullScreen())
}

/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. The pointer listeners keep their own copy. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000

/**
 * Follows the person's keyboard input on a page. While trusted chrome covers
 * the pages, a key goes to the shell as a browser shortcut, toggles full
 * screen or goes nowhere; while
 * a screenshot area selection or element picker is in progress, Escape ends
 * it. Otherwise the full screen key is the browser's while the window is in
 * full screen, a browser shortcut the page does not keep goes to the shell,
 * the human input lock may hold the key back, and the key is recorded,
 * refreshes the tab's overview preview and makes following wait. A key held
 * down in the shell when it hands the focus to the page does not repeat into it,
 * nor does the key of a browser shortcut a page gave up, such as Ctrl+W, into
 * the page of the tab shown next.
 */
export function attachPageKeyboardEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    // A key pressed or released here ends the keys held in the shell: the keyboard repeats only the newest key, and a
    // held key whose repeats were dropped is let go without its release reaching any page.
    if (!input.isAutoRepeat) {
      browser.shellHeldKeys.clear()
      browser.pageShortcutKey = null
    }
    if (browser.browserContentOccluded && !browser.agentInputWebContents.has(webContents.id)) {
      // Trusted chrome is open; the page is only on screen until its snapshot is shown.
      event.preventDefault()
      const keys = {
        key: input.key,
        code: input.code,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
        repeat: input.isAutoRepeat,
        composing: input.isComposing,
        mac: process.platform === 'darwin'
      }
      // The page cannot have Ctrl with a digit or the website-kept keys with Ctrl/Cmd, such as Ctrl+F or Ctrl+D, which
      // went to the browser from here before they were; the other such keys, such as F5, stay dead here, as they are in
      // Hronaut's window under its dialogs. The full screen key toggles full screen there, as it does here.
      if (input.type === 'keyDown' && fullScreenKey(input)) {
        toggleFullScreenFromPage(browser, input)
        return
      }
      const shortcut = input.type === 'keyDown' ? browserShortcutAction(keys) ?? coveredPageKey(keys) : null
      if (shortcut) {
        notePageShortcutKey(browser, input)
        browser.options.onShortcutRequested?.(shortcut)
      }
      return
    }
    const screenshotSession = browser.screenshotAreaSessions.get(webContents.id)
    if (screenshotSession && !screenshotSession.canceled && !browser.agentInputWebContents.has(webContents.id)) {
      event.preventDefault()
      if (
        input.type === 'keyDown'
        && input.key === 'Escape'
        && !input.control
        && !input.meta
        && !input.alt
      ) {
        // Its repeats would reach the page once the area is gone, such as closing the page's own dialog.
        noteShellHeldKey(browser.shellHeldKeys, input)
        void cancelScreenshotArea(browser, tab.id).catch(() => undefined)
      }
      return
    }
    const elementPickerSession = browser.elementPickerSessions.get(webContents.id)
    if (elementPickerSession && !elementPickerSession.canceled && !browser.agentInputWebContents.has(webContents.id)) {
      event.preventDefault()
      const shortcut = (input.type === 'keyDown' || input.type === 'rawKeyDown') ? browserShortcutAction({
        key: input.key,
        code: input.code,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
        repeat: input.isAutoRepeat,
        composing: input.isComposing,
        mac: process.platform === 'darwin'
      }) : null
      if ((
        input.type === 'keyDown'
        && input.key === 'Escape'
        && !input.control
        && !input.meta
        && !input.alt
      ) || shortcut === 'pick-element') {
        // Its repeats would reach the page once the picker is gone, as for the screenshot area.
        noteShellHeldKey(browser.shellHeldKeys, input)
        void cancelElementPicker(browser, tab.id).catch(() => undefined)
      }
      return
    }
    const keys = {
      key: input.key,
      code: input.code,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
      repeat: input.isAutoRepeat,
      composing: input.isComposing,
      mac: process.platform === 'darwin'
    }
    const requested = input.type === 'keyDown' ? browserShortcutAction(keys) : null
    // Consume one expected event even on unlocked tabs. An awaited agent
    // operation does not establish the origin of every arriving key event.
    const expectedAgentInput = consumeExpectedAgentKeyboardInput(browser, webContents.id, input)
    // As in Chrome, the key that toggles full screen is the browser's while the window is in full screen, so a page that
    // keeps it cannot hold the person there; a locked page keeps no key, so there it toggles full screen either way.
    if (input.type === 'keyDown' && !expectedAgentInput && fullScreenKey(input)
      && (browser.window.isFullScreen() || browser.isHumanInteractionLocked(tab))) {
      event.preventDefault()
      toggleFullScreenFromPage(browser, input)
      return
    }
    // Ctrl+. is also a page's own key, such as an editor's quick fix. It opens the agent card only
    // when a person presses it while there are agents to show; Ctrl+Shift+O likewise takes the page
    // over only from a person. An agent's debugger keys usually skip this handler; one that arrives
    // here as expected agent input still reaches the page (pageShortcut).
    const shortcut = pageShortcut(requested, {
      available: requested ? browser.options.shortcutAvailable?.(requested, tab.mcpGroupId, tab.id) !== false : false,
      expectedAgentInput
    })
    const page = { tabId: tab.id, workspaceId: tab.mcpGroupId }
    if (browser.isHumanInteractionLocked(tab) && !expectedAgentInput) {
      event.preventDefault()
      // The locked page cannot have a key a website may keep, such as F5 or Ctrl+1, which the menu then never got
      // either, so the browser takes it, as it does its own keys; F6 goes on to the address bar, as from the page.
      const kept = !shortcut && input.type === 'keyDown' ? websiteKeptShortcutAction(keys) : null
      const taken = shortcut ?? (kept && browser.options.shortcutAvailable?.(kept, tab.mcpGroupId, tab.id) !== false ? kept : null)
      if (taken) {
        notePageShortcutKey(browser, input)
        browser.options.onUserInteraction?.()
        browser.options.onShortcutRequested?.(taken, page)
      }
      return
    }
    if (shortcut) {
      event.preventDefault()
      if (!expectedAgentInput) notePageShortcutKey(browser, input)
      browser.options.onUserInteraction?.()
      browser.options.onShortcutRequested?.(shortcut, page)
      return
    }
    if (input.isAutoRepeat && !expectedAgentInput && input.code && (
      browser.shellHeldKeys.has(input.code)
      || (browser.pageShortcutKey?.code === input.code && browser.pageShortcutKey.webContentsId !== webContents.id)
    )) {
      // The repeats of a key the shell took, such as Delete closing the active tab, which gave this page the focus:
      // a held Delete went on to delete the text in this page's focused field. A held Ctrl+W likewise reached the page
      // of the tab shown next as Ctrl+W, which a web IDE may read as closing an editor. Those of a key a website may
      // keep, such as Ctrl+=, still reach their own page.
      event.preventDefault()
      return
    }
    if (!input.isAutoRepeat && input.type === 'keyDown' && input.code && !expectedAgentInput && websiteKeptShortcutAction(keys)) {
      // A key a website may keep, such as Ctrl+2 or Ctrl+F, goes to the page first and to the menu when the page leaves
      // it alone, which acts once for a held key. Held down, it repeats into this page only: not into the page of the
      // tab the menu went to, as a web editor there would read each repeat as its own Ctrl+2.
      browser.pageShortcutKey = { code: input.code, webContentsId: webContents.id }
    }
    browser.reproRecorder.observeReproKeyboard(tab, input)
    // Home's Tabs view shows the page as it was last seen, after the latest typing settles.
    if (input.type === 'keyUp') scheduleTabOverviewPreview(browser, tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
    if ((input.type === 'keyDown' || input.type === 'rawKeyDown') && !expectedAgentInput) {
      tab.humanInteractionGeneration += 1
      tab.lastHumanInteractionAt = performance.now()
      tab.lastActiveAt = tab.lastHumanInteractionAt
      browser.mcpActivityFollower.noteHumanInput()
      browser.options.onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
    }
  })
}

/**
 * The keys a website may keep that went to the browser from a page Hronaut's dialogs cover before they were: Ctrl with a
 * digit elsewhere than macOS, which goes to that tab once the page leaves it alone, and those with Ctrl/Cmd
 * (primaryWebsiteKeptAction), such as Ctrl+F, Ctrl+R and the zoom keys.
 */
function coveredPageKey(keys: BrowserShortcutInput): BrowserShortcutAction | null {
  const kept = websiteKeptShortcutAction(keys)
  if (kept?.startsWith('select-tab-') || kept === 'select-last-tab') return kept
  return primaryWebsiteKeptAction(keys)
}

/** Notes the key of a browser shortcut the person pressed in this page, whose repeats then stay out of every page. */
function notePageShortcutKey(browser: Browser, input: Input): void {
  if (input.code) browser.pageShortcutKey = { code: input.code, webContentsId: null }
}
