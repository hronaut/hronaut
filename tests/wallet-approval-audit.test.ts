import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WalletApprovalStore } from '../src/main/wallet/approvals.js'
import { WalletAuditStore } from '../src/main/wallet/audit.js'
import type { WalletOperationRequest } from '../src/shared/wallet.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryPath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-approval-test-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

function request(overrides: Partial<WalletOperationRequest> = {}): WalletOperationRequest {
  return {
    requestId: 'request-1', walletId: 'wallet-1', workspaceId: 'workspace-1', tabId: 'tab-1',
    navigationGeneration: 2, topLevelOrigin: 'https://dapp.example',
    requester: { type: 'agent', id: 'agent-1', name: 'Codex' }, capability: 'send',
    chainFamily: 'evm', networkId: '11155111', operation: 'sign-and-send-transaction',
    payload: { to: '0x0000000000000000000000000000000000000002', value: '0x0', nonce: '0x1' },
    expiresAt: '2026-08-28T13:00:00.000Z', ...overrides
  }
}

describe('WalletApprovalStore', () => {
  it('binds approval to the exact normalized request and rejects mutation', async () => {
    const store = new WalletApprovalStore(await temporaryPath('requests.json'))
    await store.load(new Date('2026-08-28T12:00:00.000Z'))
    const created = await store.create(request(), 'idempotency-1', new Date('2026-08-28T12:00:00.000Z'))
    await store.transition(created.id, 'validated')
    await store.transition(created.id, 'simulated')
    await store.transition(created.id, 'policy-decision')
    await store.transition(created.id, 'awaiting-human')
    const approved = await store.approve(created.id, request(), new Date('2026-08-28T12:01:00.000Z'))

    expect(approved.approvalHash).toMatch(/^[a-f0-9]{64}$/)
    expect(() => store.assertApprovedRequest(created.id, request({ navigationGeneration: 3 })))
      .toThrow('Approved wallet request has changed')
    expect(() => store.assertApprovedRequest(created.id, request({
      payload: { to: '0x0000000000000000000000000000000000000003', value: '0x0', nonce: '0x1' }
    }))).toThrow('Approved wallet request has changed')
    expect(store.assertApprovedRequest(created.id, request()).status).toBe('approved')
  })

  it('deduplicates idempotency keys and prevents duplicate submission', async () => {
    const store = new WalletApprovalStore(await temporaryPath('requests.json'))
    await store.load(new Date('2026-08-28T12:00:00.000Z'))
    const first = await store.create(request(), 'same-key', new Date('2026-08-28T12:00:00.000Z'))
    const duplicate = await store.create(request(), 'same-key', new Date('2026-08-28T12:01:00.000Z'))
    expect(duplicate.id).toBe(first.id)
    await expect(store.create(request({ requestId: 'different-client-id' }), 'same-key', new Date('2026-08-28T12:01:00.000Z')))
      .rejects.toThrow('Idempotency key was already used for a different wallet request')

    await store.transition(first.id, 'validated')
    await store.transition(first.id, 'simulated')
    await store.transition(first.id, 'policy-decision')
    await store.transition(first.id, 'awaiting-human')
    await store.approve(first.id, request(), new Date('2026-08-28T12:01:00.000Z'))
    await store.markSigning(first.id, request(), new Date('2026-08-28T12:01:00.000Z'))
    await store.markSubmitted(first.id, '0xabc')
    await expect(store.markSubmitted(first.id, '0xdef')).rejects.toThrow('Wallet request cannot transition from submitted to submitted')
  })

  it('rejects human approval after the exact request expiry', async () => {
    const store = new WalletApprovalStore(await temporaryPath('requests.json'))
    await store.load(new Date('2026-08-28T12:00:00.000Z'))
    const expiring = request({ expiresAt: '2026-08-28T12:05:00.000Z' })
    const created = await store.create(expiring, 'expiring-key', new Date('2026-08-28T12:00:00.000Z'))
    await store.transition(created.id, 'validated')
    await store.transition(created.id, 'simulated')
    await store.transition(created.id, 'policy-decision')
    await store.transition(created.id, 'awaiting-human')

    await expect(store.approve(created.id, expiring, new Date('2026-08-28T12:05:00.001Z')))
      .rejects.toThrow('expired')
    expect(store.get(created.id)?.status).toBe('expired')
  })

  it('cancels pending requests on navigation, tab close, workspace removal, or client disconnect', async () => {
    const store = new WalletApprovalStore(await temporaryPath('requests.json'))
    await store.load(new Date('2026-08-28T12:00:00.000Z'))
    await store.create(request({ requestId: 'navigation' }), 'key-1', new Date('2026-08-28T12:00:00.000Z'))
    await store.create(request({ requestId: 'tab', tabId: 'tab-2' }), 'key-2', new Date('2026-08-28T12:00:00.000Z'))
    await store.create(request({ requestId: 'workspace', workspaceId: 'workspace-2', tabId: 'tab-3' }), 'key-3', new Date('2026-08-28T12:00:00.000Z'))
    await store.create(request({ requestId: 'client', tabId: 'tab-4', requester: { type: 'agent', id: 'agent-2' } }), 'key-4', new Date('2026-08-28T12:00:00.000Z'))

    expect(await store.cancelForNavigation('tab-1', 3)).toBe(1)
    expect(await store.cancelForTab('tab-2')).toBe(1)
    expect(await store.cancelForWorkspace('workspace-2')).toBe(1)
    expect(await store.cancelForRequester('agent-2')).toBe(1)
    expect(store.list().every((entry) => entry.status === 'cancelled')).toBe(true)
  })

  it('expires or cancels non-terminal requests recovered after application restart', async () => {
    const path = await temporaryPath('requests.json')
    const first = new WalletApprovalStore(path)
    await first.load(new Date('2026-08-28T12:00:00.000Z'))
    await first.create(request({ requestId: 'expired', expiresAt: '2026-08-28T12:05:00.000Z' }), 'key-1', new Date('2026-08-28T12:00:00.000Z'))
    await first.create(request({ requestId: 'pending', expiresAt: '2026-08-28T13:00:00.000Z' }), 'key-2', new Date('2026-08-28T12:00:00.000Z'))

    const restored = new WalletApprovalStore(path)
    await restored.load(new Date('2026-08-28T12:10:00.000Z'))
    expect(Object.fromEntries(restored.list().map((entry) => [entry.request.requestId, entry.status]))).toEqual({
      expired: 'expired', pending: 'cancelled'
    })
  })

  it('preserves submitted requests after restart so a possibly broadcast transaction cannot be replayed', async () => {
    const path = await temporaryPath('requests.json')
    const first = new WalletApprovalStore(path)
    await first.load(new Date('2026-08-28T12:00:00.000Z'))
    const created = await first.create(request({ expiresAt: '2026-08-28T12:05:00.000Z' }), 'submitted-key', new Date('2026-08-28T12:00:00.000Z'))
    await first.transition(created.id, 'validated')
    await first.transition(created.id, 'simulated')
    await first.transition(created.id, 'policy-decision')
    await first.transition(created.id, 'awaiting-human')
    await first.approve(created.id, request({ expiresAt: '2026-08-28T12:05:00.000Z' }), new Date('2026-08-28T12:01:00.000Z'))
    await first.markSigning(created.id, request({ expiresAt: '2026-08-28T12:05:00.000Z' }), new Date('2026-08-28T12:01:00.000Z'))
    await first.markSubmitted(created.id, '0xabc')

    const restored = new WalletApprovalStore(path)
    await restored.load(new Date('2026-08-28T12:10:00.000Z'))

    expect(restored.get(created.id)).toMatchObject({ status: 'submitted', transactionHash: '0xabc' })
    await expect(restored.create(
      request({ expiresAt: '2026-08-28T12:05:00.000Z' }),
      'submitted-key',
      new Date('2026-08-28T12:10:00.000Z')
    )).resolves.toMatchObject({ id: created.id, status: 'submitted', transactionHash: '0xabc' })
  })
})

