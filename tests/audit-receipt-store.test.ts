import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditReceiptStore, type AuditReceiptEvent } from '../src/main/mcp/audit-receipt-store.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(limits: { maxEntries?: number; maxBytes?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-receipts-'))
  directories.push(directory)
  const options = {
    path: join(directory, 'run.jsonl'),
    workspaceId: randomUUID(),
    runId: randomUUID(),
    toolNames: new Set(['browser_click', 'browser_snapshot']),
    ...limits
  }
  return { options, store: new AuditReceiptStore(options) }
}

function decision(actionId = randomUUID()): Extract<AuditReceiptEvent, { phase: 'decision' }> {
  return {
    phase: 'decision', scope: 'workspace', actionId, toolName: 'browser_click', decision: 'allowed',
    state: { tabId: randomUUID(), navigationGeneration: 1, originChanged: false }
  }
}

function outcome(actionId: string): Extract<AuditReceiptEvent, { phase: 'outcome' }> {
  return {
    phase: 'outcome', actionId, status: 'cancelled', effects: 'possible', siteAccessDropped: 0,
    state: { tabId: null, navigationGeneration: 2, originChanged: true }
  }
}

function evidence(actionId: string): Extract<AuditReceiptEvent, { phase: 'evidence' }> {
  return {
    phase: 'evidence', actionId,
    artifacts: [{ source: 'diagnostic', status: 'available', reason: 'retained', referenceId: randomUUID() }],
    state: { tabId: randomUUID(), navigationGeneration: 1, observationGeneration: 2,
      humanInteractionGeneration: 0, controlRevision: 3, originChanged: false }
  }
}

