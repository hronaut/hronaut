import type { BrowserScreenshotClip } from './types.js'

export interface ScreenshotAnnotation {
  ref: string
  label: number
  status: 'labeled' | 'missing' | 'ambiguous' | 'hidden' | 'offscreen' | 'unsupported' | 'changed' | 'moved' | 'label-overlap'
  bounds?: BrowserScreenshotClip
  labelBounds?: BrowserScreenshotClip
  clipped?: boolean
}
export interface ScreenshotAnnotationReport {
  scope: 'viewport'
  width: number
  height: number
  annotations: ScreenshotAnnotation[]
  caveats: string[]
}

export function normalizeScreenshotRefs(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 50
    || value.some(ref => typeof ref !== 'string' || !/^e[1-9]\d{0,5}$/.test(ref))) {
    throw new TypeError('annotateRefs must contain 1 to 50 current snapshot refs')
  }
  return [...new Set(value)]
}

/** Pin object identities only for this capture in an isolated world. No DOM writes. */
export function screenshotAnnotationScript(id: string, refs?: string[], cleanup = false): string {
  return `(() => {
    const id = ${JSON.stringify(id)};
    const captures = globalThis.__hronautScreenshotAnnotations ||= new Map();
    for (const [key, capture] of captures) if (Date.now() >= capture.expiresAt) { clearTimeout(capture.timer); captures.delete(key); }
    const prior = captures.get(id);
    if (${cleanup}) { if (prior) clearTimeout(prior.timer); captures.delete(id); return null; }
    const refs = ${JSON.stringify(refs ?? null)};
    const read = ref => {
      const matches = document.querySelectorAll('[data-hronaut-ref="' + ref + '"]');
      if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing' };
      const node = matches[0];
      if (node.matches('iframe,frame') || node.isContentEditable || node.closest('[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]')) return { node, status: 'unsupported' };
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || style.display === 'none' || rect.width <= 0 || rect.height <= 0) return { node, status: 'hidden' };
      return { node, status: 'visible', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    };
    if (refs) {
      if (captures.size >= 4) throw new Error('Too many pending annotated screenshots');
      const entries = refs.map(ref => { const { node, ...sample } = read(ref); return { ref, node: node ? new WeakRef(node) : null, sample }; });
      const timer = setTimeout(() => captures.delete(id), 10000);
      captures.set(id, { entries, timer, expiresAt: Date.now() + 10000 });
      return entries.map(entry => ({ ref: entry.ref, ...entry.sample }));
    }
    if (!prior) throw new Error('Screenshot target observation expired; capture again');
    clearTimeout(prior.timer); captures.delete(id);
    return prior.entries.map(entry => {
      const { node, ...sample } = read(entry.ref);
      if ((entry.node?.deref() || undefined) !== node || (node && !node.isConnected)) return { ref: entry.ref, status: 'changed' };
      if (JSON.stringify(sample) !== JSON.stringify(entry.sample)) return { ref: entry.ref, status: 'moved' };
      return { ref: entry.ref, ...sample };
    });
  })()`
}

const digits = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']

