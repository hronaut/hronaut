import type { BrowserReproTarget } from '../../../shared/types.js'
import type { SnapshotText, SnapshotTextOptions } from '../snapshot-text.page.js'

/** Where a click landed in the tab's view, with the view's size, so the page can scale it to its own viewport. */
export interface ReproPoint {
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
}

type CreateSnapshotText = (options: SnapshotTextOptions, maxChars: number) => SnapshotText

/**
 * Runs in the page: describes the element a recorded click hit, or without a point the focused element, inside open
 * shadow roots too. Its selector is the shortest unique top-level light-DOM path of up to 500 characters, or empty when
 * there is none or the target is a frame. Its label comes from its own attributes, its form labels or, for an element
 * that is no form field, its shown text. Null for no element, the root or the body.
 */
export function reproTargetInPage(point: ReproPoint | undefined, createSnapshotText: CreateSnapshotText): BrowserReproTarget | null {
  const snapshotText = createSnapshotText({ excludeFormControls: true, textContentFallback: true, collapseWhitespace: true }, 180)
  const compact = (value: unknown, limit: number): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const x = point ? Number(point.x) * innerWidth / Math.max(1, Number(point.viewportWidth)) : 0
  const y = point ? Number(point.y) * innerHeight / Math.max(1, Number(point.viewportHeight)) : 0
  let element = point ? document.elementFromPoint(x, y) : document.activeElement
  // Document hit testing/focus retargets shadow descendants to their host.
  // Find the actual open-shadow target so it cannot receive the host's selector.
  const visited = new Set<Element>()
  while (element instanceof Element && element.shadowRoot && !visited.has(element)) {
    visited.add(element)
    const nested = point
      ? element.shadowRoot.elementFromPoint(x, y)
      : element.shadowRoot.activeElement
    if (!(nested instanceof Element) || nested === element) break
    element = nested
  }
  if (!(element instanceof Element) || element === document.documentElement || element === document.body) return null
  const selectorFor = (target: Element): string => {
    const parts: string[] = []
    let node: Element | null = target
    while (node instanceof Element && node !== document.documentElement) {
      let part = node.localName || 'element'
      const parent: Element | null = node.parentElement
      if (parent) {
        const localName = node.localName
        const siblings = [...parent.children].filter((candidate) => candidate.localName === localName)
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      const selector = parts.join(' > ')
      if (selector.length > 500) return ''
      try {
        const matches = document.querySelectorAll(selector)
        if (matches.length === 1 && matches[0] === target) return selector
      } catch { return '' }
      node = parent
    }
    return ''
  }
  const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
  const field = element as HTMLInputElement
  const associatedLabel = input && 'labels' in element && field.labels?.length
    ? [...field.labels].map((label) => snapshotText.safeText(label)).join(' ')
    : ''
  const label = compact(
    element.getAttribute('aria-label')
      || associatedLabel
      || element.getAttribute('title')
      || element.getAttribute('alt')
      || element.getAttribute('placeholder')
      || (input ? '' : snapshotText.safeText(element)),
    180
  )
  return {
    selector: element.localName === 'iframe' || element.localName === 'frame' ? '' : selectorFor(element),
    tag: (element.localName || element.tagName.toLowerCase()).slice(0, 64),
    role: compact(element.getAttribute('role') || '', 64) || undefined,
    label: label || undefined,
    inputType: element instanceof HTMLInputElement ? compact(element.type || 'text', 40) : undefined
  }
}

/** Runs in the page: its scroll position, rounded to whole pixels. */
export function reproScrollInPage(): { x: number; y: number } {
  return { x: Math.round(scrollX), y: Math.round(scrollY) }
}
