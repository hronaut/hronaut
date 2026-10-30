import { domChangesInPage } from './dom-changes.page.js'
import { pageScript } from './page-script.js'

export const DOM_CHANGES_LIMITS = {
  maxEntries: 200,
  maxSelectorChars: 512,
  maxAttributeNameChars: 64,
  maxTagNameChars: 64,
  maxTagsPerEntry: 8
} as const

export type DomChangesPageAction = 'start' | 'get' | 'stop' | 'clear'

/** The isolated-world script that starts, reads, stops or clears the document's change recording. */
export function domChangesPageScript(action: DomChangesPageAction): string {
  return pageScript(domChangesInPage, action, DOM_CHANGES_LIMITS)
}
