import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'

/**
 * Reports what Chrome's status bubble shows for a page: the address of the link under the person's pointer or with
 * keyboard focus, as Chromium reports it changing, and where the pointer is over the page, which the bubble moves out
 * of the way of. An agent's input or tool call says nothing about what the person points at, and nothing of an agent's
 * is drawn over the page: from an agent's input, or a link reported during its tool call, until the person's next
 * input after it, the page reports none.
 */
export function attachPageTargetUrlEvents(browser: Browser, tab: { id: string }, webContents: WebContents): void {
  let agentHeld = false
  const holdForAgent = (): void => {
    if (!agentHeld) browser.options.onPageTargetUrl?.(tab.id, '')
    agentHeld = true
  }
  const agentInput = (): boolean => browser.agentInputWebContents.has(webContents.id)
  webContents.on('before-mouse-event', (_event, mouse) => {
    if (agentInput()) {
      holdForAgent()
      return
    }
    agentHeld = false
    if (mouse.type === 'mouseLeave') browser.options.onPagePointer?.(tab.id, null)
    else if (mouse.type === 'mouseMove' || mouse.type === 'mouseEnter') browser.options.onPagePointer?.(tab.id, { x: mouse.x, y: mouse.y })
  })
  webContents.on('before-input-event', () => {
    if (agentInput()) holdForAgent()
    else agentHeld = false
  })
  webContents.on('update-target-url', (_event, url) => {
    // Through the debugger, an agent's input or script reaches no input event; whose link this is cannot be told.
    if (agentInput() || browser.mcpActivitiesByTab.has(tab.id)) holdForAgent()
    else if (!agentHeld) browser.options.onPageTargetUrl?.(tab.id, url)
  })
  webContents.once('destroyed', () => browser.options.onPageTargetUrl?.(tab.id, ''))
}
