import type { Input, WebContents } from 'electron'
import { browserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { consumeExpectedAgentKeyboardInput } from '../agent-input-authorization/agent-input-authorization.js'
import { scheduleTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'
import { pageShortcut } from '../take-over.js'
import { cancelElementPicker } from '../element-picker/element-picker.js'
import { cancelScreenshotArea } from '../screenshot-area/screenshot-area.js'
import { noteShellHeldKey } from './shell-held-keys.js'

/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. The pointer listeners keep their own copy. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000

/**
 * Follows the person's keyboard input on a page. While trusted chrome covers
 * the pages, a key goes to the shell as a browser shortcut or nowhere; while
 * a screenshot area selection or element picker is in progress, Escape ends
 * it. Otherwise a browser shortcut the page does not keep goes to the shell,
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
      const shortcut = input.type === 'keyDown' ? browserShortcutAction({
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
      if (shortcut) {
        notePageShortcutKey(browser, webContents, input)
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
    const requested = input.type === 'keyDown' ? browserShortcutAction({
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
    // Consume one expected event even on unlocked tabs. An awaited agent
    // operation does not establish the origin of every arriving key event.
    const expectedAgentInput = consumeExpectedAgentKeyboardInput(browser, webContents.id, input)
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
      if (shortcut) {
        notePageShortcutKey(browser, webContents, input)
        browser.options.onUserInteraction?.()
        browser.options.onShortcutRequested?.(shortcut, page)
      }
      return
    }
    if (shortcut) {
      event.preventDefault()
      if (!expectedAgentInput) notePageShortcutKey(browser, webContents, input)
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
      // of the tab shown next as Ctrl+W, which a web IDE may read as closing an editor. Those of a key a page gave up,
      // such as a held Ctrl+=, still reach that page, so the View menu goes on zooming it.
      event.preventDefault()
      return
    }
    browser.reproRecorder.observeReproKeyboard(tab, input)
    // The overview shows the page as it was last seen, after the latest typing settles.
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

/** Notes the key of a browser shortcut the person pressed in this page, whose repeats then stay out of other pages. */
function notePageShortcutKey(browser: Browser, webContents: WebContents, input: Input): void {
  if (input.code) browser.pageShortcutKey = { code: input.code, webContentsId: webContents.id }
}
