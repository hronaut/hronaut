// Runs only inside element inspection's isolated world. No page-authored
// accessors, DOM enumeration, or normalized scrollability inference.
export function elementScrollGeometrySource(): string {
  return `(() => {
    try {
      const read = key => Object.getOwnPropertyDescriptor(Element.prototype, key).get.call(element);
      const docRead = key => Object.getOwnPropertyDescriptor(Document.prototype, key).get.call(document);
      const scroller = docRead('scrollingElement');
      const style = getComputedStyle(element);
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
      };
    } catch { return { status: 'unavailable', reason: 'unsupported-cssom' }; }
  })()`
}
