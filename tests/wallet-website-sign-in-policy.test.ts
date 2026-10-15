import { describe, expect, it } from 'vitest'
import {
  WalletPolicyEngine,
  isMainnetWebsiteSignInPolicy,
  websiteSignInMessageIssue,
  websiteSignInPolicyApplies,
  type WalletWebsiteSignInEvaluation
} from '../src/main/wallet/policy.js'
import type { WalletDescriptor, WalletOperationRequest, WalletPolicy } from '../src/shared/wallet.js'

const now = new Date('2026-08-28T12:00:00.000Z')
const address = '0x00000000000000000000000000000000000000Ab'

const wallet: WalletDescriptor = {
  id: 'wallet-1',
  name: 'EVM test wallet',
  kind: 'managed',
  chainFamily: 'evm',
  publicAddress: address,
  network: { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'https://rpc.sepolia.example' },
  capabilities: ['read', 'sign', 'send'],
  workspaceIds: ['workspace-1'],
  policyIds: ['sign-in'],
  recoveryConfirmed: true,
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z'
}

const agentWallet: WalletDescriptor = { ...wallet, kind: 'agent' }

const mainnetAgent: WalletDescriptor = {
  ...wallet,
  kind: 'agent',
  network: { id: '1', name: 'Ethereum', environment: 'mainnet', rpcUrl: 'https://ethereum.example' }
}

const policy: WalletPolicy = {
  id: 'sign-in',
  name: 'Sign-in',
  mode: 'bounded-auto',
  walletId: 'wallet-1',
  workspaceId: 'workspace-1',
  networkIds: ['11155111'],
  origins: ['https://dapp.example'],
  destinations: [],
  methods: [],
  expiresAt: '2026-08-29T12:00:00.000Z',
  maximumOperationCount: 5,
  requireSuccessfulSimulation: true,
  allowMessageSigning: false,
  allowWebsiteSignIn: true
}

const mainnetPolicy: WalletPolicy = { ...policy, networkIds: ['1'], allowMainnetWebsiteSignIn: true }

function request(overrides: Partial<WalletOperationRequest> = {}): WalletOperationRequest {
  return {
    requestId: 'request-1', walletId: 'wallet-1', workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 1,
    topLevelOrigin: 'https://dapp.example', requester: { type: 'website', id: 'https://dapp.example' },
    capability: 'read', chainFamily: 'evm', networkId: '11155111', operation: 'connect-account',
    payload: {}, expiresAt: '2026-08-28T13:00:00.000Z', ...overrides
  }
}

const text = (value: string) => new TextEncoder().encode(value)

function siwe(overrides: { header?: string; address?: string; chain?: string; extra?: string } = {}): string {
  return [
    overrides.header ?? 'dapp.example wants you to sign in with your Ethereum account:',
    overrides.address ?? address,
    '',
    'Sign in to Dapp.',
    '',
    'URI: https://dapp.example',
    'Version: 1',
    `Chain ID: ${overrides.chain ?? '11155111'}`,
    'Nonce: 32891756',
    `Issued At: 2026-08-28T12:00:00.000Z${overrides.extra ?? ''}`
  ].join('\n')
}

function evaluate(overrides: Partial<WalletWebsiteSignInEvaluation> = {}) {
  return new WalletPolicyEngine().evaluateWebsiteSignIn({
    request: request(), wallet, policies: [policy], now, usageByPolicy: {}, ...overrides
  })
}

