/** How an element shows its text: its display, how it collapses white space, and whether it is shown at all. */
interface ShownStyle { display: string; collapse: string; shown: boolean }

/**
 * Runs in the link-to-highlight world: reads the main frame's text as runs, with the selection's start and end marked
 * by two noncharacters, U+FDD0 and U+FDD1, which no page text holds. Null when there is no single non-collapsed
 * selection, when the selection does not start before it ends, or when the page has more than nodesMax nodes or
 * textMaxLength characters of text, or is still being read at the deadline (epoch milliseconds).
 */
export function highlightPageTextInPage(deadline: number, nodesMax: number, textMaxLength: number): { runs: string[] } | null {
  // Made from their codes, as the bundler would print the characters themselves into the script.
  const start = String.fromCharCode(0xfdd0), end = String.fromCharCode(0xfdd1)
  const selection = getSelection()
  if (!document.body || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const styles = new Map<Element, ShownStyle>(), blocks = new Map<Element, Element>()
  const style = (element: Element): ShownStyle => {
    let known = styles.get(element)
    if (!known) {
      const computed = getComputedStyle(element)
      // An element with no box of its own is shown as its parent is.
      const shown = computed.display === 'contents'
        ? computed.visibility === 'visible' && (!element.parentElement || style(element.parentElement).shown)
        : element.checkVisibility({ visibilityProperty: true })
      known = { display: computed.display, collapse: computed.whiteSpaceCollapse, shown }
      styles.set(element, known)
    }
    return known
  }
  // Text runs on across inline elements, and a block, an inline block or a table cell starts a run of its own.
  const blockOf = (element: Element): Element => {
    let block = blocks.get(element)
    if (!block) {
      const display = style(element).display
      block = element === document.body || !element.parentElement || !['inline', 'contents', 'ruby'].includes(display) ? element : blockOf(element.parentElement)
      blocks.set(element, block)
    }
    return block
  }
  // Chromium finds no text across an image, a control, an embedded page, a script or text drawn by CSS, nor across
  // text it lays out hidden, so each of these ends the run, and its own text is left out.
  const atomic = new Set(['img', 'svg', 'math', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed', 'input', 'textarea', 'select', 'button', 'meter', 'progress', 'script', 'style', 'noscript', 'template'])
  const drawn = (element: Element, pseudo: string): boolean => !['none', 'normal', '""'].includes(getComputedStyle(element, pseudo).content)
  const runs: string[] = [], closingRuns: Element[] = []
  let run = '', runBlock: Element | null = null, skipped: Node | null = null, nodes = 0, length = 0, started = false, ended = false
  const endRun = (): void => {
    run = run.replace(/ +$/, '')
    if (run) runs.push(run)
    run = ''
  }
  const markEnd = (): void => {
    if (run || !runs.length) run += end
    else runs[runs.length - 1] += end
    ended = true
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++nodes > nodesMax || Date.now() > deadline) return null
    if (!ended && node !== range.startContainer && range.comparePoint(node, 0) === 1) {
      if (!started) return null
      markEnd()
    }
    while (closingRuns.length && !closingRuns.at(-1)!.contains(node)) {
      closingRuns.pop()
      endRun()
    }
    if (skipped && skipped.contains(node)) continue
    skipped = null
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.localName === 'br') endRun()
      else if (atomic.has(element.localName) || element.inert || (!style(element).shown && element.checkVisibility())) {
        endRun()
        skipped = element
      } else if (['inline', 'contents', 'ruby'].includes(style(element).display)) {
        if (drawn(element, '::before')) endRun()
        if (drawn(element, '::after')) closingRuns.push(element)
      }
      continue
    }
    const parent = node.parentElement
    // Chromium also finds text in a closed details element or hidden until found, and opens it, so that text is kept
    // where it is, as the link could find the selected text there.
    if (!parent || (!style(parent).shown && !parent.closest('details:not([open]), [hidden="until-found"]'))) continue
    const block = blockOf(parent)
    if (block !== runBlock) {
      endRun()
      runBlock = block
    }
    let text = (node as Text).data
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
    if (collapse === 'collapse') text = text.replace(/[ \t\n\r\f]+/g, ' ')
    else if (collapse === 'preserve-breaks') text = text.replace(/[ \t\f]+/g, ' ')
    // A line the page keeps ends the run, as a line break does.
    const lines = collapse === 'collapse' ? [text] : text.split(/\r\n|[\n\r]/)
    lines.forEach((line, index) => {
      if (index) endRun()
      if ((collapse === 'collapse' || collapse === 'preserve-breaks') && line.startsWith(' ') && (!run || run.endsWith(' '))) line = line.slice(1)
      run += line
    })
    length += text.length
    if (length > textMaxLength) return null
  }
  if (!started) return null
  if (!ended) markEnd()
  endRun()
  return { runs }
}
