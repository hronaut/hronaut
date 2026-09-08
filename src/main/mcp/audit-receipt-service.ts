import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { BrowserWorkspaceNavigationAuditSource } from '../../shared/types.js'
import type { WorkspaceNavigationDecision } from '../browser/workspace-navigation-policy.js'
import { AuditReceiptRun, type AuditReceiptActionOptions } from './audit-receipt-run.js'
import { AuditReceiptStore, type AuditReceiptEvent } from './audit-receipt-store.js'

const idSchema = z.uuid().transform(value => value.toLowerCase())
const metadataSchema = z.object({
  id: idSchema,
  startedAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().nullable(),
  status: z.enum(['recording', 'stopped']),
  persistenceFailed: z.boolean().nullable(),
  uncorrelatedSiteAccessDropped: z.number().int().nonnegative().safe().nullable()
}).strict()
const indexSchema = z.object({ workspaceId: idSchema, runs: z.array(metadataSchema).max(3) }).strict()
type Metadata = z.infer<typeof metadataSchema>
type Index = z.infer<typeof indexSchema>
export interface AuditRunSummary extends Omit<Metadata, 'status'> {
  status: 'recording' | 'stopping' | 'stopped' | 'interrupted'
}
interface ActiveRun {
  metadata: Metadata
  run: AuditReceiptRun
  originKey: Buffer
  stopping: boolean
}

/** One service per main process, shared by all MCP transport sessions.
 * Callers must authorize workspace access before invoking these methods.
 */
export class AuditReceiptService {
  private readonly active = new Map<string, ActiveRun>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly toolNames: ReadonlySet<string>
  private shuttingDown = false
  private shutdown: Promise<void> | undefined

  constructor(private readonly directory: string, toolNames: ReadonlySet<string>) {
    this.toolNames = new Set(toolNames)
  }

  start(workspaceId: string): Promise<AuditRunSummary> {
    const id = idSchema.parse(workspaceId)
    if (this.shuttingDown) return Promise.reject(new Error('Audit receipt service is shutting down'))
    return this.serialize(id, async () => {
      const current = this.active.get(id)
      if (current) {
        if (current.stopping) throw new Error('Audit run stop is incomplete; retry stopping before starting another run')
        return { ...current.metadata }
      }
      const index = await this.readIndex(id)
      const directory = this.workspacePath(id)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const known = new Set(index.runs.map(run => `${run.id}.jsonl`))
      for (const file of await readdir(directory)) {
        if (file.endsWith('.jsonl') && !known.has(file)) {
          // Never silently delete evidence whose index write was interrupted.
          throw new Error('Unindexed audit evidence requires recovery before starting another run')
        }
      }
      if (index.runs.length === 3) {
        const retired = index.runs.shift()!
        await this.saveIndex(id, index)
        await rm(this.journalPath(id, retired.id))
      }
      const metadata: Metadata = {
        id: randomUUID(), startedAt: new Date().toISOString(), stoppedAt: null,
        status: 'recording', persistenceFailed: null, uncorrelatedSiteAccessDropped: null
      }
      const path = this.journalPath(id, metadata.id)
      const handle = await open(path, 'wx', 0o600)
      try { await handle.sync() } finally { await handle.close() }
      index.runs.push(metadata)
      // If publication of metadata fails, retain the empty journal as evidence
      // of the interrupted start; future starts refuse rather than accumulate it.
      await this.saveIndex(id, index)
      this.active.set(id, {
        metadata, run: new AuditReceiptRun(id, this.store(id, metadata.id)), originKey: randomBytes(32), stopping: false
      })
      return { ...metadata }
    })
  }

  stop(workspaceId: string): Promise<AuditRunSummary | null> {
    const id = idSchema.parse(workspaceId)
    // Stop admissions immediately, even if a metadata operation is queued.
    const stopping = this.active.get(id)
    if (stopping) {
      stopping.stopping = true
      void stopping.run.stop()
    }
    return this.serialize(id, async () => {
      const current = this.active.get(id)
      if (!current) return null
      current.stopping = true
      await current.run.stop()
      const metadata: Metadata = { ...current.metadata, status: 'stopped', stoppedAt: new Date().toISOString() }
      try {
        const report = await current.run.report()
        metadata.persistenceFailed = report.persistenceFailed
        metadata.uncorrelatedSiteAccessDropped = report.uncorrelatedSiteAccessDropped
      } catch {
        metadata.persistenceFailed = true
        metadata.uncorrelatedSiteAccessDropped = null
      }
      const index = await this.readIndex(id)
      const position = index.runs.findIndex(run => run.id === metadata.id)
      if (position < 0) throw new Error('Active audit run metadata is missing')
      index.runs[position] = metadata
      await this.saveIndex(id, index)
      this.active.delete(id)
      current.originKey.fill(0)
      return { ...metadata }
    })
  }

  list(workspaceId: string): Promise<AuditRunSummary[]> {
    const id = idSchema.parse(workspaceId)
    return this.serialize(id, async () => (await this.readIndex(id)).runs.map(run => this.summary(id, run)))
  }

