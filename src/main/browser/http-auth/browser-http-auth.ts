import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { answerHttpAuth } from './http-auth.js'

/** Asks the person to sign in for a challenge the tab's page received, or leaves Electron to cancel it. */
export function answerTabHttpAuth(browser: Browser, tab: BrowserTab, event: Electron.Event, details: Electron.AuthenticationResponseDetails,
  authInfo: Electron.AuthInfo, callback: (username?: string, password?: string) => void): void {
  answerHttpAuth({ askToSignIn: async (question) => browser.options.askToSignIn?.(question) ?? null }, tab, event, details, authInfo, callback)
}
