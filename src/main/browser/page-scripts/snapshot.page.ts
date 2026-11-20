import type { RenderedVisibility } from '../rendered-visibility.page.js'
import type { SnapshotText, SnapshotTextOptions } from '../snapshot-text.page.js'

/** What one snapshot captures, as the page gets it. */
export interface SnapshotPageConfig {
  maxChars: number
  /** The one element a component capture is scoped to, or null for the whole page. */
  rootSelector: string | null
  /** The person's setting: the URL line shows the page's origin and path only, followed by `urlDetailNote`. */
  omitUrlDetail: boolean
  urlDetailNote: string
  /** Bounds numbering for one long-lived document. */
  refLimit: number
  formatVersion: number
}

type SnapshotScopeError = 'invalid-selector' | 'ambiguous-root' | 'missing-root' | 'unsupported-root' | 'hidden-root' | 'visibility-limit' | 'detached-root'

/** The capture as the page reports it, or why a component capture has none; main adds the capture's identity and context. */
export type SnapshotPageResult = { scopeError: SnapshotScopeError } | {
  scope?: { kind: 'component'; rootTag: string; outsideScopeOmitted: true }
  formatVersion: number
  text: string
  maxChars: number
  returnedChars: number
  truncated: boolean
  omitted: { headings: boolean; controls: boolean; bodyText: boolean; characters: boolean }
  targetNames: [string, string][]
}

type SnapshotPage = typeof globalThis & { __hronautSnapshotIdentity?: { next: number; refs: WeakMap<Element, string> } }

/**
 * Runs in the snapshot's isolated world: the page's URL, title, visible headings and controls, each control with a ref
 * the agent can act on, and the rendered text, within `maxChars`. Editor content and form field values are never read.
 * Controls inside open shadow roots get refs too, named by the text they show. With a root selector, only that one
 * visible light-DOM component is captured.
 */
