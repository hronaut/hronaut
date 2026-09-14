export const BROWSER_SNAPSHOT_FORMAT_VERSION = 1

/** Completeness of the bounded snapshot representation, not the entire DOM. */
export interface BrowserSnapshot {
  formatVersion: number
  text: string
  maxChars: number
  returnedChars: number
  truncated: boolean
  omitted: { headings: boolean; controls: boolean; bodyText: boolean; characters: boolean }
}
