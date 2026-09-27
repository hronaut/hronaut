import { randomUUID } from 'node:crypto'
import type { Cookie } from 'electron'
import type { BrowserImportPreview, BrowserImportProfile, BrowserImportResult } from '../../shared/browser-import.js'
import { BrowserImportError, type CookieSnapshot, type ImportProfile } from './contracts.js'

export interface ImportDestination { id: string; name: string; fingerprint: string }
interface ImportPorts {
  destination(id: string): ImportDestination
  discover(): Promise<ImportProfile[]>
  consent(profile: BrowserImportProfile, destination: ImportDestination): Promise<boolean>
  read(profile: ImportProfile): Promise<CookieSnapshot>
  write(destination: ImportDestination, cookies: Cookie[]): Promise<BrowserImportResult>
  now?: () => number
}
interface PreviewState { id: string; destination: ImportDestination; cookies: Cookie[]; skipped: number; expiresAt: number }
const LIFETIME = 5 * 60_000

/** The caller authenticates the trusted shell. Neither profiles nor previews enter MCP. */
export class BrowserImportService {
  private generation = 0
  private profiles: ImportProfile[] = []
  private destination: ImportDestination | null = null
  private previewState: PreviewState | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private committing = false
  constructor(private readonly ports: ImportPorts) {}
  cancel(): void {
    this.generation++
    this.profiles = []; this.destination = null
    if (this.previewState) for (const cookie of this.previewState.cookies) cookie.value = ''
    this.previewState = null
    clearTimeout(this.timer)
  }
  private check(generation: number, destination: ImportDestination): void {
    if (generation !== this.generation || this.ports.destination(destination.id).fingerprint !== destination.fingerprint) throw new BrowserImportError('expired')
  }
  async list(id: string): Promise<BrowserImportProfile[]> {
    if (this.committing) throw new BrowserImportError('busy')
    this.cancel()
    const generation = this.generation
    const destination = this.ports.destination(id)
    const profiles = await this.ports.discover()
    this.check(generation, destination)
    this.destination = destination; this.profiles = profiles
    this.timer = setTimeout(() => this.cancel(), LIFETIME); this.timer.unref()
    return profiles.map(({ id, browser, name }) => ({ id, browser, name }))
  }
  async preview(workspaceId: string, profileId: string): Promise<BrowserImportPreview | null> {
    if (this.committing) throw new BrowserImportError('busy')
    const destination = this.destination
    const profile = this.profiles.find(p => p.id === profileId)
    if (!destination || workspaceId !== destination.id || !profile) throw new BrowserImportError('expired')
    // Changing profiles invalidates both the old read grant and old cookie values.
    const generation = ++this.generation
    if (this.previewState) for (const cookie of this.previewState.cookies) cookie.value = ''
    this.previewState = null
    this.check(generation, destination)
    if (!await this.ports.consent({ id: profile.id, browser: profile.browser, name: profile.name }, destination)) return null
    this.check(generation, destination)
    const snapshot = await this.ports.read(profile)
    try { this.check(generation, destination) } catch (error) { for (const cookie of snapshot.cookies) cookie.value = ''; throw error }
    const id = randomUUID()
    const expiresAt = (this.ports.now?.() ?? Date.now()) + LIFETIME
    this.previewState = { id, destination, ...snapshot, expiresAt }
    clearTimeout(this.timer); this.timer = setTimeout(() => this.cancel(), LIFETIME); this.timer.unref()
    const sites = new Map<string, { domain: string; count: number; includesSubdomains: boolean }>()
    for (const cookie of snapshot.cookies) {
      const domain = cookie.domain!.replace(/^\./, '')
      const site = sites.get(domain) ?? { domain, count: 0, includesSubdomains: false }
      site.count++; site.includesSubdomains ||= !cookie.hostOnly; sites.set(domain, site)
    }
    return { id, expiresAt, skipped: snapshot.skipped, sites: [...sites.values()].sort((a, b) => a.domain.localeCompare(b.domain)) }
  }
  async commit(id: string, domains: string[]): Promise<BrowserImportResult> {
    if (this.committing) throw new BrowserImportError('busy')
    const preview = this.previewState
    if (!preview || preview.id !== id) throw new BrowserImportError('expired')
    if (preview.expiresAt <= (this.ports.now?.() ?? Date.now())) { this.cancel(); throw new BrowserImportError('expired') }
    try { this.check(this.generation, preview.destination) } catch (error) { this.cancel(); throw error }
    const available = new Set(preview.cookies.map(c => c.domain!.replace(/^\./, '')))
    if (!domains.length || domains.length > 20_000 || domains.some(d => !available.has(d))) throw new BrowserImportError('expired')
    const selected = new Set(domains)
    const cookies = preview.cookies.filter(c => selected.has(c.domain!.replace(/^\./, '')))
    // Consume before dispatch. Cancellation cannot authorize a second write.
    this.previewState = null; clearTimeout(this.timer); this.committing = true
    try { return await this.ports.write(preview.destination, cookies) }
    finally { for (const cookie of preview.cookies) cookie.value = ''; this.committing = false; this.cancel() }
  }
}
