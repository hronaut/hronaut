import { createHash, randomUUID } from 'node:crypto'
import { incidentCaptureSchema, incidentReviewSchema, type IncidentArtifact, type IncidentDraft, type IncidentPreview } from '../shared/incident-package.js'
import { redactDiagnosticText } from '../shared/debug-report.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

const ARTIFACT_LIMIT = 256 * 1024
const PACKAGE_LIMIT = 4 * 1024 * 1024
const TTL = 10 * 60 * 1000
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
type Host = Pick<BrowserTabsManager, 'getState' | 'debugReport' | 'networkHar' | 'reproRecording'>
interface Stored { draft: IncidentDraft; preview?: IncidentPreview }

/** Volatile, bounded review snapshots. Never re-read live evidence after review. */
export class IncidentPackages {
  private readonly drafts = new Map<number, Stored>()
  private readonly generations = new Map<number, number>()
  constructor(private readonly host: () => Host, private readonly version: string, private readonly now = Date.now) {}

  discard(owner: number): void {
    this.drafts.delete(owner)
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1)
  }
  forget(owner: number): void { this.drafts.delete(owner); this.generations.delete(owner) }
  private current(owner: number, id: string): Stored {
    const stored = this.drafts.get(owner)
    if (!stored || stored.draft.draftId !== id) throw new Error('Incident review is missing or replaced; capture again')
    if (Date.parse(stored.draft.expiresAt) <= this.now()) {
      this.discard(owner)
      throw new Error('Incident review expired; capture again')
    }
    return stored
  }
  async capture(owner: number, input: unknown): Promise<IncidentDraft> {
    const request = incidentCaptureSchema.parse(input)
    this.discard(owner)
    const generation = this.generations.get(owner)
    const host = this.host()
    const context = () => {
      const tab = host.getState().tabs.find(tab => tab.id === request.tabId)
      if (!tab) throw new Error('Incident tab is no longer available')
      return `${tab.id}:${tab.navigationGeneration}:${tab.observationGeneration ?? 0}`
    }
    const initialContext = context()
    const end = this.now()
    const start = end - request.minutes * 60_000
    const inWindow = (value: string) => { const time = Date.parse(value); return time >= start && time <= end }
    const artifacts: IncidentArtifact[] = []
    for (const kind of request.kinds) {
      let data: unknown
      let truncated: boolean
      let count: number
      try {
        if (kind === 'repro') {
          const report = await deadline(host.reproRecording('get', request.tabId), end + 30_000 - this.now())
          const steps = report.steps.filter(step => inWindow(step.occurredAt))
          count = steps.length; truncated = report.truncated
          data = { formatVersion: report.formatVersion ?? 1, activeAtCapture: report.active, steps, caveats: report.caveats }
        } else if (kind === 'network') {
          const report = await deadline(host.networkHar({ tabId: request.tabId, includeBodies: false, maxRequests: 100 }), end + 30_000 - this.now())
          const entries = report.log.entries.filter(entry => inWindow(entry.startedDateTime))
          count = entries.length; truncated = report._hronaut.truncated
          data = { entries, includesBodies: false, caveats: report._hronaut.caveats }
        } else {
          const report = host.debugReport({ tabId: request.tabId, maxConsoleMessages: 100, maxNetworkRequests: 100, includeSuccessfulRequests: true })
          const console = report.console.filter(entry => inWindow(entry.timestamp))
          const network = report.network.filter(entry => inWindow(entry.startedAt))
          count = console.length + network.length; truncated = report.truncated.console || report.truncated.network
          data = { console, network, caveats: report.caveats }
        }
        // A second conservative text pass includes user-authored Repro intent.
        const sanitized = transformStrings(data, value => redactDiagnosticText(value))
        const text = JSON.stringify(sanitized, null, 2)
        artifacts.push(Buffer.byteLength(text) > ARTIFACT_LIMIT
          ? { kind, status: 'oversize', truncated: true }
          : { kind, status: count ? 'available' : 'empty', truncated, text })
      } catch (error) {
        if (error instanceof CaptureTimeout) throw error
        artifacts.push({ kind, status: 'unavailable', truncated: false })
      }
      if (this.generations.get(owner) !== generation || context() !== initialContext) throw new Error('Incident context changed during capture; capture again')
      if (this.now() - end > 30_000) throw new Error('Incident capture exceeded its time limit; capture again')
    }
    const draft: IncidentDraft = { draftId: randomUUID(), capturedAt: new Date(end).toISOString(), windowStart: new Date(start).toISOString(), expiresAt: new Date(end + TTL).toISOString(), artifacts }
    // The trusted shell has one draft; cap other shell-owner records as well.
    while (this.drafts.size >= 4) this.discard(this.drafts.keys().next().value!)
    this.drafts.set(owner, { draft })
    return structuredClone(draft)
  }
  review(owner: number, input: unknown): IncidentPreview {
    const request = incidentReviewSchema.parse(input)
    const stored = this.current(owner, request.draftId)
    stored.preview = undefined
    if (request.include.some(kind => !stored.draft.artifacts.some(a => a.kind === kind))) throw new Error('Incident artifact was not captured')
    const counts = request.replacements.map(() => 0)
    const artifacts = stored.draft.artifacts.map(artifact => {
      if (!request.include.includes(artifact.kind)) return { kind: artifact.kind, status: 'omitted', truncated: artifact.truncated }
      if (!artifact.text) return { ...artifact }
      let transformedBytes = 0
      const data = transformStrings(JSON.parse(artifact.text), value => {
        let next = value
        request.replacements.forEach((rule, index) => {
          const pieces = next.split(rule.find)
          const occurrences = pieces.length - 1
          const expandedBytes = Buffer.byteLength(next) + occurrences * (Buffer.byteLength(rule.replacement) - Buffer.byteLength(rule.find))
          if (expandedBytes > ARTIFACT_LIMIT) throw new Error('Reviewed artifact exceeds the size limit')
          counts[index]! += occurrences
          next = pieces.join(rule.replacement)
        })
        const sanitized = redactDiagnosticText(next)
        transformedBytes += Buffer.byteLength(sanitized)
        if (transformedBytes > ARTIFACT_LIMIT) throw new Error('Reviewed artifact exceeds the size limit')
        return sanitized
      })
      const text = JSON.stringify(data, null, 2)
      if (Buffer.byteLength(text) > ARTIFACT_LIMIT) throw new Error('Reviewed artifact exceeds the size limit')
      return { ...artifact, text }
    })
    const manifest = {
      schemaVersion: 1, kind: 'hronaut-reviewed-incident', source: { application: 'Hronaut', version: this.version },
      capturedAt: stored.draft.capturedAt, windowStart: stored.draft.windowStart,
      localOnly: true, reviewRequired: true,
      limits: { maxArtifacts: 3, maxArtifactBytes: ARTIFACT_LIMIT, maxPackageBytes: PACKAGE_LIMIT, maxWindowMinutes: 60 },
      limitations: ['Selected retained text only; not a complete session or anonymization guarantee.', 'No screenshots, request/response bodies, profiles, replay, external uploads or receipt collection.', 'Missing or evicted historical evidence cannot be reconstructed; empty means no retained entries in the window.', 'Hashes establish byte integrity, not factual truth.'],
      transformations: counts.map(occurrences => ({ type: 'literal-text-replacement', occurrences })),
      artifacts: artifacts.map(a => ({ kind: a.kind, status: a.status, truncated: a.truncated, ...('text' in a && a.text ? { bytes: Buffer.byteLength(a.text), sha256: hash(a.text) } : {}) }))
    }
    const sections = artifacts.filter(a => 'text' in a && a.text).map(a => `<section><h2>${a.kind}</h2><pre>${escapeHtml('text' in a ? a.text! : '')}</pre></section>`).join('\n')
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"><meta name="referrer" content="no-referrer"><title>Hronaut reviewed incident</title><body><h1>Hronaut reviewed incident</h1><p>Local text evidence. Review does not guarantee anonymization. No replay or remote resources.</p><section><h2>Manifest</h2><pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre></section>${sections}</body></html>\n`
    const bytes = Buffer.byteLength(html)
    if (bytes > PACKAGE_LIMIT) throw new Error('Incident package exceeds the size limit')
    stored.preview = { previewId: randomUUID(), html, bytes, sha256: hash(html) }
    return { ...stored.preview }
  }
  export(owner: number, draftId: string, previewId: string): IncidentPreview {
    const stored = this.current(owner, draftId)
    if (!stored.preview || stored.preview.previewId !== previewId) throw new Error('Incident preview changed; review again')
    return { ...stored.preview }
  }
}

function transformStrings(value: unknown, transform: (value: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map(item => transformStrings(item, transform))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [transform(key), transformStrings(item, transform)]))
  return value
}

class CaptureTimeout extends Error {
  constructor() { super('Incident capture exceeded its time limit; capture again') }
}
async function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CaptureTimeout()), Math.max(0, milliseconds))
    })])
  } finally { if (timer) clearTimeout(timer) }
}
