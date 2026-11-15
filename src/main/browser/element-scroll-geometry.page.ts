/** The element's scroll geometry as the page reads it, or why it could not. */
export type ElementScrollGeometryPage = {
  status: 'observed'
  scrollTop: number
  scrollLeft: number
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  direction: string
  writingMode: string
  isDocumentScroller: boolean
  documentScroller: 'html' | 'body' | null
} | { status: 'unavailable'; reason: 'unsupported-cssom' }

/**
 * Runs only inside element inspection's isolated world: the element's scroll position and sizes, read through the
 * native accessors. No page-authored accessors, DOM enumeration, or normalized scrollability inference.
 */
export function elementScrollGeometryInPage(element: Element): ElementScrollGeometryPage {
  try {
    const read = (key: string): number => Object.getOwnPropertyDescriptor(Element.prototype, key)!.get!.call(element) as number
    const docRead = (key: string): unknown => Object.getOwnPropertyDescriptor(Document.prototype, key)!.get!.call(document)
    const scroller = docRead('scrollingElement')
    const style = getComputedStyle(element)
    return {
      status: 'observed',
      scrollTop: read('scrollTop'), scrollLeft: read('scrollLeft'),
      clientWidth: read('clientWidth'), clientHeight: read('clientHeight'),
      scrollWidth: read('scrollWidth'), scrollHeight: read('scrollHeight'),
      direction: style.direction, writingMode: style.writingMode,
      isDocumentScroller: element === scroller,
      documentScroller: scroller === null ? null
        : scroller === docRead('documentElement') ? 'html'
          : scroller === docRead('body') ? 'body' : null
    }
  } catch { return { status: 'unavailable', reason: 'unsupported-cssom' } }
}
