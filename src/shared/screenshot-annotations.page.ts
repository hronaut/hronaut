/** Where a screenshot target is, or why it cannot be labeled, as the page sees it. */
interface ScreenshotTargetSample {
  status: string
  rect?: { x: number; y: number; width: number; height: number }
}

interface PendingScreenshotCapture {
  entries: Array<{ ref: string; node: WeakRef<Element> | null; sample: ScreenshotTargetSample }>
  timer: ReturnType<typeof setTimeout>
  expiresAt: number
}

type ScreenshotAnnotationPage = typeof globalThis & { __hronautScreenshotAnnotations?: Map<string, PendingScreenshotCapture> }

/**
 * Runs in the capture's isolated world, which pins element identities only for this capture and writes nothing to the
 * DOM. With refs, it samples each target before the screenshot and keeps the samples for ten seconds; without refs, it
 * samples them again after the screenshot and reports which changed or moved; with cleanup, it drops capture id.
 */
export function screenshotTargetsInPage(id: string, refs: string[] | null, cleanup: boolean): Array<{ ref: string } & ScreenshotTargetSample> | null {
  const page = globalThis as ScreenshotAnnotationPage
  const captures = page.__hronautScreenshotAnnotations ||= new Map<string, PendingScreenshotCapture>()
  for (const [key, capture] of captures) if (Date.now() >= capture.expiresAt) { clearTimeout(capture.timer); captures.delete(key) }
  const prior = captures.get(id)
  if (cleanup) { if (prior) clearTimeout(prior.timer); captures.delete(id); return null }
  const read = (ref: string): ScreenshotTargetSample & { node?: Element } => {
    const matches = document.querySelectorAll('[data-hronaut-ref="' + ref + '"]')
    if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing' }
    const node = matches[0]!
    if (node.matches('iframe,frame') || (node as HTMLElement).isContentEditable || node.closest('[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]')) return { node, status: 'unsupported' }
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || style.display === 'none' || rect.width <= 0 || rect.height <= 0) return { node, status: 'hidden' }
    return { node, status: 'visible', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  }
  if (refs) {
    if (captures.size >= 4) throw new Error('Too many pending annotated screenshots')
    const entries = refs.map(ref => { const { node, ...sample } = read(ref); return { ref, node: node ? new WeakRef(node) : null, sample } })
    const timer = setTimeout(() => captures.delete(id), 10000)
    captures.set(id, { entries, timer, expiresAt: Date.now() + 10000 })
    return entries.map(entry => ({ ref: entry.ref, ...entry.sample }))
  }
  if (!prior) throw new Error('Screenshot target observation expired; capture again')
  clearTimeout(prior.timer); captures.delete(id)
  return prior.entries.map(entry => {
    const { node, ...sample } = read(entry.ref)
    if ((entry.node?.deref() || undefined) !== node || (node && !node.isConnected)) return { ref: entry.ref, status: 'changed' }
    if (JSON.stringify(sample) !== JSON.stringify(entry.sample)) return { ref: entry.ref, status: 'moved' }
    return { ref: entry.ref, ...sample }
  })
}
