import { pageScript } from '../../../shared/page-script.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { isHronautHomeUrl } from '../url.js'
import { callThroughPageDialogs } from '../page-dialog-waits.js'
import { isTabAgentPaused } from '../agent-pause/agent-pause.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { personTypedValuesInPage } from './person-typed-text.page.js'

/**
 * Whether what the person does in the tab now is theirs rather than its agent's: agents are paused there, as when the
 * person took it over, or an agent asked the person for it, as to sign in, and has not had an answer yet.
 */
export function personHoldsTab(browser: Browser, tab: Pick<BrowserTab, 'id' | 'mcpGroupId'>): boolean {
  if (!tab.mcpGroupId) return false
  return isTabAgentPaused(browser, tab.id) || Boolean(browser.options.getTabAttention?.(tab.id, tab.mcpGroupId))
}

/**
 * Watches the fields of the tab's page and keeps what the person typed, pasted or filled into them while the page was
 * theirs (see personHoldsTab), or just before they handed it back. After each report it watches again, until another watcher takes over in the document
 * or the document goes.
 */
export function watchPersonTypedValues(browser: Browser, tab: BrowserTab): void {
  if (!tab.mcpGroupId || isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) return
  const script = pageScript(personTypedValuesInPage)
  void callThroughPageDialogs(() => tab.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.personTypedText, [{ code: script }], false))
    .then((values: unknown) => {
      if (!Array.isArray(values)) return
      const texts = values.filter((value): value is string => typeof value === 'string' && value.length > 0)
      const theirs = personHoldsTab(browser, tab) || browser.personTypedText.heldLately(tab.id)
      if (texts.length && theirs) browser.personTypedText.remember(tab.mcpGroupId, texts)
      watchPersonTypedValues(browser, tab)
    })
    .catch(() => undefined)
}
