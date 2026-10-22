import type { WebContents } from 'electron'
import type { PagePointerEventsAccess, PagePointerEventsTab } from './page-pointer-events-access.js'

/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. The keyboard listener keeps its own copy. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000

/**
 * Follows the person's mouse, wheel and touch input on a page. While trusted
 * chrome covers the pages, or a screenshot area selection or element picker
 * is in progress, a person's mouse input goes to that instead of the page;
 * the human input lock may hold it back. Otherwise the input is recorded,
 * refreshes the tab's overview preview, makes following wait, and a press or
 * touch on the other split pane makes it the active tab.
 */
export function attachPagePointerEvents<Tab extends PagePointerEventsTab>(access: PagePointerEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  // Wheel and touch input never reach before-mouse-event; while the person scrolls or touches
  // the page, following waits, and a touch counts as a press.
  const webContentsId = webContents.id
  webContents.on('input-event', (_event, input) => {
    if (input.type !== 'mouseWheel' && input.type !== 'touchStart') return
    access.scheduleTabOverviewPreview(tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
    if (access.agentInputWebContents().has(webContentsId) || access.agentWheelUnderWay(webContentsId)) return
    // A touch while trusted chrome covers the pages, or on a page the human input lock holds, is no press.
    if (input.type === 'touchStart' && !access.browserContentOccluded() && !access.isHumanInteractionLocked(tab)) {
      notePersonPress(access, tab)
      return
    }
    access.mcpActivityFollower().noteHumanInput()
  })
  webContents.once('destroyed', () => access.agentWheel().delete(webContentsId))
  webContents.on('before-mouse-event', (event, mouse) => {
    if (access.browserContentOccluded() && !access.agentInputWebContents().has(webContents.id)) {
      // Trusted chrome is open; a click must not give the page focus, activation or the active split pane.
      event.preventDefault()
      return
    }
    const screenshotSession = access.screenshotAreaSessions().get(webContents.id)
    if (screenshotSession && !screenshotSession.canceled && !access.agentInputWebContents().has(webContents.id)) {
      event.preventDefault()
      if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
        access.queueScreenshotAreaMouseInput(tab, screenshotSession, 'down', mouse)
      } else if (mouse.type === 'mouseMove') {
        access.queueScreenshotAreaMouseInput(tab, screenshotSession, 'move', mouse)
      } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
        access.queueScreenshotAreaMouseInput(tab, screenshotSession, 'up', mouse)
      }
      return
    }
    const elementPickerSession = access.elementPickerSessions().get(webContents.id)
    if (elementPickerSession && !elementPickerSession.canceled && !access.agentInputWebContents().has(webContents.id)) {
      event.preventDefault()
      if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
        access.queueElementPickerMouseInput(tab, elementPickerSession, 'down', mouse)
      } else if (mouse.type === 'mouseMove') {
        access.queueElementPickerMouseInput(tab, elementPickerSession, 'move', mouse)
      } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
        access.queueElementPickerMouseInput(tab, elementPickerSession, 'up', mouse)
      }
      return
    }
    if (access.shouldBlockHumanMouseInput(tab, mouse)) {
      event.preventDefault()
      return
    }
    access.reproRecorder().observeReproMouse(tab, mouse)
    if (mouse.type === 'mouseUp') access.scheduleTabOverviewPreview(tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
    if ((mouse.type === 'mouseDown' || mouse.type === 'contextMenu') && !access.agentInputWebContents().has(webContents.id)) {
      notePersonPress(access, tab)
    }
  })
}

/**
 * The person pressed the page, with a mouse button or a touch: they used it,
 * following waits, and a press on the other split pane makes it the active
 * tab.
 */
function notePersonPress<Tab extends PagePointerEventsTab>(access: PagePointerEventsAccess<Tab>, tab: Tab): void {
  tab.humanInteractionGeneration += 1
  tab.lastHumanInteractionAt = Date.now()
  tab.lastActiveAt = tab.lastHumanInteractionAt
  access.mcpActivityFollower().noteHumanInput()
  if (access.splitViewContains(tab.id) && access.activeTabId() !== tab.id) {
    // The person picked the other pane, which following did not show. It
    // is a selection, so a tab still waking for an earlier one stays out.
    access.setAgentFollow(undefined)
    access.writeTabSelectionGeneration(access.tabSelectionGeneration() + 1)
    access.writeActiveTabId(tab.id)
    access.markTabActiveInGroup(tab)
    access.changed()
  }
  access.options().onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
}