describe('website sign-in message checks', () => {
  it('accepts a sign-in message for the requesting site, address and chain, and other plain text only for an agent wallet', () => {
    expect(websiteSignInMessageIssue(text('Log in to Dapp\tnonce 42\n'), agentWallet, 'https://dapp.example')).toBeUndefined()
    expect(websiteSignInMessageIssue(text('Привіт, 日本 😀'), agentWallet, 'https://dapp.example')).toBeUndefined()
    // personal_sign signatures are valid on every chain, so a managed or imported key only signs domain-bound sign-in text.
    expect(websiteSignInMessageIssue(text('Log in to Dapp\tnonce 42\n'), wallet, 'https://dapp.example')).toBe('plain-text-requires-agent-wallet')
    expect(websiteSignInMessageIssue(text(siwe()), wallet, 'https://dapp.example')).toBeUndefined()
    expect(websiteSignInMessageIssue(text(siwe({ header: 'https://dapp.example wants you to sign in with your Ethereum account:', address: address.toLowerCase() })), wallet, 'https://dapp.example')).toBeUndefined()
    expect(websiteSignInMessageIssue(text(siwe({ header: 'localhost:5173 wants you to sign in with your Ethereum account:' })), wallet, 'http://localhost:5173')).toBeUndefined()
    expect(websiteSignInMessageIssue(text(siwe({ header: 'http://dapp.example wants you to sign in with your Ethereum account:' })), wallet, 'http://dapp.example')).toBeUndefined()
  })

  it('needs an explicit scheme from a plain-HTTP site that is not loopback, because verifiers read a missing scheme as https', () => {
    expect(websiteSignInMessageIssue(text(siwe()), wallet, 'http://dapp.example')).toBe('sign-in-domain-mismatch')
    expect(websiteSignInMessageIssue(text(siwe({ header: '127.0.0.1:8080 wants you to sign in with your Ethereum account:' })), wallet, 'http://127.0.0.1:8080')).toBeUndefined()
  })

  it.each([
    ['binary bytes', Uint8Array.from([0xde, 0xad, 0xbe, 0xef])],
    ['invalid UTF-8', Uint8Array.from([0x68, 0xc3, 0x28])],
    ['a NUL byte', text('a\u0000b')],
    ['a carriage return', text('line\r\nline')],
    ['a right-to-left override', text('pay ‮evil')],
    ['a zero-width space', text('dapp​.example')],
    ['a byte order mark', text('﻿hello')],
    ['an empty message', new Uint8Array()],
    ['a message over 4 KiB', text('a'.repeat(4097))]
  ])('keeps %s with a person', (_name, message) => {
    expect(websiteSignInMessageIssue(message, agentWallet, 'https://dapp.example')).toBe('message-not-plain-text')
  })

  it.each([
    ['another domain', siwe({ header: 'bank.example wants you to sign in with your Ethereum account:' }), 'sign-in-domain-mismatch'],
    ['a subdomain', siwe({ header: 'app.dapp.example wants you to sign in with your Ethereum account:' }), 'sign-in-domain-mismatch'],
    ['another port', siwe({ header: 'dapp.example:8443 wants you to sign in with your Ethereum account:' }), 'sign-in-domain-mismatch'],
    ['another scheme', siwe({ header: 'http://dapp.example wants you to sign in with your Ethereum account:' }), 'sign-in-domain-mismatch'],
    ['another address', siwe({ address: '0x0000000000000000000000000000000000000002' }), 'sign-in-address-mismatch'],
    ['another chain', siwe({ chain: '1' }), 'sign-in-chain-mismatch'],
    ['a second chain line', siwe({ extra: '\nChain ID: 11155111' }), 'sign-in-message-unverified'],
    ['no chain line', siwe().replace(/\nChain ID: \d+/, ''), 'sign-in-message-unverified'],
    ['the phrase off the first line', `Welcome\n${siwe()}`, 'sign-in-message-unverified'],
    ['a Solana sign-in header', siwe({ header: 'dapp.example wants you to sign in with your Solana account:' }), 'sign-in-message-unverified']
  ])('keeps a sign-in message with %s with a person', (_name, message, reason) => {
    expect(websiteSignInMessageIssue(text(message), wallet, 'https://dapp.example')).toBe(reason)
  })
})