/** Composite onto a private BGRA bitmap; positions and legend use final image pixels. */
export function annotateScreenshotBitmap(bitmap: Uint8Array, width: number, height: number,
  viewport: { width: number; height: number }, refs: string[], raw: unknown): ScreenshotAnnotationReport {
  refs = normalizeScreenshotRefs(refs)!
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_777_216
    || bitmap.length !== width * height * 4 || ![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Could not align the annotated screenshot bitmap')
  }
  const rows = Array.isArray(raw) ? raw : []
  const annotations: ScreenshotAnnotation[] = []
  const occupied: BrowserScreenshotClip[] = []
  const intersects = (a: BrowserScreenshotClip, b: BrowserScreenshotClip) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  const fill = (rect: BrowserScreenshotClip, yellow: boolean) => {
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const offset = (y * width + x) * 4
      bitmap[offset] = 0; bitmap[offset + 1] = yellow ? 220 : 0; bitmap[offset + 2] = yellow ? 255 : 0; bitmap[offset + 3] = 255
    }
  }
  for (const [index, ref] of refs.entries()) {
    const row = rows[index] as { ref?: unknown; status?: unknown; rect?: BrowserScreenshotClip } | undefined
    const annotation: ScreenshotAnnotation = { ref, label: index + 1, status: 'unsupported' }
    annotations.push(annotation)
    if (!row || row.ref !== ref) continue
    if (['missing', 'ambiguous', 'hidden', 'unsupported', 'changed', 'moved'].includes(String(row.status))) {
      annotation.status = row.status as ScreenshotAnnotation['status']; continue
    }
    const rect = row.rect
    if (row.status !== 'visible' || !rect || ![rect.x, rect.y, rect.width, rect.height].every(value => Number.isFinite(value) && Math.abs(value) <= 10_000_000) || rect.width <= 0 || rect.height <= 0) continue
    const left = Math.max(0, rect.x), top = Math.max(0, rect.y)
    const right = Math.min(viewport.width, rect.x + rect.width), bottom = Math.min(viewport.height, rect.y + rect.height)
    if (right <= left || bottom <= top) { annotation.status = 'offscreen'; continue }
    const x = Math.floor(left * width / viewport.width), y = Math.floor(top * height / viewport.height)
    const bounds = { x, y, width: Math.max(1, Math.ceil(right * width / viewport.width) - x), height: Math.max(1, Math.ceil(bottom * height / viewport.height) - y) }
    annotation.bounds = bounds
    annotation.clipped = left !== rect.x || top !== rect.y || right !== rect.x + rect.width || bottom !== rect.y + rect.height
    const labelWidth = String(annotation.label).length * 8 + 6, labelHeight = 16
    const placements = [
      { x, y: y - labelHeight }, { x, y },
      { x: x + bounds.width - labelWidth, y }, { x, y: y + bounds.height - labelHeight }
    ].map(point => ({ x: Math.max(0, Math.min(width - labelWidth, point.x)), y: Math.max(0, Math.min(height - labelHeight, point.y)), width: labelWidth, height: labelHeight }))
    const label = width >= labelWidth && height >= labelHeight ? placements.find(candidate => !occupied.some(other => intersects(candidate, other))) : undefined
    if (!label) { annotation.status = 'label-overlap'; continue }
    occupied.push(label); annotation.status = 'labeled'; annotation.labelBounds = label
  }
  // Outlines first so another target's outline cannot obscure a label.
  for (const annotation of annotations) if (annotation.status === 'labeled' && annotation.bounds) {
    const b = annotation.bounds
    fill({ ...b, height: Math.min(2, b.height) }, true)
    fill({ ...b, y: b.y + Math.max(0, b.height - 2), height: Math.min(2, b.height) }, true)
    fill({ ...b, width: Math.min(2, b.width) }, true)
    fill({ ...b, x: b.x + Math.max(0, b.width - 2), width: Math.min(2, b.width) }, true)
  }
  for (const annotation of annotations) if (annotation.labelBounds) {
    const box = annotation.labelBounds
    fill(box, false)
    for (const [i, digit] of String(annotation.label).split('').entries()) {
      for (const [pixel, bit] of digits[Number(digit)]!.split('').entries()) if (bit === '1') {
        fill({ x: box.x + 3 + i * 8 + pixel % 3 * 2, y: box.y + 3 + Math.floor(pixel / 3) * 2, width: 2, height: 2 }, true)
      }
    }
  }
  return { scope: 'viewport', width, height, annotations, caveats: [
    'Labels map only the requested current snapshot refs to sampled viewport geometry; take a fresh snapshot after page changes. Refs follow the existing latest-snapshot lifetime.',
    'Geometry and pixels are asynchronous observations, not an atomic rendering guarantee. Changed targets are omitted; transient movement between samples may be undetected.',
    'Bounds do not establish visibility through occlusion, clickability, accessibility conformance or actual painted shape. Frames, shadow descendants, editors and pinch zoom are unsupported.',
    'Labels may cover page pixels. Overlapping labels are omitted explicitly; annotations are not redaction and screenshot pixels can contain private data.'
  ] }
}
