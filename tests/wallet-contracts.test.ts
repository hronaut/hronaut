import { describe, expect, it } from 'vitest'
import {
  WalletAgentDescriptorSchema,
  WalletDescriptorSchema,
  WalletOperationRequestSchema,
  WalletPublicRequestPayloadSchema,
  WalletRequestStatusSchema
} from '../src/shared/wallet.js'

function nestedPayload(value: unknown, depth: number): unknown {
  let nested = value
  for (let index = 0; index < depth; index += 1) nested = { nested }
  return nested
}

describe('wallet public contracts', () => {
  it('keeps agent wallet descriptors limited to public network identity', () => {
    const descriptor = {
      id: 'wallet-agent-1',
      name: 'Agent wallet',
      kind: 'agent',
      chainFamily: 'evm',
      network: { id: '8453', name: 'Base', environment: 'mainnet' },
      capabilities: ['read', 'sign', 'send'],
      addressPermission: false
    }

    expect(WalletAgentDescriptorSchema.parse(descriptor)).toEqual(descriptor)
    expect(() => WalletAgentDescriptorSchema.parse({
      ...descriptor,
      network: { ...descriptor.network, rpcUrl: 'https://rpc-user:rpc-password@rpc.example.invalid' }
    })).toThrow()
    expect(() => WalletAgentDescriptorSchema.parse({
      ...descriptor,
      publicAddress: '0x0000000000000000000000000000000000000001'
    })).toThrow(/permission/i)
  })

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

  it('rejects secret fields hidden beyond the payload scan boundary', () => {
    const payload = nestedPayload({ privateKey: 'must-never-be-persisted' }, 25)

    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow()
    expect(() => WalletOperationRequestSchema.parse({
      requestId: 'request-deep-secret',
      walletId: 'wallet-018f',
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
      navigationGeneration: 7,
      topLevelOrigin: 'https://dapp.example',
      requester: { type: 'website', id: 'https://dapp.example' },
      capability: 'sign',
      chainFamily: 'tron',
      networkId: 'nile',
      operation: 'sign-transaction',
      payload,
      expiresAt: '2026-08-28T12:05:00.000Z'
    })).toThrow()
  })

  it.each(['privateKeyHex', 'privateKeyBytes', 'secretKey', 'secretKeyHex', 'mnemonicWords', 'recoveryMaterial'])(
    'rejects the explicit wallet secret alias %s in public and durable payloads',
    (field) => {
      const payload = { [field]: 'must-never-be-persisted' }
      expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow()
      expect(() => WalletOperationRequestSchema.parse({
        requestId: `request-${field}`,
        walletId: 'wallet-018f',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
        navigationGeneration: 7,
        topLevelOrigin: 'https://dapp.example',
        requester: { type: 'website', id: 'https://dapp.example' },
        capability: 'sign',
        chainFamily: 'tron',
        networkId: 'nile',
        operation: 'sign-transaction',
        payload: { normalized: { raw: payload } },
        expiresAt: '2026-08-28T12:05:00.000Z'
      })).toThrow()
    }
  )

  it('scans arrays without invoking an untrusted array method', () => {
    const payload: unknown[] = []
    Object.defineProperty(payload, 'map', {
      get: () => { throw new Error('wallet payload scanner invoked an untrusted array method') }
    })

    expect(WalletPublicRequestPayloadSchema.parse(payload)).toEqual([])
  })

  it('rejects huge sparse arrays before iterating or serializing their slots', () => {
    const payload: unknown[] = []
    payload.length = 1_000_000_000
    Object.defineProperty(payload, 0, {
      get: () => { throw new Error('wallet payload scanner touched a rejected sparse array') }
    })

    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow(/array is too large/i)
  })

  it('rejects sparse arrays instead of materializing holes as null', () => {
    const payload = new Array(2)
    payload[1] = 'safe leaf'

    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow(/array must be dense/i)
  })

  it('rejects repeated object identities before a shared graph can amplify during serialization', () => {
    const shared = { value: 'safe leaf' }
    const payload = { left: shared, right: shared }

    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow(/shared object references/i)
  })

  it('rejects oversized typed-array data before expanding bytes into numeric JSON fields', () => {
    const payload = { message: new Uint8Array(128 * 1024 + 1) }

    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow(/binary data is too large/i)
  })

  it('accepts bounded binary payloads while enforcing the aggregate byte budget', () => {
    expect(WalletPublicRequestPayloadSchema.parse({ message: new Uint8Array([1, 2, 3]) }))
      .toEqual({ message: new Uint8Array([1, 2, 3]) })

    const payload = {
      transaction: new Uint8Array(64 * 1024),
      message: new Uint8Array(64 * 1024 + 1)
    }
    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow(/binary data is too large/i)
  })

  it('fails closed when a public payload exceeds the shared nesting limit', () => {
    expect(() => WalletPublicRequestPayloadSchema.parse(nestedPayload('safe leaf', 34))).toThrow()
  })

  it.each([
    ['function', { transaction: { transform: () => 'silently dropped' } }],
    ['symbol', { transaction: { marker: Symbol('silently dropped') } }],
    ['undefined', { transaction: { destination: undefined } }],
    ['non-finite number', { transaction: { amount: Number.POSITIVE_INFINITY } }],
    ['non-plain object', { transaction: new Map([['destination', 'silently dropped']]) }]
  ])('rejects %s values instead of letting JSON serialization change the signed request', (_kind, payload) => {
    expect(() => WalletPublicRequestPayloadSchema.parse(payload)).toThrow(/serializable/i)
  })

  it('recognizes only the explicit approval state machine statuses', () => {
    expect(WalletRequestStatusSchema.options).toEqual([
      'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved',
      'signing', 'submitted', 'confirmed', 'rejected', 'expired', 'cancelled', 'failed'
    ])
    expect(() => WalletRequestStatusSchema.parse('website-approved')).toThrow()
  })
})
