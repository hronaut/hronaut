import type { FrameObservationOmission } from '../../../shared/frame-observation.js'

/** A clipping rectangle in the parent's viewport, or in the frame's own. */
interface Clip { left: number; top: number; right: number; bottom: number }

/** A heading, control, label or element with an id the walk met, and the public text it collected. */
interface LabelRecord { node: Element; text: string; heading: boolean; role: string; explicit: string; inClip: boolean }

/** What a frame observation keeps in its world: the frame, its text, and the checks that it is still the same frame. */
export interface FrameObservation {
  frame: HTMLIFrameElement
  read: () => { text: string; omissions: FrameObservationOmission[] }
  check: () => boolean
  close: () => void
}

type FrameLink = (node: Element, baseURI: string, omissions: Set<FrameObservationOmission>) => string

/**
 * Runs in the frame observation's private parent world: the one iframe the selector names, walking at most 10000
 * elements for 100 ms, and throwing otherwise.
 */
export function frameSelectorInPage(selector: string): HTMLIFrameElement {
  const start = performance.now(), walk = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT)
  let count = 0, visits = 0, found: Element | undefined
  while (walk.nextNode()) {
    if (++visits > 10000 || performance.now() - start > 100) throw Error('Unavailable')
    if ((walk.currentNode as Element).matches(selector)) { found = walk.currentNode as Element; if (++count > 1) throw Error('Unavailable') }
  }
  if (count !== 1 || found!.localName !== 'iframe') throw Error('Unavailable')
  return found as HTMLIFrameElement
}

/**
 * Runs in the frame observation's world: a link's address with its credentials, fragment, session ids and secret-looking
 * query values taken out, only the scheme for a link that is not http or https, and nothing for one that is too long or
 * does not parse.
 */
