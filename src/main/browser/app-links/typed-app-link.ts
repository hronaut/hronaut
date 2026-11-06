import { shell } from 'electron'
import type { Browser } from '../browser.js'

/** Schemes Hronaut opens itself, or never hands to another app. */
const NOT_APP_SCHEMES: ReadonlySet<string> = new Set([
  'http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:', 'data:', 'blob:', 'filesystem:', 'about:', 'javascript:', 'vbscript:',
  'view-source:', 'chrome:', 'chrome-extension:', 'devtools:', 'hronaut:', 'shell:'
])

/** The longest scheme the question shows in full; a longer one is cut, as the website's app-link prompt does. */
const SHOWN_SCHEME_LENGTH = 64

/** The scheme of an address another app opens, such as mailto: or zoommtg:, or undefined for any other address. */
export function appLinkScheme(address: string): string | undefined {
  let scheme: string
  try {
    scheme = new URL(address).protocol
  } catch {
    return undefined
  }
  return NOT_APP_SCHEMES.has(scheme) ? undefined : scheme
}

/**
 * An app link the person typed in the address bar or chose, such as mailto: or zoommtg:, which a workspace's tab never
 * loads: as in Chrome, Hronaut asks, naming only the scheme, since the rest can carry tokens, and hands it to the app
 * the system uses for it. The tab's page stays as it was.
 */
export async function openAppLinkForPerson(browser: Browser, address: string, scheme: string): Promise<void> {
  const shown = scheme.length > SHOWN_SCHEME_LENGTH ? `${scheme.slice(0, SHOWN_SCHEME_LENGTH - 1)}…` : scheme
  try {
    if (!await (browser.options.confirmOpenAppLink?.(shown) ?? Promise.resolve(false))) return
    await shell.openExternal(address)
  } catch (error) {
    console.error('[browser] Could not open a link in another app:', error)
    browser.options.onActionFailed?.('open a link in another app', error)
  }
}
