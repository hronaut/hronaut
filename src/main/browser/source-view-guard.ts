import type { WebContents } from 'electron'
import { LocalizedError } from '../localized-error.js'

/** A page script refused unsent because the tab shows a page's source, where Electron never finishes one. */
export class SourceViewError extends LocalizedError {
  constructor() {
    super('appErrors.page.sourceViewRunsNoScripts')
    this.name = 'SourceViewError'
  }
}

/** Whether an address is a page's source: `view-source:` before it, in any case. */
export function isSourceViewUrl(url: string): boolean {
  return url.slice(0, 'view-source:'.length).toLowerCase() === 'view-source:'
}

type GuardedPage = Pick<WebContents, 'isDestroyed' | 'getURL' | 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld'>

/**
 * Electron never settles a page's executeJavaScript or executeJavaScriptInIsolatedWorld call while the page shows a
 * source (a `view-source:` address, which a person or an agent can open), though the main frame's own executeJavaScript
 * and DevTools commands answer there. An agent's browser_snapshot on such a tab then never returned, and kept its tab
 * and workspace busy. Installed once on each tab's page, below the other guards so a call that waits for the next
 * document runs in it, this makes those calls fail at once, unsent, while the shown document is a source. Captures,
 * printing and DevTools commands are left alone, since they work there.
 */
export function refusePageScriptsInSourceView(page: GuardedPage): void {
  const executeJavaScript = page.executeJavaScript.bind(page)
  const executeJavaScriptInIsolatedWorld = page.executeJavaScriptInIsolatedWorld.bind(page)
  const showsSource = (): boolean => !page.isDestroyed() && isSourceViewUrl(page.getURL())
  page.executeJavaScript = (...args) => showsSource() ? Promise.reject(new SourceViewError()) : executeJavaScript(...args)
  page.executeJavaScriptInIsolatedWorld = (...args) => showsSource()
    ? Promise.reject(new SourceViewError())
    : executeJavaScriptInIsolatedWorld(...args)
}