describe('WalletAuditStore', () => {
  it('writes a hash-chained, non-secret audit history and verifies it', async () => {
    const path = await temporaryPath('audit.jsonl')
    const audit = new WalletAuditStore(path)
    await audit.append('wallet-created', {
      walletId: 'wallet-1', workspaceId: 'workspace-1', chainFamily: 'evm', publicAddress: '0x1234'
    }, '2026-08-28T12:00:00.000Z')
    await audit.append('request-approved', {
      walletId: 'wallet-1', requestId: 'request-1', approvalHash: 'a'.repeat(64)
    }, '2026-08-28T12:01:00.000Z')

    const text = await readFile(path, 'utf8')
    expect(text).not.toMatch(/privateKey|mnemonic|seedPhrase|ciphertext/i)
    await expect(audit.verify()).resolves.toHaveLength(2)
  })

  it.each(['privateKey', 'mnemonic', 'seedPhrase', 'ciphertext', 'wrappingKey'])(
    'rejects audit payload secret field %s',
    async (field) => {
      const audit = new WalletAuditStore(await temporaryPath('audit.jsonl'))
      await expect(audit.append('request-failed', { walletId: 'wallet-1', [field]: 'secret' }))
        .rejects.toThrow('Wallet audit events must not contain secret material')
    }
  )

  it('detects modified audit entries', async () => {
    const path = await temporaryPath('audit.jsonl')
    const audit = new WalletAuditStore(path)
    await audit.append('wallet-created', { walletId: 'wallet-1' }, '2026-08-28T12:00:00.000Z')
    const text = await readFile(path, 'utf8')
    await writeFile(path, text.replace('wallet-1', 'wallet-2'), 'utf8')

    await expect(audit.verify()).rejects.toThrow('Wallet audit history verification failed')
  })
})