export function frameLinkInPage(node: Element, baseURI: string, omissions: Set<FrameObservationOmission>): string {
  const value = node.getAttribute('href') || ''
  if (!value) return ''
  if (value.length > 2048) { omissions.add('semantic-limit'); return '' }
  try {
    const u = new URL(value, baseURI)
    if (!['http:', 'https:'].includes(u.protocol)) return u.protocol + '//'
    u.username = ''; u.password = ''; u.hash = ''; u.pathname = u.pathname.replace(/;(jsessionid)=[^;/]*/gi, ';$1=[REDACTED]')
    for (const key of [...u.searchParams.keys()]) if (/(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passwrd|passcode|passphrase|pwd|secret|session|token)/i.test(key) || /^(?:sig|signature|jwt|q-signature|x-[a-z0-9]+-signature|hdnt[sla]|tempauth|hm|hmac|md5|oh|key|access[-_]?key|subscription[-_]?key|auth|authkey|rlkey|resourcekey|sid|phpsessid)$/i.test(key) || /(?:^|[[_-])(?:pass|pw)\d?(?:[\][]|$)/i.test(key)) u.searchParams.set(key, '[REDACTED]')
    return u.href
  } catch { return '' }
}

/**
 * Runs only in a private parent isolated world, never in a child's main world: checks that the selector names exactly
 * the expected frame, a same-origin iframe without sandbox or srcdoc that the parent shows whole and untransformed, and
 * reads the public text of the frame's viewport, at most maxChars characters, headings and controls first, within 10000
 * nodes and 100 ms. No innerText, textContent, form values, placeholders or selected options. It keeps watching the
 * frame and its ancestors, so check() turns false once either is removed or replaced.
 */
export function frameObservationInPage(selector: string, maxChars: number, expected: Element, frameLink: FrameLink): FrameObservation {
  const started = performance.now(), omissions = new Set<FrameObservationOmission>()
  const fail: () => never = () => { throw new Error('Frame observation unavailable') }
  let searched = 0, selected: HTMLIFrameElement | null = null, count = 0
  const search = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT)
  while (search.nextNode()) {
    if (++searched > 10000 || performance.now() - started > 100) fail()
    if ((search.currentNode as Element).matches(selector)) { selected = search.currentNode as HTMLIFrameElement; if (++count > 1) fail() }
  }
  if (selected !== expected || count !== 1 || selected.localName !== 'iframe' || selected.hasAttribute('sandbox') || selected.hasAttribute('srcdoc')) fail()
  const frame = selected!
  // This native SOP check is independent of CDP's privileged node access.
  const child = frame.contentDocument
  if (!child || !child.documentElement) fail()
  const parent = document, root = child.documentElement, ancestors: Element[] = []
  for (let e: Element | null = frame; e; e = e.parentElement) { if (ancestors.length >= 100) fail(); ancestors.push(e) }
  let invalid = false, mutationWork = 0, mutationTime = 0
  const invalidate = (): void => { invalid = true; observer.disconnect() }
  const changed = (records: MutationRecord[]): void => {
    if (invalid) return
    const start = performance.now()
    const exhausted = (): boolean => ++mutationWork > 1000 || mutationTime + performance.now() - start > 20
    if (records.length > 1000) { invalidate(); return }
    for (const r of records) {
      if (exhausted()) { invalidate(); return }
      for (const n of r.removedNodes) {
        if (exhausted() || n === root) { invalidate(); return }
        for (const e of ancestors) {
          if (exhausted() || n === e || (n.nodeType === 1 && n.contains(e))) { invalidate(); return }
        }
      }
    }
    mutationTime += performance.now() - start
  }
  const observer = new MutationObserver(changed)
  observer.observe(parent, { childList: true, subtree: true }); observer.observe(child, { childList: true })
  const check = (): boolean => {
    if (invalid) return false
    changed(observer.takeRecords())
    return !invalid && document === parent && frame.isConnected && frame.contentDocument === child && child.documentElement === root
      && !frame.hasAttribute('sandbox') && !frame.hasAttribute('srcdoc')
  }
  try {
    const contains = (outer: Clip, r: DOMRect): boolean => r.width > 0 && r.height > 0 && r.left >= outer.left && r.top >= outer.top && r.right <= outer.right && r.bottom <= outer.bottom
    const uncertain = (s: CSSStyleDeclaration): boolean => s.transform !== 'none' || s.rotate !== 'none' || s.scale !== 'none' || s.translate !== 'none'
      || !['1', 'normal'].includes(s.zoom) || s.clipPath !== 'none' || s.clip !== 'auto' || /(?:paint|strict|content)/.test(s.contain)
      || s.filter !== 'none' || s.maskImage !== 'none'
    const rounded = (s: CSSStyleDeclaration): boolean => [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius].some(value => value.split(/\s+/).some(part => parseFloat(part) !== 0))
    const overflowClip = (node: Element, s: CSSStyleDeclaration, clip: Clip): Clip | null => {
      if (s.overflowX === 'visible' && s.overflowY === 'visible') return clip
      if (rounded(s)) return null
      const r = node.getBoundingClientRect()
      const borders = [s.borderLeftWidth, s.borderRightWidth, s.borderTopWidth, s.borderBottomWidth].map(parseFloat)
      // CSSOM client dimensions round. Reject fractional geometry rather than
      // extending a clipping edge into a border or scrollbar by that rounding.
      if (borders.some(v => !Number.isInteger(v)) || !Number.isInteger(r.width) || !Number.isInteger(r.height)) return null
      const left = r.left + node.clientLeft, top = r.top + node.clientTop
      return {
        left: s.overflowX === 'visible' ? clip.left : Math.max(clip.left, left),
        right: s.overflowX === 'visible' ? clip.right : Math.min(clip.right, left + node.clientWidth),
        top: s.overflowY === 'visible' ? clip.top : Math.max(clip.top, top),
        bottom: s.overflowY === 'visible' ? clip.bottom : Math.min(clip.bottom, top + node.clientHeight)
      }
    }
    let parentClip: Clip | null = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    const frameRect = frame.getBoundingClientRect()
    for (const e of ancestors) {
      const s = getComputedStyle(e)
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) !== 1 || uncertain(s)) fail()
      if (e === frame) {
        if (rounded(s) || [s.paddingLeft, s.paddingRight, s.paddingTop, s.paddingBottom].some(value => parseFloat(value) !== 0)) fail()
      } else { parentClip = overflowClip(e, s, parentClip!); if (!parentClip) fail() }
    }
    if (!contains(parentClip!, frameRect)) fail()
    const viewport = { left: 0, top: 0, right: frame.clientWidth, bottom: frame.clientHeight }
    const out: string[] = [], body: string[] = [], semantics: LabelRecord[] = [], labels = new Map<Element, LabelRecord>()
    let chars = 0, bodyChars = 0, visited = 0, headings = 0, controls = 0
    const clean = (v: unknown): string => String(v || '').replace(/\s+/g, ' ').trim()
    const attr = (node: Element, name: string): string => { const value = node.getAttribute(name) || ''; if (value.length > 300) omissions.add('semantic-limit'); return clean(value.slice(0, 300)) }
    const safeUrl = (node: Element): string => frameLink(node, child.baseURI, omissions)
    const append = (value: string): boolean => { if (chars + value.length + (out.length ? 1 : 0) > maxChars) { omissions.add('text-limit'); return false } out.push(value); chars += value.length + (out.length > 1 ? 1 : 0); return true }
    // One bounded public-text walk supplies body and semantic fallback labels.
    // No innerText, textContent, form values, placeholders or selected options.
    const stack: Array<{ node: Node; depth: number; clip: Clip; owners: LabelRecord[] }> = [{ node: root, depth: 0, clip: viewport, owners: [] }]
    while (stack.length) {
      if (++visited > 10000) { omissions.add('node-limit'); break }
      if (performance.now() - started > 100) { omissions.add('duration-limit'); break }
      const { node, depth, clip, owners } = stack.pop()!
      if (depth > 100) { omissions.add('depth-limit'); continue }
      if (node.nodeType === 1) {
        const element = node as HTMLElement
        const tag = element.localName
        if (['script', 'style', 'noscript', 'template', 'head'].includes(tag)) continue
        if (element.isContentEditable || element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') { omissions.add('private-editors'); continue }
        if (['iframe', 'frame', 'object', 'embed'].includes(tag)) { omissions.add('nested-frames'); continue }
        if (element.shadowRoot) omissions.add('shadow-dom')
        const s = getComputedStyle(element)
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) continue
        if (uncertain(s) || Number(s.opacity) !== 1 || s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') { omissions.add('uncertain-layout'); continue }
        const nextClip = overflowClip(element, s, clip)
        if (!nextClip) { omissions.add('uncertain-layout'); continue }
        const role = attr(element, 'role'), heading = /^h[1-6]$/.test(tag), control = ['a', 'button', 'input', 'textarea', 'select', 'summary'].includes(tag) || ['button', 'link', 'checkbox', 'radio', 'tab'].includes(role)
        const rect = element.getBoundingClientRect(), inClip = contains(clip, rect)
        let nextOwners = owners, record: LabelRecord
        if ((heading || control) && !inClip) omissions.add('offscreen-or-clipped')
        if (heading || control || tag === 'label' || element.hasAttribute('id')) {
          if (labels.size >= 1000) { omissions.add('semantic-limit') }
          else {
            record = { node: element, text: '', heading, role: role || tag, explicit: attr(element, 'aria-label') || attr(element, 'title'), inClip }
            labels.set(element, record); nextOwners = [...owners, record]
            if (heading && inClip) { if (++headings <= 80) semantics.push(record); else omissions.add('semantic-limit') }
            else if (control && inClip) { if (++controls <= 500) semantics.push(record); else omissions.add('semantic-limit') }
          }
        }
        if (['input', 'textarea', 'select', 'option'].includes(tag)) { omissions.add('private-editors'); continue }
        for (let n = element.lastChild; n; n = n.previousSibling) { if (stack.length >= 10000) { omissions.add('node-limit'); break } stack.push({ node: n, depth: depth + 1, clip: nextClip, owners: nextOwners }) }
      } else if (node.nodeType === 3) {
        const range = child.createRange(); range.selectNodeContents(node); const boxes = range.getClientRects()
        if (boxes.length > 1000) { omissions.add('uncertain-layout'); continue }
        if (!boxes.length || !Array.from(boxes).every(r => contains(clip, r))) { omissions.add('offscreen-or-clipped'); continue }
        const value = clean((node as Text).data.slice(0, maxChars + 1)); if (!value) continue
        for (const owner of owners) {
          if (++visited > 10000) { omissions.add('node-limit'); break }
          const next = owner.text + (owner.text ? ' ' : '') + value
          if (next.length > 300) omissions.add('semantic-limit'); owner.text = next.slice(0, 300)
        }
        if (bodyChars + value.length + 1 > maxChars) { omissions.add('text-limit'); break }
        body.push(value); bodyChars += value.length + 1
      }
    }
    const boundLabel = (value: string): string => { const label = clean(value); if (label.length > 300) omissions.add('semantic-limit'); return label.slice(0, 300) }
    const publicLabel = (record: LabelRecord): string => {
      if (record.explicit) return record.explicit
      const ids = attr(record.node, 'aria-labelledby').split(/\s+/).filter(Boolean)
      if (ids.length > 8) { omissions.add('semantic-limit'); return '' }
      const parts: string[] = []
      for (const id of ids) { const target = child.getElementById(id), entry = labels.get(target as Element); if (entry?.inClip) parts.push(entry.text); else omissions.add('semantic-limit') }
      if (parts.length) return boundLabel(parts.join(' '))
      const associated = (record.node as HTMLInputElement).labels
      if (associated) { if (associated.length > 8) omissions.add('semantic-limit'); else for (const label of associated) { const entry = labels.get(label); if (entry?.inClip) parts.push(entry.text); else omissions.add('semantic-limit') } }
      return boundLabel(parts.join(' ') || record.text)
    }
    for (const record of semantics) {
      if (performance.now() - started > 100) { omissions.add('duration-limit'); break }
      const node = record.node, label = publicLabel(record)
      if (record.heading) { if (!append(node.localName + ': ' + label)) break; continue }
      let line = record.role + ' ' + JSON.stringify(label)
      if (node.localName === 'a') line += ' href=' + JSON.stringify(safeUrl(node))
      if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true') line += ' disabled'
      if (node.localName === 'input' && ['checkbox', 'radio'].includes((node as HTMLInputElement).type)) line += ' checked=' + String((node as HTMLInputElement).checked)
      else if (['true', 'false', 'mixed'].includes(node.getAttribute('aria-checked')!)) line += ' checked=' + node.getAttribute('aria-checked')
      if (!append(line)) break
    }
    for (const value of body) if (!append(value)) break
    if (!check()) fail()
    const result = { text: out.join('\n'), omissions: [...omissions] }
    return { frame, read: () => result, check, close: () => observer.disconnect() }
  } catch (e) { observer.disconnect(); throw e }
}

