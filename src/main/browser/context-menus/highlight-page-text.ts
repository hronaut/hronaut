import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { HighlightPageText } from './text-fragment-link.js'

/** How long the page may take to give its text before the link is made from the menu's selected text alone. */
const READ_TIMEOUT_MS = 2_000
/** Pages larger than this give no text, and get the link from the selected text alone. */
const TEXT_NODES_MAX = 200_000
const TEXT_MAX_LENGTH = 4_000_000
// Two noncharacters mark where the selection starts and ends in the page's text, since no page text holds them.
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
      webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.linkToHighlight, [{ code: pageTextScript(Date.now() + READ_TIMEOUT_MS) }]),
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

function pageTextScript(deadline: number): string {
  return `(() => {
    const deadline = ${deadline}, start = '\\uFDD0', end = '\\uFDD1'
    const selection = getSelection()
    if (!document.body || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const styles = new Map(), blocks = new Map()
    const style = (element) => {
      let known = styles.get(element)
      if (!known) {
        const computed = getComputedStyle(element)
        known = { display: computed.display, collapse: computed.whiteSpaceCollapse, shown: computed.display === 'contents' || element.checkVisibility({ visibilityProperty: true }) }
        styles.set(element, known)
      }
      return known
    }
    // Text runs on across inline elements, and a block, an inline block or a table cell starts a run of its own.
    const blockOf = (element) => {
      let block = blocks.get(element)
      if (!block) {
        const display = style(element).display
        block = element === document.body || !element.parentElement || !['inline', 'contents', 'ruby'].includes(display) ? element : blockOf(element.parentElement)
        blocks.set(element, block)
      }
      return block
    }
    const runs = []
    let run = '', runBlock = null, nodes = 0, length = 0, started = false, ended = false
    const endRun = () => {
      run = run.replace(/ +$/, '')
      if (run) runs.push(run)
      run = ''
    }
    const markEnd = () => {
      if (run || !runs.length) run += end
      else runs[runs.length - 1] += end
      ended = true
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++nodes > ${TEXT_NODES_MAX} || Date.now() > deadline) return null
      if (!ended && node !== range.startContainer && range.comparePoint(node, 0) === 1) {
        if (!started) return null
        markEnd()
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.localName === 'br') endRun()
        continue
      }
      const parent = node.parentElement
      if (!parent || ['textarea', 'select', 'option', 'optgroup'].includes(parent.localName) || !style(parent).shown) continue
      const block = blockOf(parent)
      if (block !== runBlock) {
        endRun()
        runBlock = block
      }
      let text = node.data
      const startsHere = !started && (node === range.startContainer || range.comparePoint(node, 0) === 0)
      const endsHere = !ended && node === range.endContainer
      if (endsHere) text = text.slice(0, range.endOffset) + end + text.slice(range.endOffset)
      if (startsHere) {
        const offset = node === range.startContainer ? range.startOffset : 0
        text = text.slice(0, offset) + start + text.slice(offset)
        started = true
      }
      if (endsHere) {
        if (!started) return null
        ended = true
      }
      const collapse = style(parent).collapse
      if (collapse === 'collapse') text = text.replace(/[ \\t\\n\\r\\f]+/g, ' ')
      else if (collapse === 'preserve-breaks') text = text.replace(/[ \\t\\f]+/g, ' ')
      // A line the page keeps ends the run, as a line break does.
      const lines = collapse === 'collapse' ? [text] : text.split(/\\r\\n|[\\n\\r]/)
      lines.forEach((line, index) => {
        if (index) endRun()
        if ((collapse === 'collapse' || collapse === 'preserve-breaks') && line.startsWith(' ') && (!run || run.endsWith(' '))) line = line.slice(1)
        run += line
      })
      length += text.length
      if (length > ${TEXT_MAX_LENGTH}) return null
    }
    if (!started) return null
    if (!ended) markEnd()
    endRun()
    return { runs }
  })()`
}

// The runs with the selection's marks taken out and kept as places, or undefined unless there is one start before one end.
function markedPageText(raw: unknown): HighlightPageText | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { runs?: unknown }).runs)) return undefined
  const marked = (raw as { runs: unknown[] }).runs
  if (!marked.every((run): run is string => typeof run === 'string')) return undefined
  let start: HighlightPageText['start'] | undefined
  let end: HighlightPageText['end'] | undefined
  const runs = marked.map((text, run) => {
    let clean = ''
    for (const character of text) {
      if (character === START && !start && !end) start = { run, offset: clean.length }
      else if (character === END && start && !end) end = { run, offset: clean.length }
      else if (character === START || character === END) return undefined
      else clean += character
    }
    return clean
  })
  if (!start || !end || runs.some((run) => run === undefined)) return undefined
  return { runs: runs as string[], start, end }
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
