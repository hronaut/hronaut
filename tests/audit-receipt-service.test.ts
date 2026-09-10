import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditReceiptService } from '../src/main/mcp/audit-receipt-service.js'
import { AuditReceiptStore } from '../src/main/mcp/audit-receipt-store.js'

const diskFault = vi.hoisted(() => ({ failTemporaryWrite: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (diskFault.failTemporaryWrite && String(args[0]).endsWith('.tmp')) {
        Object.defineProperty(handle, 'writeFile', { value: async () => { throw new Error('Injected metadata write failure') } })
      }
      return handle
    }
  }
})

const directories: string[] = []
afterEach(async () => {
  diskFault.failTemporaryWrite = false
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-audit-service-'))
  directories.push(directory)
  const root = join(directory, 'receipts')
  const toolNames = new Set(['browser_click'])
  return { root, toolNames, workspaceId: randomUUID(), service: new AuditReceiptService(root, toolNames) }
}
function action<T>(operation: () => Promise<T>) {
  return { toolName: 'browser_click', readOnly: false, observeState: () => null, operation, isErrorResult: () => false }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('persistent audit receipt service', () => {
  it('exports bounded coverage and resolves opaque references only inside their retained workspace run', async () => {
    const { service, workspaceId } = await fixture()
    const run = await service.start(workspaceId)
    const referenceId = randomUUID()
    const tabId = randomUUID()
    await service.execute(workspaceId, {
      ...action(async () => 'done'),
      observeEvidence: () => ({
        state: { tabId, navigationGeneration: 2, observationGeneration: 3,
          humanInteractionGeneration: 0, controlRevision: 5, originChanged: false },
        artifacts: [
          { source: 'diagnostic', status: 'available', reason: 'retained', referenceId },
          { source: 'storage-changes', status: 'not-collected', reason: 'baseline-missing', referenceId: null }
        ]
      })
    })
    await service.stop(workspaceId)
    const report = await service.read(workspaceId, run.id)
    expect(report.formatVersion).toBe(2)
    expect(report.evidenceCoverage).toMatchObject({ limit: 1_000, omitted: 0 })
    expect(report.evidenceCoverage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: expect.any(String), source: 'diagnostic', status: 'available', referenceId,
        state: expect.objectContaining({ tabId, observationGeneration: 3, controlRevision: 5 }) }),
      expect.objectContaining({ source: 'storage-changes', status: 'not-collected', reason: 'baseline-missing', referenceId: null })
    ]))
    expect(await service.evidence(workspaceId, run.id, referenceId)).toMatchObject({ source: 'diagnostic', referenceId })
    await expect(service.evidence(workspaceId, run.id, randomUUID())).rejects.toThrow('not retained')
    await expect(service.evidence(randomUUID(), run.id, referenceId)).rejects.toThrow('not retained')
  })

  it('drains a start already queued at shutdown and refuses later starts', async () => {
    const { service, workspaceId } = await fixture()
    const starting = service.start(workspaceId)
    const shutdown = service.stopAll()
    await Promise.all([starting, shutdown])
    expect((await service.list(workspaceId))[0]!.status).toBe('stopped')
    await expect(service.start(randomUUID())).rejects.toThrow('shutting down')
  })

  it('cleans failed metadata writes and reports a stopped writer awaiting persistence honestly', async () => {
    const { service, root, workspaceId } = await fixture()
    await service.start(workspaceId)
    diskFault.failTemporaryWrite = true
    await expect(service.stop(workspaceId)).rejects.toThrow('Injected metadata write failure')
    expect((await readdir(join(root, workspaceId))).filter(name => name.endsWith('.tmp'))).toEqual([])
    expect((await service.list(workspaceId))[0]!.status).toBe('stopping')
    await expect(service.start(workspaceId)).rejects.toThrow('stop is incomplete')
    diskFault.failTemporaryWrite = false
    expect((await service.stop(workspaceId))?.status).toBe('stopped')
  })

  it('does not create storage until explicitly started', async () => {
    const { service, root, workspaceId } = await fixture()
    expect(await service.list(workspaceId)).toEqual([])
    expect(await service.execute(workspaceId, action(async () => 'result'))).toBe('result')
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not dispatch a verification-bound mutation after its audit run disappears', async () => {
    const { service, workspaceId } = await fixture()
    const operation = vi.fn(async () => 'changed')
    await expect(service.execute(workspaceId, {
      ...action(operation),
      verification: { verificationId: randomUUID(), maxAttempts: 1, verify: async () => undefined }
    })).rejects.toThrow('active audit receipt run')
    expect(operation).not.toHaveBeenCalled()
  })

  it('uses one writer for concurrent starts and persists stopped state across restart', async () => {
    const { service, root, toolNames, workspaceId } = await fixture()
    const [first, second] = await Promise.all([service.start(workspaceId), service.start(workspaceId)])
    expect(first.id).toBe(second.id)
    await service.execute(workspaceId, action(async () => 'done'))
    expect((await service.stop(workspaceId))?.status).toBe('stopped')
    const reopened = new AuditReceiptService(root, toolNames)
    const report = await reopened.read(workspaceId, first.id)
    expect(report.run).toMatchObject({ status: 'stopped', persistenceFailed: false, uncorrelatedSiteAccessDropped: 0 })
    expect(report.receipts).toHaveLength(2)
    expect(await reopened.stop(workspaceId)).toBeNull()
    if (process.platform !== 'win32') {
      expect((await stat(join(root, workspaceId))).mode & 0o777).toBe(0o700)
      expect((await stat(join(root, workspaceId, 'index.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('reports an unclosed run as interrupted without replaying or claiming complete evidence', async () => {
    const { service, root, toolNames, workspaceId } = await fixture()
    const run = await service.start(workspaceId)
    const operation = vi.fn(async () => 'done')
    await service.execute(workspaceId, action(operation))
    const reopened = new AuditReceiptService(root, toolNames)
    expect((await reopened.read(workspaceId, run.id)).run).toMatchObject({
      status: 'interrupted', persistenceFailed: null, uncorrelatedSiteAccessDropped: null
    })
    expect(operation).toHaveBeenCalledTimes(1)
    const fresh = await reopened.start(workspaceId)
    expect(fresh.id).not.toBe(run.id)
    expect((await reopened.list(workspaceId))[0]!.status).toBe('interrupted')
    await reopened.stop(workspaceId)
  })

  it('durably resolves verification left pending by a process restart as unknown', async () => {
    const { service, root, toolNames, workspaceId } = await fixture()
    const run = await service.start(workspaceId)
    const store = new AuditReceiptStore({
      path: join(root, workspaceId, `${run.id}.jsonl`), workspaceId, runId: run.id, toolNames
    })
    const actionId = randomUUID()
    const verificationId = randomUUID()
    await store.append({ phase: 'decision', scope: 'workspace', actionId, toolName: 'browser_click', decision: 'allowed', state: null })
    await store.append({ phase: 'verification', actionId, verificationId, maxAttempts: 3, attempt: 0, status: 'pending', reason: 'awaiting-read' })
    await store.append({ phase: 'outcome', actionId, status: 'succeeded', effects: 'possible', siteAccessDropped: 0, state: null })

    const reopened = new AuditReceiptService(root, toolNames)
    const first = await reopened.read(workspaceId, run.id)
    expect(first.run.status).toBe('interrupted')
    expect(first.receipts.at(-1)!.event).toMatchObject({
      phase: 'verification', actionId, verificationId, status: 'unknown', reason: 'restart', attempt: 0
    })
    const second = await reopened.read(workspaceId, run.id)
    expect(second.receipts).toHaveLength(first.receipts.length)
    expect(second.evidenceCoverage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId, source: 'postcondition', status: 'expired', reason: 'restart', referenceId: null })
    ]))
  })

  it('exports the exact drop cause and OUTCOME_UNKNOWN transition coverage', async () => {
    const { service, root, toolNames, workspaceId } = await fixture()
    const run = await service.start(workspaceId)
    const store = new AuditReceiptStore({
      path: join(root, workspaceId, `${run.id}.jsonl`), workspaceId, runId: run.id, toolNames
    })
    const actionId = randomUUID()
    await store.append({
      phase: 'decision', scope: 'workspace', actionId, toolName: 'browser_click',
      decision: 'allowed', evidenceExpected: true, state: null
    })
    await store.append({
      phase: 'outcome', actionId, status: 'outcome-unknown', effects: 'possible', siteAccessDropped: 0,
      evidenceDropped: 1, evidenceDropReason: 'persistence-failed', state: null
    })

    const report = await new AuditReceiptService(root, toolNames).read(workspaceId, run.id)
    expect(report.transitionCoverage.outcomeUnknown).toBe(1)
    expect(report.evidenceCoverage.items.filter(item => item.actionId === actionId)).toHaveLength(5)
    expect(report.evidenceCoverage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId, source: 'diagnostic', status: 'dropped', reason: 'persistence-failed' })
    ]))
  })

  it('retains exactly three whole runs and never exposes another workspace run', async () => {
    const { service, root, workspaceId } = await fixture()
    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      ids.push((await service.start(workspaceId)).id)
      await service.execute(workspaceId, action(async () => true))
      await service.stop(workspaceId)
    }
    expect((await service.list(workspaceId)).map(run => run.id)).toEqual(ids.slice(1))
    expect((await readdir(join(root, workspaceId))).filter(name => name.endsWith('.jsonl'))).toHaveLength(3)
    await expect(service.read(workspaceId, ids[0]!)).rejects.toThrow('not retained')
    await expect(service.read(randomUUID(), ids[3]!)).rejects.toThrow('not retained')
  })

  it('keeps opaque origins stable within one run but unrelated across runs and excludes raw policy data', async () => {
    const { service, root, workspaceId } = await fixture()
    const policy = { allowed: false, reason: 'no-match' as const, targetOrigin: 'https://private-origin-canary.test', matchedRule: 'private-rule-canary' }
    const first = await service.start(workspaceId)
    await service.execute(workspaceId, action(async () => {
      service.recordSiteAccess(workspaceId, policy, 'direct')
      service.recordSiteAccess(workspaceId, policy, 'redirect')
    }))
    await service.stop(workspaceId)
    const initial = await service.read(workspaceId, first.id)
    const origins = initial.receipts.filter(entry => entry.event.phase === 'site-access').map(entry => (
      entry.event.phase === 'site-access' ? entry.event.originId : ''
    ))
    expect(origins).toHaveLength(2)
    expect(origins[0]).toBe(origins[1])
    const second = await service.start(workspaceId)
    service.recordSiteAccess(workspaceId, policy, 'page')
    await service.stop(workspaceId)
    const later = (await service.read(workspaceId, second.id)).receipts[0]!.event
    expect(later).toMatchObject({ phase: 'site-access', actionId: null })
    expect(later).not.toMatchObject({ originId: origins[0] })
    const coverage = (await service.read(workspaceId, second.id)).evidenceCoverage.items
    expect(coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: null, source: 'site-access', status: 'uncorrelated', reason: 'action-context-missing' })
    ]))
    for (const name of await readdir(join(root, workspaceId))) {
      const contents = await readFile(join(root, workspaceId, name), 'utf8')
      expect(contents).not.toContain('private-origin-canary')
      expect(contents).not.toContain('private-rule-canary')
    }
  })

  it('stops admissions immediately and does not block another workspace while draining', async () => {
    const { service, workspaceId } = await fixture()
    await service.start(workspaceId)
    const entered = deferred()
    const finish = deferred()
    const pending = service.execute(workspaceId, action(async () => { entered.resolve(); await finish.promise }))
    await entered.promise
    const stopping = service.stop(workspaceId)
    await expect(service.execute(workspaceId, action(async () => true))).rejects.toThrow('stopping or stopped')
    const other = randomUUID()
    expect((await service.start(other)).status).toBe('recording')
    await service.stop(other)
    finish.resolve()
    await Promise.all([pending, stopping])
  })

  it.each(['../escape', 'not-an-id', ''])('rejects invalid workspace identifiers before filesystem access: %s', async (id) => {
    const { service, root } = await fixture()
    expect(() => service.start(id)).toThrow()
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['oversized', 'foreign'])('preserves %s metadata instead of resetting it', async (kind) => {
    const { service, root, workspaceId } = await fixture()
    await service.start(workspaceId)
    await service.stop(workspaceId)
    const path = join(root, workspaceId, 'index.json')
    const text = kind === 'oversized' ? 'x'.repeat(16_385) : JSON.stringify({ workspaceId: randomUUID(), runs: [] })
    await writeFile(path, text)
    await expect(service.start(workspaceId)).rejects.toThrow('verification failed')
    expect(await readFile(path, 'utf8')).toBe(text)
  })

  it('preserves unindexed journals and refuses repeated starts that could grow storage indefinitely', async () => {
    const { service, root, workspaceId } = await fixture()
    await service.start(workspaceId)
    await service.stop(workspaceId)
    const orphan = join(root, workspaceId, `${randomUUID()}.jsonl`)
    await writeFile(orphan, 'unindexed-evidence')
    const before = await readdir(join(root, workspaceId))
    await expect(service.start(workspaceId)).rejects.toThrow('requires recovery')
    await expect(service.start(workspaceId)).rejects.toThrow('requires recovery')
    expect(await readdir(join(root, workspaceId))).toEqual(before)
    expect(await readFile(orphan, 'utf8')).toBe('unindexed-evidence')
  })
})
