import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditReceiptRun } from '../src/main/mcp/audit-receipt-run.js'
import { AuditReceiptStore } from '../src/main/mcp/audit-receipt-store.js'
import { currentAuditAction } from '../src/main/mcp/audit-action-context.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-audit-run-'))
  directories.push(directory)
  const workspaceId = randomUUID()
  const store = new AuditReceiptStore({
    path: join(directory, 'run.jsonl'), workspaceId, runId: randomUUID(),
    toolNames: new Set(['browser_click'])
  })
  return { store, workspaceId, run: new AuditReceiptRun(workspaceId, store) }
}

function action<T>(operation: () => Promise<T>) {
  return { toolName: 'browser_click', readOnly: false, observeState: () => null, operation, isErrorResult: () => false }
}

describe('audit receipt run lifecycle', () => {
  it('recognizes cancellation when the MCP handler converts it into an error result', async () => {
    const { run } = await fixture()
    const abort = new AbortController()
    const result = { isError: true }
    expect(await run.execute({
      ...action(async () => { abort.abort(); return result }),
      signal: abort.signal, isErrorResult: value => value.isError
    })).toBe(result)
    expect((await run.report()).receipts.at(-1)!.event).toMatchObject({ status: 'cancelled', effects: 'possible' })
  })

  it('keeps a successful result successful when cancellation arrives after its work', async () => {
    const { run } = await fixture()
    const abort = new AbortController()
    await run.execute({ ...action(async () => { abort.abort(); return 'done' }), signal: abort.signal })
    expect((await run.report()).receipts.at(-1)!.event).toMatchObject({ status: 'succeeded' })
  })

  const site = () => ({
    decision: 'denied' as const, reason: 'no-match' as const, source: 'redirect' as const,
    originId: randomUUID(), state: null
  })

  it('persists site decisions before their outcome and rejects another workspace', async () => {
    const { run, workspaceId } = await fixture()
    const observation = site()
    await run.execute(action(async () => {
      expect(run.recordSiteAccess(randomUUID(), observation)).toBe(false)
      expect(run.recordSiteAccess(workspaceId, observation)).toBe(true)
      observation.originId = randomUUID()
    }))
    const { receipts } = await run.report()
    expect(receipts.map(receipt => receipt.event.phase)).toEqual(['decision', 'site-access', 'outcome'])
    expect(receipts[1]!.event.actionId).toBe(receipts[0]!.event.actionId)
    expect(receipts[1]!.event).not.toMatchObject({ originId: observation.originId })
    expect(receipts[2]!.event).toMatchObject({ siteAccessDropped: 0 })
  })

  it('bounds pending writes and records omitted site evidence in the action outcome', async () => {
    const { run, workspaceId } = await fixture()
    await run.execute(action(async () => {
      const accepted = Array.from({ length: 70 }, () => run.recordSiteAccess(workspaceId, site()))
      expect(accepted.filter(Boolean)).toHaveLength(64)
    }))
    const { receipts } = await run.report()
    expect(receipts.filter(receipt => receipt.event.phase === 'site-access')).toHaveLength(64)
    expect(receipts.at(-1)!.event).toMatchObject({ siteAccessDropped: 6 })
  })

  it('counts a failed site append without changing the browser operation result', async () => {
    const { workspaceId, store } = await fixture()
    const run = new AuditReceiptRun(workspaceId, {
      read: () => store.read(),
      append: event => event.phase === 'site-access' ? Promise.reject(new Error('Disk full')) : store.append(event)
    })
    expect(await run.execute(action(async () => {
      run.recordSiteAccess(workspaceId, site())
      return 'operation result'
    }))).toBe('operation result')
    expect((await run.report()).receipts.at(-1)!.event).toMatchObject({ siteAccessDropped: 1 })
  })

  it('records native observations without guessing a pending action and drains them at stop', async () => {
    const { run, workspaceId } = await fixture()
    const entered = deferred<void>()
    const complete = deferred<void>()
    const pending = run.execute(action(async () => { entered.resolve(); await complete.promise }))
    await entered.promise
    expect(run.recordSiteAccess(workspaceId, site())).toBe(true)
    complete.resolve()
    await pending
    await run.stop()
    expect(run.recordSiteAccess(workspaceId, site())).toBe(false)
    const event = (await run.report()).receipts.find(receipt => receipt.event.phase === 'site-access')!.event
    expect(event.actionId).toBeNull()
  })

  it('finishes correlated site writes while stopping a pending action', async () => {
    const { run, workspaceId } = await fixture()
    const entered = deferred<void>()
    const complete = deferred<void>()
    const pending = run.execute(action(async () => {
      entered.resolve()
      await complete.promise
      expect(run.recordSiteAccess(workspaceId, site())).toBe(true)
    }))
    await entered.promise
    const stopping = run.stop()
    complete.resolve()
    await Promise.all([pending, stopping])
    expect((await run.report()).receipts.map(receipt => receipt.event.phase)).toEqual(['decision', 'site-access', 'outcome'])
  })

  it('reports uncorrelated omissions without assigning them to another action', async () => {
    const { workspaceId } = await fixture()
    const run = new AuditReceiptRun(workspaceId, {
      read: async () => [], append: async () => { throw new Error('Capacity reached') }
    })
    expect(run.recordSiteAccess(workspaceId, site())).toBe(true)
    expect((await run.report()).uncorrelatedSiteAccessDropped).toBe(1)
  })

  it('persists admission before invoking an action and returns its result without storing it', async () => {
    const { run, store, workspaceId } = await fixture()
    const result = { private: 'secret-result-canary' }
    expect(await run.execute(action(async () => {
      const entries = await store.read()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.event.actionId).toBe(currentAuditAction(workspaceId))
      return result
    }))).toBe(result)
    const report = await run.report()
    expect(report.receipts.at(-1)!.event).toMatchObject({ status: 'succeeded', effects: 'possible' })
    expect(JSON.stringify(report)).not.toContain('secret-result-canary')
  })

  it('stops new admissions synchronously while allowing a pending action to settle exactly once', async () => {
    const { run } = await fixture()
    const entered = deferred<void>()
    const complete = deferred<string>()
    const operation = vi.fn(async () => { entered.resolve(); return complete.promise })
    const pending = run.execute(action(operation))
    await entered.promise
    let stopped = false
    const stopping = run.stop().then(() => { stopped = true })
    await expect(run.execute(action(operation))).rejects.toThrow('stopping or stopped')
    expect(stopped).toBe(false)
    complete.resolve('done')
    expect(await pending).toBe('done')
    await stopping
    await run.stop()
    expect(operation).toHaveBeenCalledTimes(1)
    expect((await run.report()).receipts).toHaveLength(2)
  })

  it('does not invoke the operation if admission cannot be saved', async () => {
    const operation = vi.fn(async () => true)
    const run = new AuditReceiptRun(randomUUID(), {
      append: vi.fn(async () => { throw new Error('Storage unavailable') }), read: async () => []
    })
    await expect(run.execute(action(operation))).rejects.toThrow('Storage unavailable')
    expect(operation).not.toHaveBeenCalled()
    await run.stop()
  })

  it('preserves a failed operation error without putting it into receipts or claiming rollback', async () => {
    const { run } = await fixture()
    const cause = new Error('private-error-canary')
    await expect(run.execute(action(async () => { throw cause }))).rejects.toBe(cause)
    const report = await run.report()
    expect(report.receipts.at(-1)!.event).toMatchObject({ status: 'failed', effects: 'possible' })
    expect(JSON.stringify(report)).not.toContain('private-error-canary')
  })

  it('records error results and unavailable state without inventing observations', async () => {
    const { run } = await fixture()
    await run.execute({
      ...action(async () => ({ isError: true })), readOnly: true,
      isErrorResult: result => result.isError,
      observeState: () => { throw new Error('Tab closed') }
    })
    expect((await run.report()).receipts.at(-1)!.event).toMatchObject({ status: 'failed', state: null, effects: 'none' })
  })

  it('records cancellation conservatively after an operation starts', async () => {
    const { run } = await fixture()
    const abort = new AbortController()
    await expect(run.execute({ ...action(async () => {
      abort.abort()
      throw new Error('Cancelled')
    }), signal: abort.signal })).rejects.toThrow('Cancelled')
    expect((await run.report()).receipts.at(-1)!.event).toMatchObject({ status: 'cancelled', effects: 'possible' })
  })

  it('does not replay an operation when outcome persistence fails, and blocks later admissions', async () => {
    const { store, workspaceId } = await fixture()
    const run = new AuditReceiptRun(workspaceId, {
      read: () => store.read(),
      append: event => event.phase === 'outcome' ? Promise.reject(new Error('private-storage-canary')) : store.append(event)
    })
    const operation = vi.fn(async () => true)
    await expect(run.execute(action(operation))).rejects.toThrow('do not automatically retry')
    await expect(run.execute(action(operation))).rejects.toThrow('persistence is unavailable')
    expect(operation).toHaveBeenCalledTimes(1)
    expect((await run.report()).persistenceFailed).toBe(true)
    expect((await run.report()).receipts).toHaveLength(1)
  })
})
