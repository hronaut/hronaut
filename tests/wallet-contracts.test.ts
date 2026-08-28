import { describe, expect, it } from 'vitest'
import {
  WalletDescriptorSchema,
  WalletOperationRequestSchema,
  WalletRequestStatusSchema
} from '../src/shared/wallet.js'

describe('wallet public contracts', () => {
  it('accepts public wallet descriptors without secret fields', () => {
    const descriptor = WalletDescriptorSchema.parse({
      id: 'wallet-018f',
      name: 'Local EVM agent',
      kind: 'agent',
      chainFamily: 'evm',
      publicAddress: '0x0000000000000000000000000000000000000001',
      network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
      capabilities: ['read', 'sign', 'send'],
      workspaceIds: ['workspace-1'],
      policyIds: [],
      recoveryConfirmed: true,
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z'
    })

    expect(descriptor.publicAddress).toContain('0x')
    expect(JSON.stringify(descriptor)).not.toMatch(/private|mnemonic|seed|ciphertext/i)
  })

  it.each(['privateKey', 'mnemonic', 'seedPhrase', 'encryptedVault', 'wrappingKey'])(
    'rejects secret-bearing descriptor field %s',
    (field) => {
      expect(() => WalletDescriptorSchema.parse({
        id: 'wallet-018f',
        name: 'Unsafe',
        kind: 'managed',
        chainFamily: 'evm',
        publicAddress: '0x0000000000000000000000000000000000000001',
        network: { id: '1', name: 'Ethereum', environment: 'mainnet', rpcUrl: 'https://example.invalid' },
        capabilities: ['read'],
        workspaceIds: [],
        policyIds: [],
        recoveryConfirmed: false,
        createdAt: '2026-08-28T12:00:00.000Z',
        updatedAt: '2026-08-28T12:00:00.000Z',
        [field]: 'must not cross IPC'
      })).toThrow()
    }
  )

  it('requires wallet ids and scoped request context instead of secret material', () => {
    const request = WalletOperationRequestSchema.parse({
      requestId: 'request-1',
      walletId: 'wallet-018f',
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
      navigationGeneration: 7,
      topLevelOrigin: 'https://dapp.example',
      requester: { type: 'agent', id: 'mcp-client-1', name: 'Codex' },
      capability: 'sign',
      chainFamily: 'evm',
      networkId: '31337',
      operation: 'sign-transaction',
      payload: { to: '0x0000000000000000000000000000000000000002', value: '0x0' },
      expiresAt: '2026-08-28T12:05:00.000Z'
    })
    expect(request.walletId).toBe('wallet-018f')
    expect(JSON.stringify(request)).not.toMatch(/privateKey|mnemonic|seedPhrase/i)
  })

  it('recognizes only the explicit approval state machine statuses', () => {
    expect(WalletRequestStatusSchema.options).toEqual([
      'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved',
      'signing', 'submitted', 'confirmed', 'rejected', 'expired', 'cancelled', 'failed'
    ])
    expect(() => WalletRequestStatusSchema.parse('website-approved')).toThrow()
  })
})
