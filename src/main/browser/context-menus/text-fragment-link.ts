import { isWebUrl } from '../url.js'

/** Chrome quotes a selection whole up to this length, and longer text by its first and last words. */
const EXACT_TEXT_MAX_LENGTH = 300
/** The words that mark where a longer selection starts and where it ends. */
const RANGE_WORDS = 5
/** How long the words that mark an end may grow; a single longer word, such as an address, still marks it. */
const RANGE_TERM_MAX_LENGTH = 100
/** The most words added around text that the page holds more than once, to find it rather than its first copy. */
const CONTEXT_WORDS = 3
/** How much of the text around the selection the words around it are taken from. */
const CONTEXT_TEXT_MAX_LENGTH = 2000
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
  // Text that starts or ends its run takes the words around it from the run before or after, which Chromium finds
  // across the line between them.
  const before = runs[first.run]!.slice(0, first.from)
  const after = runs[last.run]!.slice(last.to)
  return withContext(directive, runs, before.trim() ? before : runs[first.run - 1] ?? '', after.trim() ? after : runs[last.run + 1] ?? '')
}

// Half of a character that lost its other half, which a page can select, reads as U+FFFD, as Chrome reads it.
function readable(text: string): string {
  return text.replace(/\p{Cs}/gu, '\uFFFD')
}

// A text directive matches within one run, so a selection across runs is always marked by its ends.
function quoteOrRange(first: string, last: string, single: boolean): TextDirective {
  if (single && first.length <= EXACT_TEXT_MAX_LENGTH) return { start: first }
  // Text too short in words to mark by its ends without the two overlapping is quoted whole.
  if (single && wordsOf(first).length < RANGE_WORDS * 2) return { start: first }
  return { start: leadingWords(first, RANGE_WORDS, RANGE_TERM_MAX_LENGTH), end: trailingWords(last, RANGE_WORDS, RANGE_TERM_MAX_LENGTH) }
}

// Chrome adds the words just before and after text that the page holds more than once, until the link finds only it.
// Before a range, the words go before its start, which is where the page looks for it first.
function withContext(directive: TextDirective, runs: readonly string[], before: string, after: string): TextDirective {
  const page = runs.map(fold).join('\n')
  if (!matchesMoreThanOnce(page, directive)) return directive
  let widest = directive
  for (let words = 1; words <= CONTEXT_WORDS; words++) {
    const prefix = trailingWords(before.trimEnd().slice(-CONTEXT_TEXT_MAX_LENGTH), words)
    const suffix = directive.end === undefined ? leadingWords(after.trimStart().slice(0, CONTEXT_TEXT_MAX_LENGTH), words) : ''
    if (!prefix && !suffix) return directive
    widest = { ...directive, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) }
    if (!matchesMoreThanOnce(page, widest)) return widest
  }
  return widest
}

// The words of a text as Intl.Segmenter finds them, so that text written without spaces, such as Japanese, has words.
function wordsOf(text: string): Array<{ start: number, end: number }> {
  return [...WORDS.segment(text)].filter((segment) => segment.isWordLike).map((segment) => ({ start: segment.index, end: segment.index + segment.segment.length }))
}

// The first words of a text, while they stay short, with the spaces between them as the page has them. A match starts
// and ends at whole words, so a word is never cut, and the first word is kept however long it is.
function leadingWords(text: string, count: number, maxLength = Infinity): string {
  let end = 0
  for (const word of wordsOf(text).slice(0, count)) {
    if (end && word.end > maxLength) break
    end = word.end
  }
  return text.slice(0, end)
}

// The last words of a text, as leadingWords takes the first.
function trailingWords(text: string, count: number, maxLength = Infinity): string {
  let start = text.length
  for (const word of wordsOf(text).slice(-count).reverse()) {
    if (start < text.length && text.length - word.start > maxLength) break
    start = word.start
  }
  return text.slice(start)
}

// Whether the page holds a directive's text more than once, so that the link could open another copy first. The page
// is its runs folded, one to a line. A match starts and ends at whole words and keeps within one run, and the prefix
// and suffix sit next to it with only spaces between, which may cross into the run before or after, as in Chromium.
// Counting stops at the second match, since only that matters.
function matchesMoreThanOnce(page: string, directive: TextDirective): boolean {
  const pattern = new RegExp(
    `${directive.prefix ? `${termPattern(directive.prefix)}\\s*` : ''}${termPattern(directive.start)}${directive.suffix ? `\\s*${termPattern(directive.suffix)}` : ''}`,
    'giu'
  )
  let count = 0
  for (const match of page.matchAll(pattern)) {
    if (isWordBoundary(page, match.index) && isWordBoundary(page, match.index + match[0].length) && ++count > 1) return true
  }
  return false
}

// Chromium matches text as alike when it differs only in case, accents or width, and reads curly quotes as straight.
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[\u2018\u2019\u201B]/gu, "'").replace(/[\u201C\u201D\u201F]/gu, '"').toLowerCase()
}

// Each space matches one space of any kind within the run, as Chromium matches a no-break space to a space but not two
// spaces to one.
function termPattern(text: string): string {
  return fold(text).replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&').replace(/\s/gu, '[^\\S\\n]')
}

// A selection that starts or ends inside a word grows to the whole word, as in Chrome.
function wordStart(text: string, offset: number): number {
  const segment = segmentAt(text, offset)
  return segment?.isWordLike && segment.start < offset ? segment.start : offset
}

function wordEnd(text: string, offset: number): number {
  if (offset <= 0) return offset
  const segment = segmentAt(text, offset - 1)
  return segment?.isWordLike && segment.end > offset ? segment.end : offset
}

function isWordBoundary(text: string, index: number): boolean {
  return index <= 0 || index >= text.length || segmentAt(text, index)?.start === index
}

// The word or the gap between words at a place in a text. Only the text around the place is segmented, and more of it
// while the segment reaches the edge of what was, so that a long word is still found whole.
function segmentAt(text: string, index: number): { start: number, end: number, isWordLike: boolean } | undefined {
  for (let reach = 64; ; reach *= 4) {
    const from = Math.max(0, index - reach)
    const to = Math.min(text.length, index + reach)
    const segment = WORDS.segment(text.slice(from, to)).containing(index - from)
    if (!segment) return undefined
    const start = from + segment.index
    const end = start + segment.segment.length
    if ((start > from || from === 0) && (end < to || to === text.length)) return { start, end, isWordLike: segment.isWordLike === true }
  }
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
