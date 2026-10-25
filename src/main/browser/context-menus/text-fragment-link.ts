import { isWebUrl } from '../url.js'

/** Chrome quotes a selection whole up to this length, and longer text by its first and last words. */
const EXACT_TEXT_MAX_LENGTH = 300
/** The words that mark where a longer selection starts and where it ends. */
const RANGE_WORDS = 5
/** How long the words that mark an end may grow; a single longer word, such as an address, still marks it. */
const RANGE_TERM_MAX_LENGTH = 100
/** The longest address Chromium opens. */
const URL_MAX_LENGTH = 2 * 1024 * 1024

/**
 * The link Copy link to highlight copies, as in Chrome: the page's address with a text fragment, which scrolls to the
 * selected text and highlights it when the link is opened (https://wicg.github.io/scroll-to-text-fragment/). A short
 * selection within one paragraph is quoted whole, and a longer one, or one across paragraphs, by its first and last
 * words. The page's own fragment stays, and a text fragment it already had gives way to the new one. Chrome also checks
 * in the page that the text is found only once and adds the words around it if not; the menu sees only the selected
 * text, so a link to text that the page holds more than once highlights its first match. Undefined for an address that
 * is not a web page's, for a selection of only spaces, and for a link too long to open.
 */
export function textFragmentLink(pageUrl: string, selectionText: string): string | undefined {
  if (!isWebUrl(pageUrl)) return undefined
  // The menu gives each paragraph of the selection on its own line, with its spaces already collapsed. Half of a
  // character that lost its other half, which a page can select, reads as U+FFFD, as Chrome reads it.
  const paragraphs = selectionText.replace(/\p{Cs}/gu, '\uFFFD').split('\n').map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim()).filter(Boolean)
  const first = paragraphs[0]
  const last = paragraphs.at(-1)
  if (!first || !last) return undefined
  const url = new URL(pageUrl)
  const fragment = url.hash.slice(1)
  const directiveAt = fragment.indexOf(':~:')
  const pageFragment = directiveAt < 0 ? fragment : fragment.slice(0, directiveAt)
  url.hash = ''
  const link = `${url.href}#${pageFragment}:~:text=${textDirective(paragraphs.length === 1 ? first : undefined, first, last)}`
  return link.length <= URL_MAX_LENGTH ? link : undefined
}

// A text directive matches within one paragraph, so a selection across paragraphs is always marked by its ends.
function textDirective(whole: string | undefined, first: string, last: string): string {
  if (whole !== undefined && whole.length <= EXACT_TEXT_MAX_LENGTH) return directiveTerm(whole)
  // Text too short in words to mark by its ends without the two overlapping is quoted whole.
  if (whole !== undefined && whole.split(' ').length < RANGE_WORDS * 2) return directiveTerm(whole)
  const start = boundedWords(first.split(' ')).join(' ')
  const end = boundedWords(last.split(' ').reverse()).reverse().join(' ')
  return `${directiveTerm(start)},${directiveTerm(end)}`
}

// The first few words, while they stay short. A match starts and ends at whole words, so a word is never cut.
function boundedWords(words: readonly string[]): string[] {
  const term = words.slice(0, 1)
  let length = term[0]?.length ?? 0
  for (const word of words.slice(1, RANGE_WORDS)) {
    length += 1 + word.length
    if (length > RANGE_TERM_MAX_LENGTH) break
    term.push(word)
  }
  return term
}

// A term is escaped as an address part, and its dashes too, since a dash marks the text around a match.
function directiveTerm(text: string): string {
  return encodeURIComponent(text).replaceAll('-', '%2D')
}
