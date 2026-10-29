import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { shouldBlockHumanMouseInput } from '../agent-input-authorization/agent-input-authorization.js'
import { agentWheelUnderWay } from '../agent-wheel/agent-wheel.js'
import { queueElementPickerMouseInput } from '../element-picker/element-picker.js'
import { queueScreenshotAreaMouseInput } from '../screenshot-area/screenshot-area.js'
import { scheduleTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'
import { publishChange } from '../browser-state/browser-state.js'

/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. The keyboard listener keeps its own copy. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000

/**
 * Follows the person's mouse, wheel and touch input on a page. While trusted
 * chrome covers the pages, or a screenshot area selection or element picker
 * is in progress, a person's mouse input goes to that instead of the page;
 * the human input lock may hold it back. Otherwise the input is recorded,
 * refreshes the tab's overview preview, makes following wait, and a press or
 * touch on the other split pane makes it the active tab; a touch counts as no
 * click, since it may start a scroll.
 */
export function attachPagePointerEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  // Wheel and touch input never reach before-mouse-event; while the person scrolls or touches
  // the page, following waits.
  const webContentsId = webContents.id
  webContents.on('input-event', (_event, input) => {
    if (input.type !== 'mouseWheel' && input.type !== 'touchStart') return
    scheduleTabOverviewPreview(browser, tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
    if (browser.agentInputWebContents.has(webContentsId) || agentWheelUnderWay(browser, webContentsId)) return
    browser.mcpActivityFollower.noteHumanInput()
    // A touch may start a scroll, so it is no click, but a touch on the other split pane makes it the active pane as a
    // click does, unless trusted chrome covers the pages or the human input lock holds the page.
    if (input.type === 'touchStart' && !browser.browserContentOccluded && !browser.isHumanInteractionLocked(tab)) {
      selectOtherPane(browser, tab)
    }
  })
  webContents.once('destroyed', () => browser.agentWheel.delete(webContentsId))
  webContents.on('before-mouse-event', (event, mouse) => {
    if (browser.browserContentOccluded && !browser.agentInputWebContents.has(webContents.id)) {
      // Trusted chrome is open; a click must not give the page focus, activation or the active split pane.
      event.preventDefault()
      return
    }
    const screenshotSession = browser.screenshotAreaSessions.get(webContents.id)
    if (screenshotSession && !screenshotSession.canceled && !browser.agentInputWebContents.has(webContents.id)) {
      event.preventDefault()
      if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
        queueScreenshotAreaMouseInput(browser, tab, screenshotSession, 'down', mouse)
      } else if (mouse.type === 'mouseMove') {
        queueScreenshotAreaMouseInput(browser, tab, screenshotSession, 'move', mouse)
      } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
        queueScreenshotAreaMouseInput(browser, tab, screenshotSession, 'up', mouse)
      }
      return
    }
    const elementPickerSession = browser.elementPickerSessions.get(webContents.id)
    if (elementPickerSession && !elementPickerSession.canceled && !browser.agentInputWebContents.has(webContents.id)) {
      event.preventDefault()
      if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
        queueElementPickerMouseInput(browser, tab, elementPickerSession, 'down', mouse)
      } else if (mouse.type === 'mouseMove') {
        queueElementPickerMouseInput(browser, tab, elementPickerSession, 'move', mouse)
      } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
        queueElementPickerMouseInput(browser, tab, elementPickerSession, 'up', mouse)
      }
      return
    }
    if (shouldBlockHumanMouseInput(browser, tab, mouse)) {
      event.preventDefault()
      return
    }
    browser.reproRecorder.observeReproMouse(tab, mouse)
    if (mouse.type === 'mouseUp') scheduleTabOverviewPreview(browser, tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
    if ((mouse.type === 'mouseDown' || mouse.type === 'contextMenu') && !browser.agentInputWebContents.has(webContents.id)) {
      tab.humanInteractionGeneration += 1
      tab.lastHumanInteractionAt = Date.now()
      tab.lastActiveAt = tab.lastHumanInteractionAt
      browser.mcpActivityFollower.noteHumanInput()
      selectOtherPane(browser, tab)
      browser.options.onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
    }
  })
}

/**
 * The person pressed or touched the other split pane's page, which following
 * did not show: it becomes the active tab. It is a selection, so a tab still
 * waking for an earlier one stays out.
 */
function selectOtherPane(browser: Browser, tab: BrowserTab): void {
  if (!browser.splitViewContains(tab.id) || browser.activeTabId === tab.id) return
  browser.agentFollow = undefined
  browser.tabSelectionGeneration += 1
  browser.writeActiveTabId(tab.id)
  browser.markTabActiveInGroup(tab)
  publishChange(browser)
}
