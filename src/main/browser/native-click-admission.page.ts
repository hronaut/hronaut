/** A sample's verdict: ADMITTED, or why the native click must not go ahead. */
export type NativeClickSample = 'ADMITTED' | 'TARGET_CHANGED' | 'TARGET_DISABLED' | 'POINT_OUTSIDE_VIEWPORT' | 'PAGE_PINCHED' | 'TARGET_OCCLUDED'
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
export function nativeClickTargetInPage(request: { ref?: string; selector?: string; refusePinch?: boolean }): NativeClickTarget {
  const contentType = Object.getOwnPropertyDescriptor(Document.prototype, 'contentType')!.get!
  if (contentType.call(document) !== 'text/html') throw Error('TARGET_UNAVAILABLE')
  const query = Document.prototype.querySelectorAll, queryShadow = DocumentFragment.prototype.querySelectorAll, item = NodeList.prototype.item
  const length = Object.getOwnPropertyDescriptor(NodeList.prototype, 'length')!.get!
  const connected = Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected')!.get!
  const parent = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode')!.get!
  const localName = Object.getOwnPropertyDescriptor(Element.prototype, 'localName')!.get!
  const openShadowRoot = Object.getOwnPropertyDescriptor(Element.prototype, 'shadowRoot')!.get!
  const shadowHost = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'host')!.get!
  const root = Node.prototype.getRootNode
  const hit = Document.prototype.elementFromPoint, hitShadow = ShadowRoot.prototype.elementFromPoint, matches = Element.prototype.matches
  const nodeType = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeType')!.get!
  const elementSlot = Object.getOwnPropertyDescriptor(Element.prototype, 'assignedSlot')!.get!
  const textSlot = Object.getOwnPropertyDescriptor(Text.prototype, 'assignedSlot')!.get!
  // What finding slotted text at a point reads, from the same isolated realm, on the first host that needs it.
  let textAtPoint: {
    childNodes: (this: Node) => NodeList; createRange: (this: Document) => Range; selectNodeContents: (this: Range, node: Node) => void
    rects: (this: Range) => DOMRectList; rectCount: (this: DOMRectList) => number; rectAt: (this: DOMRectList, index: number) => DOMRect | null
    left: Edge; right: Edge; top: Edge; bottom: Edge
    style: (element: Element) => CSSStyleDeclaration; styleValue: (this: CSSStyleDeclaration, name: string) => string
  } | undefined
  type Edge = (this: DOMRectReadOnly) => number
  const edge = (name: 'left' | 'right' | 'top' | 'bottom'): Edge => Object.getOwnPropertyDescriptor(DOMRectReadOnly.prototype, name)!.get!
  const textIntrinsics = () => textAtPoint ??= {
    childNodes: Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes')!.get!,
    createRange: Document.prototype.createRange, selectNodeContents: Range.prototype.selectNodeContents,
    rects: Range.prototype.getClientRects, rectAt: DOMRectList.prototype.item,
    rectCount: Object.getOwnPropertyDescriptor(DOMRectList.prototype, 'length')!.get!,
    left: edge('left'), right: edge('right'), top: edge('top'), bottom: edge('bottom'),
    style: window.getComputedStyle, styleValue: CSSStyleDeclaration.prototype.getPropertyValue
  }
  const selector = request.ref ? '[data-hronaut-ref="' + CSS.escape(request.ref) + '"]' : request.selector as string
  // A selector names one element of the document; a ref can also name a control in an open shadow root.
  const resolve = (): Node | null => {
    const nodes = query.call(document, selector)
    if (!request.ref || length.call(nodes) > 0) return length.call(nodes) === 1 ? item.call(nodes, 0) : null
    const scopes: Array<Document | ShadowRoot> = [document]
    let found: Node | null = null
    for (let index = 0; index < scopes.length && index <= 2000; index++) {
      const scope = scopes[index]!
      const all = scope === document ? query.call(document, '*') : queryShadow.call(scope, '*')
      if (scope !== document) {
        const matching = queryShadow.call(scope, selector)
        if (length.call(matching) > 1 || (length.call(matching) === 1 && found)) return null
        if (length.call(matching) === 1) found = item.call(matching, 0)
      }
      for (let at = 0; at < length.call(all); at++) {
        const shadow = openShadowRoot.call(item.call(all, at) as Element) as ShadowRoot | null
        if (shadow) scopes.push(shadow)
      }
    }
    return found
  }
  // The document, reached from a node through its shadow hosts.
  const composedRoot = (node: Node): Node => {
    let current = root.call(node)
    for (let depth = 0; current instanceof ShadowRoot && depth < 64; depth++) current = root.call(shadowHost.call(current) as Node)
    return current
  }
  // Text a host shows through a slot of its open shadow root is hit on the host itself, since a text node is never an
  // element at a point; the slot showing the text under the point stands in for it (an AppKit button's label). Text
  // that takes no pointer input lets the press through to the host, so its slot stands in only when the text takes it.
  const slotShowingText = (host: Element, x: number, y: number): Element | null => {
    const read = textIntrinsics()
    const nodes = read.childNodes.call(host)
    for (let index = 0; index < length.call(nodes) && index < 500; index++) {
      const node = item.call(nodes, index) as Node
      const slot = nodeType.call(node) === Node.TEXT_NODE ? textSlot.call(node as Text) as Element | null : null
      if (!slot) continue
      const range = read.createRange.call(doc)
      read.selectNodeContents.call(range, node)
      const rects = read.rects.call(range)
      for (let at = 0; at < read.rectCount.call(rects) && at < 500; at++) {
        const rect = read.rectAt.call(rects, at)!
        if (x < read.left.call(rect) || x >= read.right.call(rect) || y < read.top.call(rect) || y >= read.bottom.call(rect)) continue
        const style = read.style.call(window, slot)
        return read.styleValue.call(style, 'pointer-events') !== 'none' && read.styleValue.call(style, 'visibility') === 'visible' ? slot : null
      }
    }
    return null
  }
  // The innermost element at the point, through open shadow roots.
  const deepHit = (x: number, y: number): Element | null => {
    let current = hit.call(doc, x, y)
    for (let depth = 0; current && depth < 64; depth++) {
      const shadow = openShadowRoot.call(current) as ShadowRoot | null
      const inner = shadow ? hitShadow.call(shadow, x, y) : null
      if (inner && inner !== current) { current = inner; continue }
      if (shadow) current = slotShowingText(current, x, y) ?? current
      break
    }
    return current
  }
  // Whether the target holds the node on the path a press there takes: up through the slot a node is shown in, a
  // shadow root's host, or the parent.
  const holds = (target: Node, node: Node): boolean => {
    let current: Node | null = node
    for (let depth = 0; current && depth < 10_000; depth++) {
      if (current === target) return true
      const slot: Node | null = current instanceof Element ? elementSlot.call(current) as Node | null
        : nodeType.call(current) === Node.TEXT_NODE ? textSlot.call(current as Text) as Node | null : null
      const up: Node | null = slot ?? parent.call(current) as Node | null
      current = up instanceof ShadowRoot ? shadowHost.call(up) as Node : up
    }
    return false
  }
  const original = resolve(), doc = document
  if (!original || composedRoot(original) !== doc) throw Error('TARGET_UNAVAILABLE')
  return {
    receiver: null,
    sample(x, y, final) {
      if (document !== doc || !connected.call(original) || composedRoot(original) !== doc || resolve() !== original) return 'TARGET_CHANGED'
      if (matches.call(original as Element, ':disabled')) return 'TARGET_DISABLED'
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'POINT_OUTSIDE_VIEWPORT'
      // On a page pinched larger since the point was measured, the input would land somewhere else; a phone viewport
      // the agent emulates sets its own scale (see refusesPinchedPage).
      const viewport = request.refusePinch === true ? window.visualViewport : null
      const shown = document.compatMode === 'BackCompat' ? document.body : document.documentElement
      if (viewport && (Math.abs(viewport.offsetLeft) > 0.01 || Math.abs(viewport.offsetTop) > 0.01
        || (shown && shown.clientWidth - viewport.width > 1))) return 'PAGE_PINCHED'
      const current = deepHit(x, y)
      if (!current || composedRoot(current) !== doc || !holds(original, current)) return 'TARGET_OCCLUDED'
      let ancestor: Node | null = current, depth = 0
      while (ancestor !== doc) {
        if (!ancestor || ++depth > 64) return 'TARGET_UNVERIFIABLE'
        if (ancestor instanceof Element && ['iframe','frame','object','embed'].includes((localName.call(ancestor) as string).toLowerCase())) return 'EMBEDDED_HIT_UNSUPPORTED'
        ancestor = ancestor instanceof ShadowRoot ? shadowHost.call(ancestor) as Node : parent.call(ancestor) as Node | null
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