export function snapshotInPage(
  config: SnapshotPageConfig,
  createSnapshotText: (options: SnapshotTextOptions, maxChars: number) => SnapshotText,
  createRenderedVisibility: () => RenderedVisibility,
  urlWithoutDetail: (value: string) => string
): SnapshotPageResult {
  const { maxChars, rootSelector } = config
  const snapshotText = createSnapshotText({}, maxChars)
  let root: Document | Element = document
  if (rootSelector !== null) {
    let matches
    try { matches = document.querySelectorAll(rootSelector) }
    catch { return { scopeError: 'invalid-selector' } }
    if (matches.length !== 1) return { scopeError: matches.length ? 'ambiguous-root' : 'missing-root' }
    root = matches[0]!
    if (root.matches('iframe,frame,input,textarea,select,[contenteditable]') || snapshotText.editingContext(root)) return { scopeError: 'unsupported-root' }
  }
  const select = (selector: string): Element[] => root === document ? [...document.querySelectorAll(selector)]
    : [...((root as Element).matches(selector) ? [root as Element] : []), ...root.querySelectorAll(selector)]
  const interactive = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]'
  const safeUrl = (value: string): string => {
    try {
      const url = new URL(value, location.href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol + '//'
      url.username = ''
      url.password = ''
      url.hash = ''
      url.pathname = url.pathname.replace(/;(jsessionid)=[^;/]*/gi, ';$1=[REDACTED]')
      for (const key of [...url.searchParams.keys()]) {
        if (/(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passwrd|passcode|passphrase|pwd|secret|session|token)/i.test(key)
          || /^(?:sig|signature|jwt|q-signature|x-[a-z0-9]+-signature|hdnt[sla]|tempauth|hm|hmac|md5|oh|key|access[-_]?key|subscription[-_]?key|auth|authkey|rlkey|resourcekey|sid|phpsessid)$/i.test(key)
          || /(?:^|[[_-])(?:pass|pw)\d?(?:[\][]|$)/i.test(key)) {
          url.searchParams.set(key, '[REDACTED]')
        }
      }
      return url.href
    } catch {
      return ''
    }
  }
  const visible = (element: Element): boolean => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
  }
  if (root !== document) {
    const renderedVisibility = createRenderedVisibility()
    // Boxless component roots can have visible descendants. Keep explicit
    // hidden roots excluded and reject an incomplete bounded observation.
    if (getComputedStyle(root as Element).visibility !== 'visible') return { scopeError: 'hidden-root' }
    try { if (!renderedVisibility.visible(root)) return { scopeError: 'hidden-root' } }
    catch (error) { if (error === renderedVisibility.limit) return { scopeError: 'visibility-limit' }; throw error }
  }
  // One comparison identity per observed element for this document. Surviving
  // controls keep their ref across captures, so inserting or removing an
  // earlier control does not renumber later ones. The weak map lives in the
  // isolated snapshot world, outside page JavaScript; the DOM attribute is
  // only the published handle and is never read back as identity.
  const page = globalThis as SnapshotPage
  const identity = page.__hronautSnapshotIdentity
    || (page.__hronautSnapshotIdentity = { next: 0, refs: new WeakMap() })
  if (identity.next > config.refLimit - 500) { identity.next = 0; identity.refs = new WeakMap() }
  // Open shadow roots, outermost first, at most 2,000; a ref is cleared in each and controls are read in the first 200.
  const shadowRoots: ShadowRoot[] = []
  for (let index = -1; index < shadowRoots.length && shadowRoots.length < 2000; index++) {
    const scope: Document | ShadowRoot = index < 0 ? document : shadowRoots[index]!
    for (const element of scope.querySelectorAll('*')) if (element.shadowRoot && shadowRoots.length < 2000) shadowRoots.push(element.shadowRoot)
  }
  for (const scope of [document, ...shadowRoots]) {
    for (const element of scope.querySelectorAll('[data-hronaut-ref]')) element.removeAttribute('data-hronaut-ref')
  }
  const lines: string[] = []
  // The name of each control the agent was shown, for the shell's plain-words steps such as Clicking "Review order".
  // A form field is named only by its label, never by its value, its text or its options.
  const targetNames: [string, string][] = []
  // Label text is read node by node, at most 200 nodes per label and 5,000 per capture.
  let stepLabelVisits = 5000
  const stepLabelText = (node: Element): string => {
    let text = ''
    let visits = 200
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    while (text.length < 240 && --visits > 0 && --stepLabelVisits > 0 && walker.nextNode()) {
      if (walker.currentNode.nodeType !== Node.TEXT_NODE) continue
      const parent = walker.currentNode.parentElement
      if (!parent || parent.closest('input,textarea,select,option,script,style,[contenteditable]')) continue
      text += walker.currentNode.textContent + ' '
    }
    return text
  }
  const stepTargetName = (element: Element, label: string): string => {
    if (!element.matches('input,textarea,select,[contenteditable]')) return label
    if (element.matches('input[type="submit" i],input[type="button" i],input[type="reset" i]')) return (element as HTMLInputElement).value || label
    const aria = element.getAttribute('aria-label')
    if (aria && aria.trim()) return aria
    const labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).slice(0, 5)
      .map((id) => (element.getRootNode() as Document | ShadowRoot).getElementById(id))
      .filter((labelElement): labelElement is HTMLElement => Boolean(labelElement)).map(stepLabelText).join(' ')
    if (labelledBy.trim()) return labelledBy
    const fieldLabels = (element as HTMLInputElement).labels
    const labels = fieldLabels ? [...fieldLabels].slice(0, 2).map(stepLabelText).join(' ') : ''
    if (labels.trim()) return labels
    return element.getAttribute('title') || element.getAttribute('placeholder') || ''
  }
  const omitted = { headings: false, controls: false, bodyText: false, characters: false }
  const add = (line: string): void => {
    if (lines.join('\n').length + (lines.length ? 1 : 0) + line.length > maxChars) omitted.characters = true
    if (lines.join('\n').length < maxChars) lines.push(line)
  }
  if (rootSelector !== null) add('SCOPE: component; content outside the root is omitted, including global dialogs and navigation controls')
  add(config.omitUrlDetail ? 'URL: ' + urlWithoutDetail(location.href) + ' ' + config.urlDetailNote : 'URL: ' + safeUrl(location.href))
  add('TITLE: ' + document.title)
  const visibleHeadings = select('h1,h2,h3').filter(element => visible(element) && !snapshotText.editingContext(element))
  omitted.headings = visibleHeadings.length > 80
  const headings = visibleHeadings.slice(0, 80)
  for (const heading of headings) {
    const text = snapshotText.safeText(heading).replace(/\s+/g, ' ').trim()
    if (text.length > 300) omitted.headings = true
    if (text) add(heading.tagName.toLowerCase() + ': ' + text.slice(0, 300))
  }
  // Controls in open shadow roots, such as the buttons of a web component wallet modal, get refs in their host's place.
  // Closed roots and frames stay unread, and so does text in a shadow root other than a control's name.
  const readRoots = new Set(shadowRoots.slice(0, 200))
  if (shadowRoots.length > 200) omitted.controls = true
  const controlsIn = (light: Element[], scope: Document | ShadowRoot): Element[] => {
    const hosts = (scope === document ? select('*') : [...scope.querySelectorAll('*')])
      .filter(element => element.shadowRoot && readRoots.has(element.shadowRoot))
    if (!hosts.length) return light
    const controls = new Set(light)
    const ordered = [...new Set([...light, ...hosts])]
      .sort((left, right) => left === right ? 0 : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
    return ordered.flatMap(element => [
      ...(controls.has(element) ? [element] : []),
      ...(element.shadowRoot && readRoots.has(element.shadowRoot)
        ? controlsIn([...element.shadowRoot.querySelectorAll(interactive)], element.shadowRoot) : [])
    ])
  }
  // A control in a shadow root is often named by text a slot shows, which its own text leaves out.
  const shownText = (element: Element): string => {
    let text = ''
    let visits = 200
    const walk = (node: Node): void => {
      if (--visits < 0 || text.length > 300) return
      if (node.nodeType === Node.TEXT_NODE) { text += node.textContent + ' '; return }
      if (!(node instanceof Element) || node.matches('input,textarea,select,script,style,[contenteditable]')) return
      if (getComputedStyle(node).display === 'none') return
      const children = node instanceof HTMLSlotElement ? node.assignedNodes({ flatten: true })
        : node.shadowRoot ? [...node.shadowRoot.childNodes] : [...node.childNodes]
      for (const child of children) walk(child)
    }
    walk(element)
    return text
  }
  const visibleElements = controlsIn(select(interactive), document).filter(element => visible(element) && !snapshotText.editingContext(element.parentElement))
  omitted.controls ||= visibleElements.length > 500
  const elements = visibleElements.slice(0, 500)
  for (const element of elements) {
    let ref = identity.refs.get(element)
    if (!ref) { ref = 'e' + (++identity.next); identity.refs.set(element, ref) }
    element.setAttribute('data-hronaut-ref', ref)
    const role = element.getAttribute('role') || element.tagName.toLowerCase()
    // In a shadow root, a form field is named only by its label, never by its text or options, as a component capture.
    const inShadow = element.getRootNode() instanceof ShadowRoot
    const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder')
      || (inShadow && element.matches('input,textarea,select') ? stepTargetName(element, '')
        : snapshotText.safeText(element) || (inShadow ? shownText(element) : ''))
    if (String(label).replace(/\s+/g, ' ').trim().length > 300) omitted.controls = true
    const href = element instanceof HTMLAnchorElement ? ' href=' + JSON.stringify(safeUrl(element.href)) : ''
    const state = (element.matches(':disabled') ? ' disabled' : '') + ((element as HTMLInputElement).checked ? ' checked' : '')
    const shown = lines.length
    add('[' + ref + '] ' + role + ' ' + JSON.stringify(String(label).replace(/\s+/g, ' ').trim().slice(0, 300)) + href + state)
    if (lines.length > shown) {
      const name = String(stepTargetName(element, label) || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (name) targetNames.push([ref, name])
    }
  }
  const bodyText = snapshotText.safeText(root === document ? document.body : root as Element).replace(/\s+/g, ' ').trim()
  omitted.bodyText = bodyText.length > Math.max(0, maxChars - lines.join('\n').length - (lines.length ? 1 : 0) - 6)
  if (bodyText) add('TEXT: ' + bodyText.slice(0, Math.max(0, maxChars - lines.join('\n').length)))
  if (snapshotText.limited()) omitted.characters = true
  const text = lines.join('\n').slice(0, maxChars)
  if (root !== document && !(root as Element).isConnected) return { scopeError: 'detached-root' }
  return { ...(rootSelector === null ? {} : { scope: { kind: 'component', rootTag: (root as Element).localName, outsideScopeOmitted: true } }), formatVersion: config.formatVersion, text, maxChars,
    returnedChars: text.length, truncated: Object.values(omitted).some(Boolean), omitted, targetNames }
}