/** What the observation's private world keeps under its key: the selected frame, then the observation in its place. */
type HeldFrames = Record<string, Partial<FrameObservation> & Pick<FrameObservation, 'frame' | 'close'> | undefined>

/**
 * Runs in the frame observation's private parent world: keeps the one iframe the selector names under the key, and
 * gives it. `selectFrame` is frameSelectorInPage.
 */
export function holdSelectedFrameInPage(key: string, selector: string, selectFrame: (selector: string) => HTMLIFrameElement): HTMLIFrameElement {
  const held = globalThis as unknown as HeldFrames
  held[key] = { frame: selectFrame(selector), close: () => undefined }
  return held[key]!.frame
}

/**
 * Runs in the frame observation's private parent world: observes the frame held under the key, and keeps the
 * observation there in its place. `observe` is frameObservationInPage and `frameLink` frameLinkInPage.
 */
export function observeHeldFrameInPage(key: string, selector: string, maxChars: number, observe: typeof frameObservationInPage, frameLink: FrameLink): true {
  const held = globalThis as unknown as HeldFrames
  held[key] = observe(selector, maxChars, held[key]!.frame, frameLink)
  return true
}

/** Runs in the frame observation's private parent world: the text the observation held under the key read. */
export function readHeldFrameInPage(key: string): ReturnType<FrameObservation['read']> {
  return (globalThis as unknown as HeldFrames)[key]!.read!()
}

/**
 * Runs in the frame observation's private parent world: whether the observation held under the key still watches the
 * same frame. It closes and forgets what the key holds either way.
 */
export function checkAndReleaseHeldFrameInPage(key: string): boolean {
  const held = globalThis as unknown as HeldFrames
  const frame = held[key]
  const ok = !!frame && frame.check!()
  if (frame) frame.close()
  delete held[key]
  return ok
}

/** Runs in the frame observation's private parent world: closes and forgets what the key holds. */
export function releaseHeldFrameInPage(key: string): true {
  const held = globalThis as unknown as HeldFrames
  const frame = held[key]
  if (frame) frame.close()
  delete held[key]
  return true
}