  read(workspaceId: string, runId: string): Promise<{
    formatVersion: 1
    scope: string
    caveats: string[]
    run: AuditRunSummary
    receipts: Awaited<ReturnType<AuditReceiptStore['read']>>
  }> {
    const id = idSchema.parse(workspaceId)
    const selected = idSchema.parse(runId)
    return this.serialize(id, async () => {
      const details = {
        formatVersion: 1 as const,
        scope: 'Workspace-scoped browser tools and observed site-policy decisions; audit-control, workspace-lifecycle and wallet tools are excluded.',
        caveats: [
          'Native site events without exact action context are uncorrelated, not attributed by timing.',
          'Possible effects do not establish rollback after failure or cancellation; none describes the invoked tool write classification.',
          'Null observations or completeness fields are unknown. Omitted site evidence is counted; interrupted actions are not replayed.',
          'Origin identifiers are opaque and stable only within one live run. The hash chain is not authentication against local file rewriting.',
          'Retention is three runs per workspace, each capped at 1000 entries and 1 MiB.'
        ]
      }
      const metadata = (await this.readIndex(id)).runs.find(run => run.id === selected)
      if (!metadata) throw new Error('Audit run is not retained in this workspace')
      await stat(this.journalPath(id, selected))
      const current = this.active.get(id)
      if (current?.metadata.id === selected) {
        const report = await current.run.report()
        return {
          ...details,
          run: { ...this.summary(id, metadata), persistenceFailed: report.persistenceFailed,
            uncorrelatedSiteAccessDropped: report.uncorrelatedSiteAccessDropped },
          receipts: report.receipts
        }
      }
      return { ...details, run: this.summary(id, metadata), receipts: await this.store(id, selected).read() }
    })
  }

  execute<T>(workspaceId: string, options: AuditReceiptActionOptions<T>): Promise<T> {
    if (this.shuttingDown) return Promise.reject(new Error('Audit receipt service is shutting down'))
    const current = this.active.get(idSchema.parse(workspaceId))
    return current ? current.run.execute(options) : options.operation()
  }

  recordSiteAccess(workspaceId: string, decision: WorkspaceNavigationDecision,
    source: BrowserWorkspaceNavigationAuditSource, state: AuditReceiptEvent['state'] = null): boolean {
    const parsed = idSchema.safeParse(workspaceId)
    if (!parsed.success) return false
    const id = parsed.data
    const current = this.active.get(id)
    if (!current) return false
    // Stable only within this live run, with no retained origin strings or key.
    const bytes = createHmac('sha256', current.originKey).update(decision.targetOrigin).digest().subarray(0, 16)
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = bytes.toString('hex')
    const originId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    return current.run.recordSiteAccess(id, {
      decision: decision.allowed ? 'allowed' : 'denied', reason: decision.reason, source, originId, state
    })
  }

  stopAll(): Promise<void> {
    this.shuttingDown = true
    this.shutdown ??= (async () => {
      await Promise.allSettled([...this.queues.values()])
      await Promise.all([...this.active.keys()].map(workspaceId => this.stop(workspaceId)))
    })()
    return this.shutdown
  }

  private summary(workspaceId: string, metadata: Metadata): AuditRunSummary {
    const current = this.active.get(workspaceId)
    if (current?.metadata.id === metadata.id && current.stopping) return { ...metadata, status: 'stopping' }
    if (metadata.status === 'recording' && this.active.get(workspaceId)?.metadata.id !== metadata.id) {
      return { ...metadata, status: 'interrupted', persistenceFailed: null, uncorrelatedSiteAccessDropped: null }
    }
    return { ...metadata }
  }

  private store(workspaceId: string, runId: string): AuditReceiptStore {
    return new AuditReceiptStore({ path: this.journalPath(workspaceId, runId), workspaceId, runId, toolNames: this.toolNames })
  }

  private workspacePath(workspaceId: string): string { return join(this.directory, workspaceId) }
  private journalPath(workspaceId: string, runId: string): string { return join(this.workspacePath(workspaceId), `${runId}.jsonl`) }

  private async readIndex(workspaceId: string): Promise<Index> {
    let handle
    try { handle = await open(join(this.workspacePath(workspaceId), 'index.json'), 'r') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workspaceId, runs: [] }
      throw new Error('Audit run metadata is unavailable')
    }
    try {
      const buffer = Buffer.alloc(16_385)
      let bytes = 0
      while (bytes < buffer.length) {
        const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes)
        if (!result.bytesRead) break
        bytes += result.bytesRead
      }
      if (bytes > 16_384) throw new Error()
      const index = indexSchema.parse(JSON.parse(buffer.subarray(0, bytes).toString('utf8')))
      if (index.workspaceId !== workspaceId || new Set(index.runs.map(run => run.id)).size !== index.runs.length) throw new Error()
      return index
    } catch { throw new Error('Audit run metadata verification failed') } finally { await handle.close() }
  }

  private async saveIndex(workspaceId: string, index: Index): Promise<void> {
    const directory = this.workspacePath(workspaceId)
    const temporary = join(directory, `${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(indexSchema.parse(index)))
        await handle.sync()
      } finally { await handle.close() }
      await rename(temporary, join(directory, 'index.json'))
      if (process.platform !== 'win32') {
        const folder = await open(directory, 'r')
        try { await folder.sync() } finally { await folder.close() }
      }
    } finally { await rm(temporary, { force: true }) }
  }

  private serialize<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.queues.set(workspaceId, current)
    void current.then(() => {
      if (this.queues.get(workspaceId) === current) this.queues.delete(workspaceId)
    }, () => {
      if (this.queues.get(workspaceId) === current) this.queues.delete(workspaceId)
    })
    return current
  }
}
