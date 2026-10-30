/** A sample's verdict: ADMITTED, or why the native click must not go ahead. */
export type NativeClickSample = 'ADMITTED' | 'TARGET_CHANGED' | 'TARGET_DISABLED' | 'POINT_OUTSIDE_VIEWPORT' | 'TARGET_OCCLUDED'
  | 'TARGET_UNVERIFIABLE' | 'EMBEDDED_HIT_UNSUPPORTED' | 'HIT_CHANGED'

/** The operation-local admission object the debugger keeps a handle to; it retains the original node. */
export interface NativeClickTarget {
  receiver: Element | null
  sample(x: number, y: number, final: boolean): NativeClickSample
}

/**
 * Runs in the native click admission's isolated world: an operation-local object that retains the one element the ref
 * or selector names, read through the isolated realm's own intrinsics. No page-global target registry, page-owned
 * method call, or exported node identity. Each sample checks that the target is unchanged, enabled and hit at the point,
 * not through an embedded document; the first sample records the element hit, and the final one must hit it again.
 */
export function nativeClickTargetInPage(request: { ref?: string; selector?: string }): NativeClickTarget {
  const contentType = Object.getOwnPropertyDescriptor(Document.prototype, 'contentType')!.get!
  if (contentType.call(document) !== 'text/html') throw Error('TARGET_UNAVAILABLE')
  const query = Document.prototype.querySelectorAll, item = NodeList.prototype.item
  const connected = Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected')!.get!
  const parent = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode')!.get!
  const localName = Object.getOwnPropertyDescriptor(Element.prototype, 'localName')!.get!
  const root = Node.prototype.getRootNode, contains = Node.prototype.contains
  const hit = Document.prototype.elementFromPoint, matches = Element.prototype.matches
  const selector = request.ref ? '[data-hronaut-ref="' + CSS.escape(request.ref) + '"]' : request.selector as string
  const resolve = (): Node | null => { const nodes = query.call(document, selector); return nodes.length === 1 ? item.call(nodes, 0) : null }
  const original = resolve(), doc = document
  if (!original || root.call(original) !== doc) throw Error('TARGET_UNAVAILABLE')
  return {
    receiver: null,
    sample(x, y, final) {
      if (document !== doc || !connected.call(original) || root.call(original) !== doc || resolve() !== original) return 'TARGET_CHANGED'
      if (matches.call(original as Element, ':disabled')) return 'TARGET_DISABLED'
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'POINT_OUTSIDE_VIEWPORT'
      const current = hit.call(doc, x, y)
      if (!current || root.call(current) !== doc || !contains.call(original, current)) return 'TARGET_OCCLUDED'
      let ancestor: Node | null = current, depth = 0
      while (ancestor !== doc) {
        if (!ancestor || ++depth > 64) return 'TARGET_UNVERIFIABLE'
        if (ancestor instanceof Element && ['iframe','frame','object','embed'].includes((localName.call(ancestor) as string).toLowerCase())) return 'EMBEDDED_HIT_UNSUPPORTED'
        ancestor = parent.call(ancestor) as Node | null
      }
      if (final && current !== this.receiver) return 'HIT_CHANGED'
      if (!final) this.receiver = current
      return 'ADMITTED'
    }
  }
}

/** Runs on the admission object through the debugger: samples the point. */
export function nativeClickSampleInPage(this: NativeClickTarget, x: number, y: number, final: boolean): NativeClickSample {
  return this.sample(x, y, final)
}

/** Runs on the admission object through the debugger: the element the first sample hit. */
export function nativeClickReceiverInPage(this: NativeClickTarget): Element | null {
  return this.receiver
}
