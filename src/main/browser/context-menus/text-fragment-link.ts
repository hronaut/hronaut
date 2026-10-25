import { isWebUrl } from '../url.js'

/** Chrome quotes a selection whole up to this length, and longer text by its first and last words. */
const EXACT_TEXT_MAX_LENGTH = 300
/** The words that mark where a longer selection starts and where it ends. */
const RANGE_WORDS = 5
/** How long the words that mark an end may grow; a single longer word, such as an address, still marks it. */
const RANGE_TERM_MAX_LENGTH = 100
/** The most words added around text that the page holds more than once, to find it rather than its first copy. */
const CONTEXT_WORDS = 3
/** The longest address Chromium opens. */
const URL_MAX_LENGTH = 2 * 1024 * 1024

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })

/**
 * The page's text as a text fragment searches it: runs of text that a match cannot cross (a block, a table cell, a line),
 * and where the selection starts and ends in them.
 */
export type HighlightPageText = {
  runs: readonly string[]
  start: { run: number, offset: number }
  end: { run: number, offset: number }
}

type TextDirective = { prefix?: string, start: string, end?: string, suffix?: string }

/**
 * The link Copy link to highlight copies, as in Chrome: the page's address with a text fragment, which scrolls to the
 * selected text and highlights it when the link is opened (https://wicg.github.io/scroll-to-text-fragment/). A short
 * selection within one run of text is quoted whole, and a longer one, or one across runs, by its first and last words.
 *
 * From the page's text, the selection grows to whole words, since a match starts and ends at whole words, and text the
 * page holds more than once gets the words around it. The menu's selected text alone, which is all there is until the
 * page is read, gives a link to the text's first match. The page's own fragment and its other directives stay, a text
 * directive it already had gives way to the new one, and a sign-in in the address is left out. Undefined for an address
 * that is not a web page's, for a selection of only spaces, and for a link too long to open.
 */
export function textFragmentLink(pageUrl: string, selection: string | HighlightPageText): string | undefined {
  if (!isWebUrl(pageUrl)) return undefined
  const directive = typeof selection === 'string' ? selectedTextDirective(selection) : pageTextDirective(selection)
  if (!directive) return undefined
  const url = new URL(pageUrl)
  url.username = ''
  url.password = ''
  const fragment = url.hash.slice(1)
  const directiveAt = fragment.indexOf(':~:')
  const pageFragment = directiveAt < 0 ? fragment : fragment.slice(0, directiveAt)
  const otherDirectives = directiveAt < 0 ? [] : fragment.slice(directiveAt + 3).split('&').filter((entry) => entry && !entry.startsWith('text='))
  url.hash = ''
  const link = `${url.href}#${pageFragment}:~:${[...otherDirectives, `text=${formatDirective(directive)}`].join('&')}`
  return link.length <= URL_MAX_LENGTH ? link : undefined
}

// The menu gives each line and table cell of the selection apart, with the spaces the page shows.
function selectedTextDirective(selectionText: string): TextDirective | undefined {
  const runs = readable(selectionText).split(/[\n\t]/u).map((run) => run.trim()).filter(Boolean)
  const first = runs[0]
  const last = runs.at(-1)
  return first && last ? quoteOrRange(first, last, runs.length === 1) : undefined
}

function pageTextDirective(page: HighlightPageText): TextDirective | undefined {
  const runs = page.runs.map(readable)
  const startRun = runs[page.start.run]
  const endRun = runs[page.end.run]
  if (startRun === undefined || endRun === undefined) return undefined
  const start = { run: page.start.run, offset: wordStart(startRun, page.start.offset) }
  const end = { run: page.end.run, offset: wordEnd(endRun, page.end.offset) }
  const pieces: Array<{ run: number, from: number, to: number }> = []
  for (let run = start.run; run <= end.run; run++) {
    const text = runs[run] ?? ''
    const from = run === start.run ? start.offset : 0
    const to = run === end.run ? end.offset : text.length
    const piece = text.slice(from, to)
    const trimmedFrom = from + piece.length - piece.trimStart().length
    const trimmedTo = to - piece.length + piece.trimEnd().length
    if (trimmedFrom < trimmedTo) pieces.push({ run, from: trimmedFrom, to: trimmedTo })
  }
  const first = pieces[0]
  const last = pieces.at(-1)
  if (!first || !last) return undefined
  const directive = quoteOrRange(runs[first.run]!.slice(first.from, first.to), runs[last.run]!.slice(last.from, last.to), pieces.length === 1)
  return withContext(directive, runs, runs[first.run]!.slice(0, first.from), runs[last.run]!.slice(last.to))
}

