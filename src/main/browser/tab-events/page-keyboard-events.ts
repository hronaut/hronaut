import type { WebContents } from 'electron'
import { browserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type { PageKeyboardEventsAccess, PageKeyboardEventsTab } from './page-keyboard-events-access.js'

/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. The pointer listeners keep their own copy. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000

/**
 * Follows the person's keyboard input on a page. While trusted chrome covers
 * the pages, a key goes to the shell as a browser shortcut or nowhere; while
 * a screenshot area selection or element picker is in progress, Escape ends
 * it. Otherwise a browser shortcut the page does not keep goes to the shell,
 * the human input lock may hold the key back, and the key is recorded,
 * refreshes the tab's overview preview and makes following wait. A key held
 * since before the page had the focus does not repeat into it.
 */
export function attachPageKeyboardEvents<Tab extends PageKeyboardEventsTab>(access: PageKeyboardEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  // The keys pressed while the page has had the focus. A shell control pressed with a key can hand the focus to the
  // page, such as Delete closing the active tab, and the key's repeats then came here: a held Delete went on to delete
  // the text in the next page's focused field.
  const pressedHere = new Set<string>()
  webContents.on('blur', () => pressedHere.clear())
  webContents.on('before-input-event', (event, input) => {
    if (access.browserContentOccluded() && !access.agentInputWebContents().has(webContents.id)) {
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
      if (shortcut) access.options().onShortcutRequested?.(shortcut)
      return
    }
    const screenshotSession = access.screenshotAreaSessions().get(webContents.id)
    if (screenshotSession && !screenshotSession.canceled && !access.agentInputWebContents().has(webContents.id)) {
      event.preventDefault()
      if (
        input.type === 'keyDown'
        && input.key === 'Escape'
        && !input.control
        && !input.meta
        && !input.alt
      ) void access.cancelScreenshotArea(tab.id).catch(() => undefined)
      return
    }
    const elementPickerSession = access.elementPickerSessions().get(webContents.id)
    if (elementPickerSession && !elementPickerSession.canceled && !access.agentInputWebContents().has(webContents.id)) {
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
      if (
        input.type === 'keyDown'
        && input.key === 'Escape'
        && !input.control
        && !input.meta
        && !input.alt
      ) void access.cancelElementPicker(tab.id).catch(() => undefined)
      else if (shortcut === 'pick-element') void access.cancelElementPicker(tab.id).catch(() => undefined)
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
    const expectedAgentInput = access.consumeExpectedAgentKeyboardInput(webContents.id, input)
    // Ctrl+. is also a page's own key, such as an editor's quick fix. It opens the agent card only
    // when a person presses it while there are agents to show; Ctrl+Shift+O likewise takes the page
    // over only from a person. An agent's debugger keys usually skip this handler; one that arrives
    // here as expected agent input still reaches the page (pageShortcut).
    const shortcut = access.pageShortcut(requested, {
      available: requested ? access.options().shortcutAvailable?.(requested, tab.mcpGroupId, tab.id) !== false : false,
      expectedAgentInput
    })
    const page = { tabId: tab.id, workspaceId: tab.mcpGroupId }
    if (access.isHumanInteractionLocked(tab) && !expectedAgentInput) {
      event.preventDefault()
      if (shortcut) {
        access.options().onUserInteraction?.()
        access.options().onShortcutRequested?.(shortcut, page)
      }
      return
    }
    if (shortcut) {
      event.preventDefault()
      access.options().onUserInteraction?.()
      access.options().onShortcutRequested?.(shortcut, page)
      return
    }
    const physicalKey = input.code || input.key
    if (input.type === 'keyUp') pressedHere.delete(physicalKey)
    else if (!expectedAgentInput && (input.type === 'keyDown' || input.type === 'rawKeyDown')) {
      if (!input.isAutoRepeat) pressedHere.add(physicalKey)
      else if (!pressedHere.has(physicalKey)) {
        event.preventDefault()
        return
      }
    }
    access.reproRecorder().observeReproKeyboard(tab, input)
    // The overview shows the page as it was last seen, after the latest typing settles.
    if (input.type === 'keyUp') access.scheduleTabOverviewPreview(tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
    if ((input.type === 'keyDown' || input.type === 'rawKeyDown') && !expectedAgentInput) {
      tab.humanInteractionGeneration += 1
      tab.lastHumanInteractionAt = Date.now()
      tab.lastActiveAt = tab.lastHumanInteractionAt
      access.mcpActivityFollower().noteHumanInput()
      access.options().onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
    }
  })
}
