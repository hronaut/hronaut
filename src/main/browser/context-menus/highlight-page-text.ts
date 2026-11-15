import type { WebContents } from 'electron'
import { pageScript } from '../../../shared/page-script.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { highlightPageTextInPage } from './highlight-page-text.page.js'
import type { HighlightPageText } from './text-fragment-link.js'

/** How long the page may take to give its text before the link is made from the menu's selected text alone. */
const READ_TIMEOUT_MS = 2_000
/** Pages larger than this give no text, and get the link from the selected text alone. */
const TEXT_NODES_MAX = 200_000
const TEXT_MAX_LENGTH = 4_000_000
// Two noncharacters mark where the selection starts and ends in the page's text, since no page text holds them;
// highlightPageTextInPage writes the same two.
const START = '\uFDD0'
const END = '\uFDD1'

/**
 * Reads the main frame's text the way a text fragment searches it, with the selection marked, for Copy link to
 * highlight: runs of shown text, which end at a block, an inline block, a table cell, a line break and a preserved line,
 * with spaces collapsed as the page shows them. Unlike the menu's selected text, a run keeps text the page makes
 * unselectable, which a text fragment still finds. The page cannot see the read, which runs in a world of its own and
 * changes nothing. Undefined when the page is gone, slow or too large, or when its selection is no longer the menu's.
 */
export async function readHighlightPageText(webContents: WebContents, selectionText: string): Promise<HighlightPageText | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (webContents.isDestroyed()) return undefined
    const raw: unknown = await Promise.race([
      webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.linkToHighlight, [{ code: pageScript(highlightPageTextInPage, Date.now() + READ_TIMEOUT_MS, TEXT_NODES_MAX, TEXT_MAX_LENGTH) }]),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), READ_TIMEOUT_MS) })
    ])
    const page = markedPageText(raw)
    return page && isSelection(page, selectionText) ? page : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

// The runs with the selection's marks taken out and kept as places, or undefined unless there is one start before one end.
function markedPageText(raw: unknown): HighlightPageText | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { runs?: unknown }).runs)) return undefined
  const marked = (raw as { runs: unknown[] }).runs
  if (!marked.every((run): run is string => typeof run === 'string')) return undefined
  let start: HighlightPageText['start'] | undefined
  let end: HighlightPageText['end'] | undefined
  const runs: string[] = []
  for (const [run, text] of marked.entries()) {
    let clean = text
    const startAt = clean.indexOf(START)
    if (startAt !== -1) {
      if (start || end) return undefined
      start = { run, offset: startAt }
      clean = clean.slice(0, startAt) + clean.slice(startAt + 1)
    }
    const endAt = clean.indexOf(END)
    if (endAt !== -1) {
      if (!start || end || (start.run === run && endAt < start.offset)) return undefined
      end = { run, offset: endAt }
      clean = clean.slice(0, endAt) + clean.slice(endAt + 1)
    }
    if (clean.includes(START) || clean.includes(END)) return undefined
    runs.push(clean)
  }
  if (!start || !end) return undefined
  return { runs, start, end }
}

// The page's selection is still the one the menu was opened for when the menu's words read in order among the page's.
// The menu leaves out text the page makes unselectable, which the page's text keeps.
function isSelection(page: HighlightPageText, selectionText: string): boolean {
  const selected = page.runs.slice(page.start.run, page.end.run + 1).map((text, index) => {
    const run = page.start.run + index
    return text.slice(run === page.start.run ? page.start.offset : 0, run === page.end.run ? page.end.offset : text.length)
  }).join(' ').toLowerCase().split(/\s+/u)
  const wanted = selectionText.toLowerCase().split(/\s+/u).filter(Boolean)
  let at = 0
  for (const word of wanted) {
    at = selected.indexOf(word, at) + 1
    if (!at) return false
  }
  return wanted.length > 0
}