// Half of a character that lost its other half, which a page can select, reads as U+FFFD, as Chrome reads it.
function readable(text: string): string {
  return text.replace(/\p{Cs}/gu, '\uFFFD')
}

// A text directive matches within one run, so a selection across runs is always marked by its ends.
function quoteOrRange(first: string, last: string, single: boolean): TextDirective {
  if (single && first.length <= EXACT_TEXT_MAX_LENGTH) return { start: first }
  // Text too short in words to mark by its ends without the two overlapping is quoted whole.
  if (single && [...first.matchAll(/\S+/gu)].length < RANGE_WORDS * 2) return { start: first }
  return { start: leadingWords(first, RANGE_WORDS, RANGE_TERM_MAX_LENGTH), end: trailingWords(last, RANGE_WORDS, RANGE_TERM_MAX_LENGTH) }
}

// Chrome adds the words just before and after text that the page holds more than once, until the link finds only it.
// Before a range, the words go before its start, which is where the page looks for it first.
function withContext(directive: TextDirective, runs: readonly string[], before: string, after: string): TextDirective {
  if (matchCount(runs, directive) <= 1) return directive
  let widest = directive
  for (let words = 1; words <= CONTEXT_WORDS; words++) {
    const prefix = trailingWords(before.trimEnd(), words)
    const suffix = directive.end === undefined ? leadingWords(after.trimStart(), words) : ''
    if (!prefix && !suffix) return directive
    widest = { ...directive, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) }
    if (matchCount(runs, widest) <= 1) return widest
  }
  return widest
}

// The first words of a text, while they stay short, with the spaces between them as the page has them. A match starts
// and ends at whole words, so a word is never cut, and the first word is kept however long it is.
function leadingWords(text: string, count: number, maxLength = Infinity): string {
  let end = 0
  for (const word of [...text.matchAll(/\S+/gu)].slice(0, count)) {
    const wordEnd = word.index + word[0].length
    if (end && wordEnd > maxLength) break
    end = wordEnd
  }
  return text.slice(0, end)
}

// The last words of a text, as leadingWords takes the first.
function trailingWords(text: string, count: number, maxLength = Infinity): string {
  let start = text.length
  for (const word of [...text.matchAll(/\S+/gu)].slice(-count).reverse()) {
    if (start < text.length && text.length - word.index > maxLength) break
    start = word.index
  }
  return text.slice(start)
}

// Where the matches of a directive's start would begin in the page: a match is case-insensitive, starts and ends at
// whole words, keeps within one run, and finds the prefix and suffix next to the start with only spaces between.
function matchCount(runs: readonly string[], directive: TextDirective): number {
  const pattern = new RegExp(
    `${directive.prefix ? `${termPattern(directive.prefix)}\\s*` : ''}${termPattern(directive.start)}${directive.suffix ? `\\s*${termPattern(directive.suffix)}` : ''}`,
    'giu'
  )
  let count = 0
  for (const run of runs) {
    for (const match of run.matchAll(pattern)) {
      if (isWordBoundary(run, match.index) && isWordBoundary(run, match.index + match[0].length)) count++
    }
  }
  return count
}

// Each space matches one space of any kind, as Chromium matches a no-break space to a space but not two spaces to one.
function termPattern(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&').replace(/\s/gu, '\\s')
}

// A selection that starts or ends inside a word grows to the whole word, as in Chrome.
function wordStart(text: string, offset: number): number {
  const window = Math.max(0, offset - 64)
  const segment = WORDS.segment(text.slice(window, offset + 64)).containing(offset - window)
  return segment?.isWordLike && window + segment.index < offset ? window + segment.index : offset
}

function wordEnd(text: string, offset: number): number {
  if (offset <= 0) return offset
  const window = Math.max(0, offset - 64)
  const segment = WORDS.segment(text.slice(window, offset + 64)).containing(offset - 1 - window)
  const segmentEnd = segment ? window + segment.index + segment.segment.length : offset
  return segment?.isWordLike && segmentEnd > offset ? segmentEnd : offset
}

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true
  const window = Math.max(0, index - 64)
  return WORDS.segment(text.slice(window, index + 64)).containing(index - window)?.index === index - window
}

function formatDirective(directive: TextDirective): string {
  return [
    directive.prefix ? `${directiveTerm(directive.prefix)}-` : '',
    directiveTerm(directive.start),
    directive.end === undefined ? '' : directiveTerm(directive.end),
    directive.suffix ? `-${directiveTerm(directive.suffix)}` : ''
  ].filter(Boolean).join(',')
}

// A term is escaped as an address part, and its dashes too, since a dash marks the text around a match.
function directiveTerm(text: string): string {
  return encodeURIComponent(text).replaceAll('-', '%2D')
}
