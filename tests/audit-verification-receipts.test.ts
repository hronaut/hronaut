import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AuditReceiptStore } from '../src/main/mcp/audit-receipt-store.js'

const paths: string[] = []
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup(maxEntries = 100, maxBytes = 1_048_576) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-verification-receipts-')); paths.push(directory)
  const options = { path: join(directory, 'events.jsonl'), workspaceId: randomUUID(), runId: randomUUID(), toolNames: new Set(['browser_click']), maxEntries, maxBytes }
  const store = new AuditReceiptStore(options)
  const actionId = randomUUID()
  await store.append({ phase: 'decision', scope: 'workspace', actionId, toolName: 'browser_click', decision: 'allowed', state: null })
  const start = { phase: 'verification' as const, actionId, verificationId: randomUUID(), maxAttempts: 3, attempt: 0, status: 'pending' as const, reason: 'awaiting-read' as const }
  const outcome = { phase: 'outcome' as const, actionId, status: 'succeeded' as const, effects: 'possible' as const, siteAccessDropped: 0, state: null }
  return { store, options, start, outcome }
}

it('appends verification evidence without replacing the original transport outcome', async () => {
  const { store, options, start, outcome } = await setup()
  await store.append(start)
  const original = await store.append(outcome)
  await store.append({ ...start, status: 'not-yet-visible', reason: 'postcondition-not-visible', attempt: 1 })
  await store.append({ ...start, status: 'verified', reason: 'postcondition-matched', attempt: 2 })
  const entries = await new AuditReceiptStore(options).read()
  expect(entries[2]).toEqual(original)
  expect(entries.map(entry => entry.event.phase)).toEqual(['decision', 'verification', 'outcome', 'verification', 'verification'])
  await expect(store.append({ ...start, status: 'unknown', reason: 'deadline', attempt: 2 })).rejects.toThrow(/transition/)
})

it('reserves both transport and verification completion when observed evidence fills the journal', async () => {
  const { store, start, outcome } = await setup(5)
  await store.append(start)
  await store.append(outcome)
  await store.append({ ...start, status: 'not-yet-visible', reason: 'postcondition-not-visible', attempt: 1 })
  await expect(store.append({ ...start, status: 'not-yet-visible', reason: 'postcondition-not-visible', attempt: 2 })).rejects.toThrow(/capacity/)
  await store.append({ ...start, status: 'unknown', reason: 'deadline', attempt: 1 })
  expect(await store.read()).toHaveLength(5)
})

it('requires verification admission before transport and rejects a verified ambiguous result', async () => {
  const first = await setup()
  await first.store.append(first.outcome)
  await expect(first.store.append(first.start)).rejects.toThrow(/transition/)
  const second = await setup()
  await second.store.append(second.start)
  await second.store.append({ ...second.outcome, status: 'outcome-unknown' })
  await expect(second.store.append({ ...second.start, status: 'verified', reason: 'postcondition-matched', attempt: 1 })).rejects.toThrow(/transition/)
  await second.store.append({ ...second.start, status: 'unknown', reason: 'transport-ambiguous', attempt: 0 })
})

it('rejects verification reasons that contradict the recorded transport outcome', async () => {
  const { store, start, outcome } = await setup()
  await store.append(start)
  await store.append(outcome)
  for (const reason of ['transport-ambiguous', 'transport-failed'] as const) {
    await expect(store.append({ ...start, status: 'unknown', reason })).rejects.toThrow(/transition/)
  }
  await store.append({ ...start, status: 'unknown', reason: 'cancelled' })
})

it('preserves byte reservations across reopen when site evidence fills available space', async () => {
  const { store, options, start, outcome } = await setup(100, 4000)
  await store.append(start)
  const reopened = new AuditReceiptStore(options)
  let exhausted = false
  for (let i = 0; i < 20; i += 1) {
    try {
      await reopened.append({ phase: 'site-access', actionId: start.actionId, decision: 'allowed', reason: 'matched', source: 'page', originId: randomUUID(), state: null })
    } catch (error) {
      expect((error as Error).message).toContain('capacity')
      exhausted = true
      break
    }
  }
  expect(exhausted).toBe(true)
  await reopened.append({ ...outcome, siteAccessDropped: Number.MAX_SAFE_INTEGER, state: { tabId: randomUUID(), navigationGeneration: Number.MAX_SAFE_INTEGER, originChanged: false } })
  await reopened.append({ ...start, status: 'verified', reason: 'postcondition-matched', attempt: 1 })
  expect((await new AuditReceiptStore(options).read()).at(-1)?.event).toMatchObject({ phase: 'verification', status: 'verified' })
})
