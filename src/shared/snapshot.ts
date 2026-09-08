/** Completeness of the bounded snapshot representation, not the entire DOM. */
export interface BrowserSnapshot {
  text: string
  maxChars: number
  returnedChars: number
  truncated: boolean
  omitted: { headings: boolean; controls: boolean; bodyText: boolean; characters: boolean }
}
