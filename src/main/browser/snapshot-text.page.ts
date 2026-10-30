/** How a capture reads text: form fields as editors too, `textContent` where `innerText` is empty, whitespace collapsed. */
export interface SnapshotTextOptions {
  excludeFormControls?: boolean
  textContentFallback?: boolean
  collapseWhitespace?: boolean
}

/** One capture's text collection, sharing one visit budget and the notes of what it left out. */
export interface SnapshotText {
  editingContext: (element: Element | null | undefined) => boolean
  safeText: (element: Element | null | undefined, depth?: number, filtered?: boolean) => string
  reset: () => void
  excluded: () => boolean
  limited: () => boolean
}

/**
 * Runs in the page: browser-side text collection for one capture, at most `maxChars` characters per filtered subtree.
 * Editor content is left out and noted as excluded, and a walk past its bounds is noted as limited. Never clear or
 * clone editors into the live page.
 */
export function snapshotTextInPage(options: SnapshotTextOptions, maxChars: number): SnapshotText {
  const editorSelector = '[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]' + (options.excludeFormControls ? ',input,textarea,select' : '')
  const editingContext = (element: Element | null | undefined): boolean => Boolean(element && ((element as HTMLElement).isContentEditable || element.closest(editorSelector)))
  let editorCache = new WeakMap<Element, boolean>()
  let excluded = false
  let limited = false
  let visits = 10000
  const reset = (): void => {
    editorCache = new WeakMap()
    excluded = false
    limited = false
    visits = 10000
  }
  const renderedText = (element: Element): string => (element as HTMLElement).innerText || (options.textContentFallback ? element.textContent || '' : '')
  const safeText = (element: Element | null | undefined, depth = 0, filtered = false): string => {
    if (!element) return ''
    if (editingContext(element)) { excluded = true; return '' }
    if (--visits < 0 || depth > 100) { limited = true; return '' }
    let hasEditor = editorCache.get(element)
    if (hasEditor === undefined) {
      hasEditor = Boolean(element.querySelector(editorSelector))
      editorCache.set(element, hasEditor)
    }
    if (hasEditor) excluded = true
    // Preserve Chromium's existing rendered-text behavior for ordinary subtrees.
    if (!hasEditor && !filtered) return renderedText(element)
    const style = getComputedStyle(element)
    if (style.display === 'none') return ''
    const visibleText = style.visibility !== 'hidden' && style.visibility !== 'collapse'
    if (!hasEditor && visibleText && style.display !== 'contents') return renderedText(element)
    const parts: string[] = []
    let length = 0
    for (const child of element.childNodes) {
      if (--visits < 0) { limited = true; break }
      let text = ''
      if (child.nodeType === 3 && visibleText) text = child.textContent || ''
      else if (child.nodeType === 1) {
        const childElement = child as Element
        const childStyle = getComputedStyle(childElement)
        if (childStyle.display === 'none') continue
        text = editingContext(childElement) ? ' ' : safeText(childElement, depth + 1, true)
        if (childElement.localName === 'br' || /^(block|flow-root|flex|grid|list-item|table)/.test(childStyle.display)) text = ' ' + text + ' '
      }
      if (options.collapseWhitespace) text = text.replace(/\s+/g, ' ')
      const remaining = maxChars + 1 - length
      parts.push(text.slice(0, remaining))
      length += Math.min(text.length, remaining)
      if (text.length > remaining) { limited = true; break }
    }
    return parts.join('')
  }
  return { editingContext, safeText, reset, excluded: () => excluded, limited: () => limited }
}