describe('website sign-in policy', () => {
  it('approves a website connection and plain-text message from the exact origin on a testnet', () => {
    expect(evaluate()).toEqual({ outcome: 'approved', reason: 'bounded-policy', policyId: 'sign-in' })
    expect(evaluate({
      request: request({ operation: 'sign-message', capability: 'sign' }),
      message: { kind: 'message', bytes: text(siwe()), raw: false }
    })).toMatchObject({ outcome: 'approved' })
  })

  it.each([
    ['an agent requester', { request: request({ requester: { type: 'agent', id: 'agent-1' } }) }, 'requester-not-website'],
    ['another origin', { request: request({ topLevelOrigin: 'https://other.example' }) }, 'no-matching-policy'],
    ['a workspace the wallet is not attached to', { request: request({ workspaceId: 'workspace-2' }) }, 'wallet-not-eligible'],
    ['another workspace of an any-workspace wallet', { wallet: { ...wallet, availableInAllWorkspaces: true }, request: request({ workspaceId: 'workspace-2' }) }, 'no-matching-policy'],
    ['a transaction', { request: request({ operation: 'sign-transaction', capability: 'sign' }) }, 'operation-requires-human'],
    ['typed data', { request: request({ operation: 'sign-message', capability: 'sign' }), message: { kind: 'typed-data' as const } }, 'typed-data-requires-human'],
    ['raw eth_sign', { request: request({ operation: 'sign-message', capability: 'sign' }), message: { kind: 'message' as const, bytes: text('hello'), raw: true } }, 'raw-signing-requires-human'],
    ['non-sign-in text on a managed wallet', { request: request({ operation: 'sign-message', capability: 'sign' }), message: { kind: 'message' as const, bytes: text('hello'), raw: false } }, 'plain-text-requires-agent-wallet'],
    ['a message without text', { request: request({ operation: 'sign-message', capability: 'sign' }) }, 'typed-data-requires-human'],
    ['an exhausted operation limit', { usageByPolicy: { 'sign-in': { operationCount: 5 } } }, 'no-matching-policy'],
    ['an expired policy', { now: new Date('2026-08-29T12:00:00.000Z') }, 'no-matching-policy'],
    ['a policy without the switch', { policies: [{ ...policy, allowWebsiteSignIn: false }] }, 'no-matching-policy'],
    ['an always-ask policy', { policies: [{ ...policy, mode: 'always-ask' as const }] }, 'no-matching-policy'],
    ['a Solana wallet', { wallet: { ...wallet, chainFamily: 'solana' as const }, request: request({ chainFamily: 'solana' }) }, 'no-matching-policy'],
    ['an ineligible testnet', { wallet: { ...wallet, network: { ...wallet.network, id: '5' } }, request: request({ networkId: '5' }), policies: [{ ...policy, networkIds: ['5'] }] }, 'no-matching-policy'],
    ['a testnet policy carrying the mainnet switch', { policies: [{ ...policy, allowMainnetWebsiteSignIn: true }] }, 'no-matching-policy']
  ])('leaves %s with a person', (_name, overrides, reason) => {
    expect(evaluate(overrides)).toEqual({ outcome: 'awaiting-human', reason })
  })

  it('needs the separate mainnet switch, a dedicated agent wallet and the mainnet limits on mainnet', () => {
    const mainnetRequest = request({ networkId: '1' })
    expect(evaluate({ wallet: mainnetAgent, request: mainnetRequest, policies: [mainnetPolicy] })).toMatchObject({ outcome: 'approved' })
    expect(evaluate({ wallet: mainnetAgent, request: mainnetRequest, policies: [{ ...mainnetPolicy, allowMainnetWebsiteSignIn: false }] }))
      .toEqual({ outcome: 'awaiting-human', reason: 'no-matching-policy' })
    expect(evaluate({ wallet: { ...mainnetAgent, kind: 'managed' }, request: mainnetRequest, policies: [mainnetPolicy] }))
      .toEqual({ outcome: 'awaiting-human', reason: 'no-matching-policy' })
    expect(evaluate({ wallet: mainnetAgent, request: mainnetRequest, policies: [{ ...mainnetPolicy, maximumOperationCount: 101 }] }))
      .toEqual({ outcome: 'awaiting-human', reason: 'no-matching-policy' })
    expect(evaluate({ wallet: mainnetAgent, request: mainnetRequest, policies: [{ ...mainnetPolicy, expiresAt: '2026-09-05T12:00:00.001Z' }] }))
      .toEqual({ outcome: 'awaiting-human', reason: 'no-matching-policy' })
    expect(evaluate({ wallet: mainnetAgent, request: mainnetRequest, policies: [{ ...mainnetPolicy, origins: ['https://dapp.example', 'https://other.example'] }] }))
      .toEqual({ outcome: 'awaiting-human', reason: 'no-matching-policy' })
  })

  it('reports which policies apply for re-validation before approval', () => {
    expect(websiteSignInPolicyApplies(wallet, policy, now)).toBe(true)
    expect(websiteSignInPolicyApplies({ ...wallet, kind: 'watch-only', capabilities: ['read'] }, policy, now)).toBe(false)
    expect(websiteSignInPolicyApplies(wallet, { ...policy, walletId: 'wallet-2' }, now)).toBe(false)
    expect(websiteSignInPolicyApplies(mainnetAgent, mainnetPolicy, now)).toBe(true)
    expect(isMainnetWebsiteSignInPolicy(mainnetPolicy, now)).toBe(true)
    expect(isMainnetWebsiteSignInPolicy({ ...mainnetPolicy, allowWebsiteSignIn: false }, now)).toBe(false)
  })
})
