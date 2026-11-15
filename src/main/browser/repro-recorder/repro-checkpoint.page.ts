import type { BrowserReproElementCheckpointInput } from '../../../shared/repro-checkpoint.js'
import type { RenderedVisibility } from '../rendered-visibility.page.js'

/** What the page found for a checkpoint: its target and whether the condition held, or why it could not tell. */
export type ReproCheckpointPageResult = { selector: string; tag: string; observedMatch: boolean } | { error: string }

/**
 * Runs in the page: checks a reviewed Repro checkpoint. A count counts the elements the selector names, walking at most
 * maxNodes elements and refusing more than maxCount matches or any editor or frame; validCount says main found the
 * selector and count valid. Any other condition needs exactly one element, which no unique path of up to 500 characters
 * may fail to name, and is not, or does not hold, a form field or editor, except a checkbox or radio for checked and
 * unchecked. Text is compared as Playwright normalizes it, from at most 2000 nodes and 64000 characters, leaving out
 * scripts and styles and refusing a shadow root.
 */
export function reproCheckpointInPage(
  request: BrowserReproElementCheckpointInput,
  validCount: boolean,
  maxNodes: number,
  maxCount: number,
  createRenderedVisibility: () => RenderedVisibility
): ReproCheckpointPageResult {
  if (request.condition === 'count') {
    if (!validCount) return { error: 'invalid-selector' }
    let actual = 0
    let visited = 0
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT)
    let element: Element | null
    while ((element = walker.nextNode() as Element | null)) {
      if (++visited > maxNodes) return { error: 'count-node-limit' }
      if (!element.matches(request.selector)) continue
      if (element.matches('iframe,frame,input,textarea,select,[contenteditable]') || (element as HTMLElement).isContentEditable
        || element.closest('[contenteditable]')) return { error: 'excluded-target' }
      if (++actual > maxCount) return { error: 'count-match-limit' }
    }
    return { selector: request.selector, tag: request.selector.split(' > ').at(-1)!.split(':')[0]!, observedMatch: actual === request.count }
  }
  let matches: NodeListOf<Element>
  try { matches = document.querySelectorAll(request.selector) }
  catch { return { error: 'invalid-selector' } }
  if (matches.length !== 1) return { error: 'ambiguous-target' }
  const element = matches[0]! as HTMLElement
  const checkedCondition = request.condition === 'checked' || request.condition === 'unchecked'
  if (checkedCondition && (!(element instanceof HTMLInputElement)
    || !['checkbox', 'radio'].includes(element.type) || element.indeterminate
    || element.closest('[contenteditable]'))) return { error: 'unsupported-checked-target' }
  if (!checkedCondition && (element.matches('iframe,frame,input,textarea,select,[contenteditable]') || element.isContentEditable
    || element.querySelector('input,textarea,select,[contenteditable]'))) {
    return { error: 'excluded-target' }
  }
  const parts: string[] = []
  let node: Element | null = element
  let selector = ''
  while (node instanceof Element) {
    const parent: Element | null = node.parentElement
    let part = node.localName
    if (parent) {
      const localName = node.localName
      const siblings = [...parent.children].filter(candidate => candidate.localName === localName)
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
    }
    parts.unshift(part)
    const candidate = parts.join(' > ')
    if (candidate.length > 500) break
    const selected = document.querySelectorAll(candidate)
    if (selected.length === 1 && selected[0] === element) { selector = candidate; break }
    node = parent
  }
  if (!selector) return { error: 'unsupported-target' }
  const renderedVisibility = createRenderedVisibility()
  let visible = false
  if (request.condition === 'visible' || request.condition === 'hidden') {
    try { visible = renderedVisibility.visible(element) }
    catch (error) { if (error === renderedVisibility.limit) return { error: 'visibility-limit' }; throw error }
  }
  const normalized = (value: unknown): string => String(value).replace(/[\u200b\u00ad]/g, '').replace(/\s+/g, ' ').trim()
  let observedText = ''
  if (request.condition === 'text' && !element.matches('script,style') && !element.closest('head')) {
    // Match exported Playwright text assertions without collecting executable/style text.
    // Playwright includes open-shadow text even for a css:light target.
    // Reject that boundary rather than inspect content outside the recorder's scope.
    if (element.shadowRoot) return { error: 'shadow-text-target' }
    const textLimit = {}
    const shadowTextTarget = {}
    let visited = 0
    try {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          if (++visited > 2000) throw textLimit
          if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT
          if (node.matches('script,style')) return NodeFilter.FILTER_REJECT
          if (node.shadowRoot) throw shadowTextTarget
          return NodeFilter.FILTER_ACCEPT
        }
      })
      let current: Node | null
      while ((current = walker.nextNode())) {
        if (current.nodeType !== Node.TEXT_NODE) continue
        const text = current.nodeValue || ''
        if (observedText.length + text.length > 64000) throw textLimit
        observedText += text
      }
    } catch (error) {
      if (error === textLimit) return { error: 'text-limit' }
      if (error === shadowTextTarget) return { error: 'shadow-text-target' }
      throw error
    }
  }
  const observedMatch = checkedCondition ? (element as HTMLInputElement).checked === (request.condition === 'checked')
    : request.condition === 'visible' ? visible
    : request.condition === 'hidden' ? !visible
    : normalized(observedText) === normalized(request.text)
  return { selector, tag: element.localName, observedMatch }
}