describe('action audit receipt journal', () => {
  it('distinguishes workspace admission, correlated site denials and an unavailable final state', async () => {
    const { store, options } = await fixture()
    const start = decision()
    await store.append(start)
    const site: AuditReceiptEvent = {
      phase: 'site-access', actionId: start.actionId, decision: 'denied', reason: 'no-match',
      source: 'redirect', originId: randomUUID(), state: null
    }
    await store.append(site)
    await store.append({ ...outcome(start.actionId), status: 'failed', state: null, siteAccessDropped: 2 })
    const entries = await new AuditReceiptStore(options).read()
    expect(entries.map(entry => entry.event.phase)).toEqual(['decision', 'site-access', 'outcome'])
    expect(entries[1]!.event).toEqual(site)
    expect(entries[2]!.event).toMatchObject({ state: null, effects: 'possible', siteAccessDropped: 2 })
  })

  it('retains bounded action-authority facts without raw page content or target values', async () => {
    const { store } = await fixture()
    const start = decision()
    start.state = {
      ...start.state!, operationClass: 'page-interaction', targetKind: 'element-ref',
      targetId: randomUUID()
    }
    await store.append(start)
    await store.append({
      ...outcome(start.actionId), status: 'provenance-rejected', effects: 'none',
      state: { ...start.state!, originChanged: true, authorityReason: 'ORIGIN_CHANGED' }
    })
    const report = await store.read()
    expect(report.map(entry => entry.event)).toEqual([
      expect.objectContaining({ state: expect.objectContaining({ operationClass: 'page-interaction', targetKind: 'element-ref' }) }),
      expect.objectContaining({ status: 'provenance-rejected', effects: 'none', state: expect.objectContaining({ authorityReason: 'ORIGIN_CHANGED' }) })
    ])
    expect(JSON.stringify(report)).not.toMatch(/trusted\.example|Ignore previous instructions|element-selector-canary/)
  })

  it('keeps uncorrelated native decisions explicit and rejects false action attribution', async () => {
    const { store } = await fixture()
    const native: AuditReceiptEvent = {
      phase: 'site-access', actionId: null, decision: 'allowed', reason: 'matched',
      source: 'page', originId: randomUUID(), state: null
    }
    await store.append(native)
    await expect(store.append({ ...native, actionId: randomUUID() })).rejects.toThrow('transition')
    const start = decision()
    await store.append(start)
    await store.append(outcome(start.actionId))
    await expect(store.append({ ...native, actionId: start.actionId })).rejects.toThrow('transition')
    expect((await store.read())[0]!.event.actionId).toBeNull()
  })

  it('does not let site events consume reserved outcome capacity', async () => {
    const { store } = await fixture({ maxEntries: 2 })
    const start = decision()
    await store.append(start)
    await expect(store.append({
      phase: 'site-access', actionId: start.actionId, decision: 'allowed', reason: 'matched',
      source: 'direct', originId: randomUUID(), state: null
    })).rejects.toThrow('capacity reached')
    await store.append({ ...outcome(start.actionId), siteAccessDropped: 1 })
    expect((await store.read()).at(-1)!.event).toMatchObject({ siteAccessDropped: 1 })
  })

  it('reserves coverage and outcome capacity before dispatch and accepts delayed evidence for the same action', async () => {
    const { store } = await fixture({ maxEntries: 3 })
    const start = { ...decision(), evidenceExpected: true }
    await store.append(start)
    await expect(store.append({
      phase: 'site-access', actionId: start.actionId, decision: 'allowed', reason: 'matched',
      source: 'direct', originId: randomUUID(), state: null
    })).rejects.toThrow('capacity reached')
    await store.append(outcome(start.actionId))
    await store.append(evidence(start.actionId))
    expect((await store.read()).map(entry => entry.event.phase)).toEqual(['decision', 'outcome', 'evidence'])
    await expect(store.append(evidence(start.actionId))).rejects.toThrow('transition')
  })

  it('reserves the remaining entry for an accepted action outcome across reopening', async () => {
    const { store, options } = await fixture({ maxEntries: 2 })
    const start = decision()
    await store.append(start)
    const reopened = new AuditReceiptStore(options)
    await expect(reopened.append(decision())).rejects.toThrow('capacity reached')
    await reopened.append(outcome(start.actionId))
    expect(await reopened.read()).toHaveLength(2)
  })

  it('reserves enough bytes for the largest pending outcome while rejecting new decisions', async () => {
    const { store, options } = await fixture({ maxBytes: 2300 })
    const start = decision()
    await store.append(start)
    // A denial is terminal but must not consume a running action's reservation.
    const denied = () => ({ ...decision(), decision: 'denied' }) as AuditReceiptEvent
    await store.append(denied())
    await expect(store.append(denied())).rejects.toThrow('capacity reached')
    const end = outcome(start.actionId)
    if (end.phase !== 'outcome') throw new Error('Expected outcome fixture')
    end.status = 'stale-observation'
    end.effects = 'confirmed'
    end.siteAccessDropped = Number.MAX_SAFE_INTEGER
    end.state = {
      tabId: randomUUID(), navigationGeneration: Number.MAX_SAFE_INTEGER,
      observationGeneration: Number.MAX_SAFE_INTEGER, humanInteractionGeneration: Number.MAX_SAFE_INTEGER,
      originChanged: false,
      operationClass: 'page-interaction', targetKind: 'coordinates', targetId: randomUUID(),
      authorityReason: 'EXPECTED_STATE_CHANGED'
    }
    await store.append(end)
    expect((await stat(options.path)).size).toBeLessThanOrEqual(2300)
    expect((await store.read()).at(-1)!.event).toEqual(end)
  })

  it.each(['orphan', 'duplicate', 'denied'] as const)('rejects hash-valid %s transitions when reopening', async (kind) => {
    const { store, options } = await fixture()
    const start = decision()
    const first = await store.append(start)
    const events = kind === 'orphan' ? [outcome(start.actionId)]
      : kind === 'duplicate' ? [start, start]
        : [{ ...start, decision: 'denied' }, outcome(start.actionId)]
    let previousHash = ''
    const lines = events.map((event, index) => {
      const { hash: _hash, ...original } = first
      const body = { ...original, sequence: index + 1, event, previousHash }
      const hash = createHash('sha256').update('hronaut-action-receipt-v1\0').update(JSON.stringify(body)).digest('hex')
      previousHash = hash
      return JSON.stringify({ ...body, hash })
    }).join('\n') + '\n'
    await writeFile(options.path, lines)
    await expect(new AuditReceiptStore(options).read()).rejects.toThrow('verification failed')
    expect(await readFile(options.path, 'utf8')).toBe(lines)
  })

  it('is opt-in at the call site and creates no files on construction or an empty read', async () => {
    const { store, options } = await fixture()
    expect(await store.read()).toEqual([])
    await expect(stat(options.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves correlated decisions and partial cancellation across reopening', async () => {
    const { store, options } = await fixture()
    const start = decision()
    const first = await store.append(start)
    const initialBytes = await readFile(options.path)
    const second = await store.append(outcome(start.actionId))
    expect(second.previousHash).toBe(first.hash)
    expect(second.sequence).toBe(2)
    expect((await readFile(options.path)).subarray(0, initialBytes.length)).toEqual(initialBytes)
    expect(await new AuditReceiptStore(options).read()).toEqual([first, second])
    if (process.platform !== 'win32') expect((await stat(options.path)).mode & 0o777).toBe(0o600)
  })

  it('serializes concurrent appends and snapshots inputs before queueing', async () => {
    const { store } = await fixture()
    const input = decision()
    const first = store.append(input)
    input.state!.navigationGeneration = 99
    const rest = Array.from({ length: 8 }, () => store.append(decision()))
    const entries = await Promise.all([first, ...rest])
    expect(entries.map(entry => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const firstEvent = entries[0]!.event
    if (firstEvent.phase !== 'decision') throw new Error('Expected decision receipt')
    expect(firstEvent.state!.navigationGeneration).toBe(1)
    firstEvent.state!.navigationGeneration = 500
    const reloaded = (await store.read())[0]!.event
    if (reloaded.phase !== 'decision') throw new Error('Expected persisted decision receipt')
    expect(reloaded.state!.navigationGeneration).toBe(1)
  })

  it.each(['arguments', 'result', 'error', 'url', 'password', 'resumeKey'])('rejects unallowlisted %s without writing or echoing its value', async (field) => {
    const { store, options } = await fixture()
    await expect(store.append({ ...decision(), [field]: 'private-canary' } as AuditReceiptEvent))
      .rejects.toThrow('Invalid audit receipt event')
    await expect(stat(options.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects arbitrary tool names, non-generated identifiers and nested page data', async () => {
    const { store } = await fixture()
    const input = decision()
    for (const candidate of [
      { ...input, toolName: 'browser_private_token' },
      { ...input, actionId: 'private-canary' },
      { ...input, state: { ...input.state, title: 'private-canary' } }
    ]) await expect(store.append(candidate as AuditReceiptEvent)).rejects.toThrow('Invalid audit receipt event')
    expect(await store.read()).toEqual([])
  })

  it('rejects orphan, repeated and denied-action outcomes without poisoning the queue', async () => {
    const { store } = await fixture()
    const start = decision()
    await expect(store.append(outcome(start.actionId))).rejects.toThrow('transition')
    await store.append(start)
    await expect(store.append(start)).rejects.toThrow('transition')
    await store.append(outcome(start.actionId))
    await expect(store.append(outcome(start.actionId))).rejects.toThrow('transition')
    const denied = { ...decision(), decision: 'denied' } as ReturnType<typeof decision>
    await store.append(denied)
    await expect(store.append(outcome(denied.actionId))).rejects.toThrow('transition')
    expect(await store.read()).toHaveLength(3)
  })

  it('rejects a provenance outcome that claims possible or confirmed effects', async () => {
    const { store } = await fixture()
    for (const effects of ['possible', 'confirmed'] as const) {
      const start = decision()
      await store.append(start)
      await expect(store.append({ ...outcome(start.actionId), status: 'provenance-rejected', effects }))
        .rejects.toThrow('transition')
      await store.append({ ...outcome(start.actionId), status: 'provenance-rejected', effects: 'none' })
    }
  })

  it.each(['workspaceId', 'runId'] as const)('rejects reading or extending a different %s', async (field) => {
    const { store, options } = await fixture()
    await store.append(decision())
    const original = await readFile(options.path)
    const other = new AuditReceiptStore({ ...options, [field]: randomUUID() })
    await expect(other.read()).rejects.toThrow('verification failed')
    await expect(other.append(decision())).rejects.toThrow('verification failed')
    expect(await readFile(options.path)).toEqual(original)
  })

  it.each(['partial', 'tampered', 'oversized'] as const)('refuses to append to %s history', async (damage) => {
    const { store, options } = await fixture({ maxBytes: 1024 })
    await store.append({ ...decision(), decision: 'denied' } as AuditReceiptEvent)
    const original = await readFile(options.path, 'utf8')
    const damaged = damage === 'partial' ? original.slice(0, -3)
      : damage === 'tampered' ? original.replace('browser_click', 'browser_snapshot')
        : 'x'.repeat(1025)
    await writeFile(options.path, damaged)
    await expect(store.read()).rejects.toThrow('verification failed')
    await expect(store.append(decision())).rejects.toThrow('verification failed')
    expect(await readFile(options.path, 'utf8')).toBe(damaged)
  })

  it.each([{ maxEntries: 2 }, { maxBytes: 1100 }])('stops at explicit capacity without truncating history: %j', async (limits) => {
    const { store, options } = await fixture(limits)
    // Denials need no outcome reservation and can fill the physical capacity.
    await store.append({ ...decision(), decision: 'denied' } as AuditReceiptEvent)
    await store.append({ ...decision(), decision: 'denied' } as AuditReceiptEvent)
    const original = await readFile(options.path)
    await expect(store.append(decision())).rejects.toThrow('capacity reached')
    expect(await readFile(options.path)).toEqual(original)
    expect(await store.read()).toHaveLength(2)
  })
})
