import type { WebContents } from 'electron'
import type { BrowserFindPageKey } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { getTab } from '../browser-core.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { pageScriptsRunNow } from '../page-script-readiness.js'

// Unfocuses the page's focused element, as Chromium's ClearFocusedElement does, and nothing else. It runs in a world of
// its own, so the page cannot change what blur does.
const CLEAR_FOCUS_SCRIPT = 'void document.activeElement?.blur?.()'

// How long a key waits for the page to unfocus its element. A page whose script cannot run soon, such as one busy with
// its own work, gets the key anyway, as it would get the person's own key.
const CLEAR_FOCUS_WAIT_MS = 300

// The names Electron gives these keys.
const ELECTRON_KEY_CODES: Readonly<Record<BrowserFindPageKey['key'], string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End'
}

/** Each page's keys from the Find field, in the order the person pressed them. */
const sending = new WeakMap<WebContents, Promise<void>>()

/**
 * Sends a key the person pressed or released in the Find field on to the tab's page, as Chrome's find bar does with
 * the keys that scroll the page: Up, Down, Page Up and Page Down, and Home and End with Ctrl. As Chrome does, the page's
 * focused element is unfocused first, so a text field the person left there does not take the arrow keys. The key is
 * the person's own input to the page, so, as their key there does, it reaches only the page in view, and not a page
 * behind trusted chrome, a locked tab, a page an agent is sending input to or a page with an area capture or element
 * pick in progress.
 */
export function forwardFindKeyToPage(browser: Browser, tabId: string, key: BrowserFindPageKey): void {
  const tab = getTab(browser, tabId)
  if (!takesTheKey(browser, tab)) return
  const page = tab.webContents
  const previous = sending.get(page) ?? Promise.resolve()
  const next = previous.then(async () => {
    if (key.type === 'keyDown' && pageScriptsRunNow(page)) await clearFocusedElement(page)
    // The page may have gone, or an agent or a lock taken it, while it unfocused its element.
    if (!page.isDestroyed() && takesTheKey(browser, tab)) page.sendInputEvent(inputEvent(key))
  }).catch(() => undefined)
  sending.set(page, next)
}

/** Whether the person's key may reach the tab's page, as forwardFindKeyToPage describes. */
function takesTheKey(browser: Browser, tab: BrowserTab): boolean {
  return tab.id === browser.activeTabId
    && browser.tabs.get(tab.id) === tab
    && !browser.browserContentOccluded
    && !browser.isHumanInteractionLocked(tab)
    && !browser.agentInputWebContents.has(tab.webContents.id)
    && !browser.screenshotAreaSessions.has(tab.webContents.id)
    && !browser.elementPickerSessions.has(tab.webContents.id)
}

async function clearFocusedElement(page: WebContents): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<void>((resolve) => { timer = setTimeout(resolve, CLEAR_FOCUS_WAIT_MS) })
  const cleared = page.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.findPageKeys, [{ code: CLEAR_FOCUS_SCRIPT }])
    .then(() => undefined, () => undefined)
  await Promise.race([cleared, waited])
  clearTimeout(timer)
}

function inputEvent(key: BrowserFindPageKey): Electron.KeyboardInputEvent {
  const modifiers: NonNullable<Electron.KeyboardInputEvent['modifiers']> = []
  if (key.shift) modifiers.push('shift')
  if (key.control) modifiers.push('control')
  if (key.alt) modifiers.push('alt')
  if (key.meta) modifiers.push('meta')
  if (key.repeat) modifiers.push('isautorepeat')
  return { type: key.type, keyCode: ELECTRON_KEY_CODES[key.key], modifiers }
}
