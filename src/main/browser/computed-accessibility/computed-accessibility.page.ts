/** A node as the text count reads it: any of an element's, a text node's and a form field's members may be there. */
type TextBoundNode = Element & CharacterData & {
  value?: unknown
  labels?: NodeListOf<HTMLLabelElement> | null
  ariaLabelledByElements?: readonly Element[] | null
  ariaDescribedByElements?: readonly Element[] | null
  ariaOwnsElements?: readonly Element[] | null
  popoverTargetElement?: Element | null
  interestForElement?: Element | null
}

/**
 * Runs in an isolated world, called on the element through the debugger: counts the text Chromium may draw on for the
 * element's name, description and value: its subtree with open shadow trees, text and CDATA, attributes other than
 * class and style, form values, generated content, its labels, and for every element it visits the elements named by
 * aria-labelledby, aria-describedby and aria-owns (as attributes or as element references) and by popover and interest
 * targets. Closed shadow trees and a custom element's internals are out of reach here; the answer is checked against
 * this count afterwards for that reason. It stops counting once either limit is passed.
 */
export function textBoundInPage(this: TextBoundNode, maxChars: number, maxElements: number): { chars: number; elements: number } {
  let chars = 0, elements = 0
  const seen = new Set<Node>([this]), stack: TextBoundNode[] = [this]
  const add = (node: Node | null | undefined): void => { if (node && !seen.has(node)) { seen.add(node); stack.push(node as TextBoundNode) } }
  for (const label of this.labels || []) add(label)
  while (stack.length && chars <= maxChars && elements <= maxElements) {
    const node = stack.pop()!
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) { chars += node.data.length; continue }
    if (node.nodeType === Node.ELEMENT_NODE) {
      elements++
      for (const attribute of node.attributes) if (attribute.name !== 'class' && attribute.name !== 'style') chars += attribute.value.length
      if (typeof node.value === 'string') chars += node.value.length
      for (const pseudo of ['::before', '::after', '::marker']) {
        const content = getComputedStyle(node, pseudo).content
        if (content && content !== 'none' && content !== 'normal') chars += content.length
      }
      if (node.shadowRoot) add(node.shadowRoot)
      const root = node.getRootNode() as Node & { getElementById?: (id: string) => Element | null }
      for (const name of ['aria-labelledby', 'aria-describedby', 'aria-owns']) {
        for (const id of (node.getAttribute(name) || '').split(/\s+/)) if (id && root.getElementById) add(root.getElementById(id))
      }
      for (const property of ['ariaLabelledByElements', 'ariaDescribedByElements', 'ariaOwnsElements'] as const) for (const element of node[property] || []) add(element)
      add(node.popoverTargetElement)
      add(node.interestForElement)
    } else if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) continue
    for (const child of node.childNodes) add(child)
  }
  return { chars, elements }
}
