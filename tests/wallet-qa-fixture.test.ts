// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://127.0.0.1:4173/"}
import { readFile } from 'node:fs/promises'
import { hashTypedData } from 'viem'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseSendCalls } from '../src/main/wallet/evm-call-bundles.js'
import { parseWatchAsset } from '../src/main/wallet/evm-watch-asset.js'
import { websiteSignInMessageIssue } from '../src/main/wallet/policy.js'
import { typedDataDisplay } from '../src/main/wallet/typed-data-display.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

interface FixtureEvent {
  kind: string
  value: Record<string, unknown>
}

type FixturePage = Window & typeof globalThis

let fixtureScript = ''
const frames: HTMLIFrameElement[] = []

beforeAll(async () => {
  const fixture = await readFile('examples/wallet-qa/index.html', 'utf8')
  const match = fixture.match(/<script type="module">([\s\S]*?)<\/script>/)
  if (!match?.[1]) throw new Error('Wallet QA fixture module was not found')
  fixtureScript = match[1]
})

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove()
})

function pageWith(provider?: { request?: ReturnType<typeof vi.fn> }): FixturePage {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  const page = frame.contentWindow as FixturePage
  page.document.body.innerHTML = `
    <button id="discover"></button><button id="connect"></button><button id="accounts"></button>
    <button id="chain"></button><button id="switch"></button><button id="sign-in"></button><button id="sign-permit"></button><button id="send"></button>
    <button id="receipt"></button><button id="send-batch"></button><input id="chain-id" value="0x7a6a">
    <input id="token-symbol" value="HQA"><input id="token-decimals" value="6"><button id="watch-token"></button>
    <input id="recipient" value="0x1000000000000000000000000000000000000001">
    <input id="hash"><input id="rpc" value="http://127.0.0.1:8545">
    <p id="status"></p><pre id="log"></pre>
  `
  if (provider) {
    page.addEventListener('eip6963:requestProvider', () => {
      page.dispatchEvent(new page.CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'synthetic-provider', name: 'Synthetic Hronaut', icon: '', rdns: 'dev.hronaut.wallet' },
          provider
        }
      }))
    })
  }
  page.eval(fixtureScript)
  return page
}

async function click(page: Window, selector: string): Promise<void> {
  ;(page.document.querySelector(selector) as HTMLButtonElement).click()
  await new Promise(resolve => setTimeout(resolve, 0))
}

function events(page: FixturePage): FixtureEvent[] {
  const text = page.document.querySelector('#log')?.textContent ?? ''
  return text.trim().split('\n\n').filter(Boolean).map((entry) => {
    const [heading = '', ...body] = entry.split('\n')
    return {
      kind: heading.split(' ').at(-1) ?? '',
      value: JSON.parse(body.join('\n')) as Record<string, unknown>
    }
  }).reverse()
}

describe('wallet QA request evidence', () => {
  it('records a correlated pre-dispatch failure without exercising a wallet provider', async () => {
    const ignoredRequest = vi.fn()
    const page = pageWith()
    page.dispatchEvent(new page.CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'other-provider', name: 'Other', icon: '', rdns: 'example.invalid' },
        provider: { request: ignoredRequest }
      }
    }))

    await click(page, '#accounts')

    expect(ignoredRequest).not.toHaveBeenCalled()
    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:start',
        value: expect.objectContaining({
          requestId: 'request-1',
          method: 'eth_accounts',
          channel: 'provider',
          parameterSummary: 'none'
        })
      },
      {
        kind: 'request:error',
        value: expect.objectContaining({
          requestId: 'request-1',
          method: 'eth_accounts',
          stage: 'provider-selection',
          providerInvoked: false,
          walletBehavior: 'not-exercised'
        })
      }
    ]))
  })

  it('correlates a stub provider rejection without claiming wallet-backend dispatch', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('Synthetic provider rejection'), { code: 4900 })
    })
    const page = pageWith({ request })

    await click(page, '#accounts')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({ method: 'eth_accounts' })
    expect(page.document.querySelector('#log')?.textContent).not.toContain('Synthetic provider rejection')
    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:error',
        value: expect.objectContaining({
          requestId: 'request-1',
          method: 'eth_accounts',
          stage: 'provider-rejection',
          providerInvoked: true,
          walletBackendDispatch: 'unknown',
          approval: 'unknown',
          broadcast: 'unknown',
          confirmation: 'unknown',
          error: { category: 'provider-error', code: 4900 }
        })
      }
    ]))
  })

  it('does not claim invocation when the discovered provider has no request function', async () => {
    const page = pageWith({})

    await click(page, '#accounts')

    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:error',
        value: expect.objectContaining({
          requestId: 'request-1',
          method: 'eth_accounts',
          stage: 'provider-validation',
          providerInvoked: false,
          walletBehavior: 'not-exercised',
          error: { category: 'provider-invalid' }
        })
      }
    ]))
    expect(events(page)).not.toEqual(expect.arrayContaining([
      { kind: 'request:provider-invocation', value: expect.anything() }
    ]))
  })

  it('records only bounded summaries for submitted transactions and confirmed local receipts', async () => {
    const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const transactionHash = `0x${'b'.repeat(64)}`
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_sendTransaction') return transactionHash
      throw new Error('Unexpected method')
    })
    const page = pageWith({ request })
    const rpcPayload = {
      status: '0x1',
      blockNumber: '0x2',
      transactionHash,
      from: account,
      logs: [{ data: 'private synthetic payload' }]
    }
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 'request-3', result: rpcPayload })
    }))
    Object.defineProperty(page, 'fetch', { configurable: true, value: fetch })

    await click(page, '#send')
    await click(page, '#receipt')

    const recorded = events(page)
    expect(recorded).toEqual(expect.arrayContaining([
      {
        kind: 'request:start',
        value: expect.objectContaining({
          requestId: 'request-2',
          method: 'eth_sendTransaction',
          parameterSummary: {
            transactionCount: 1,
            recipient: 'configured-synthetic-input',
            value: '1 wei'
          }
        })
      },
      {
        kind: 'request:result',
        value: expect.objectContaining({
          requestId: 'request-2',
          method: 'eth_sendTransaction',
          result: { transactionHashReturned: true, transactionState: 'submitted' }
        })
      },
      {
        kind: 'request:result',
        value: expect.objectContaining({
          requestId: 'request-3',
          method: 'eth_getTransactionReceipt',
          stage: 'local-receipt-result',
          walletBehavior: 'not-exercised',
          result: { receiptFound: true, receiptStatus: 'confirmed', blockNumberPresent: true }
        })
      }
    ]))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(hashInput(page).value).toBe(transactionHash)
    const visibleLog = page.document.querySelector('#log')?.textContent ?? ''
    expect(visibleLog).not.toContain(account)
    expect(visibleLog).not.toContain(transactionHash)
    expect(visibleLog).not.toContain('private synthetic payload')
    expect(visibleLog).not.toContain('127.0.0.1:8545')
  })

  it('rejects a non-loopback receipt endpoint before any network read', async () => {
    const page = pageWith()
    const fetch = vi.fn()
    Object.defineProperty(page, 'fetch', { configurable: true, value: fetch })
    ;(page.document.querySelector('#rpc') as HTMLInputElement).value = 'https://private.example/rpc?token=secret'

    await click(page, '#receipt')

    expect(fetch).not.toHaveBeenCalled()
    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:error',
        value: expect.objectContaining({
          requestId: 'request-1',
          method: 'eth_getTransactionReceipt',
          stage: 'local-read-validation',
          localReadInvoked: false,
          walletBehavior: 'not-exercised',
          error: { category: 'local-read-error' }
        })
      }
    ]))
    expect(page.document.querySelector('#log')?.textContent).not.toContain('private.example')
    expect(page.document.querySelector('#log')?.textContent).not.toContain('secret')
  })
})

const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const signature = `0x${'c'.repeat(130)}`
const importedWallet: WalletDescriptor = {
  id: 'wallet-1',
  name: 'Disposable Anvil wallet',
  kind: 'imported',
  chainFamily: 'evm',
  publicAddress: account,
  network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
  capabilities: ['read', 'sign', 'send'],
  workspaceIds: ['workspace-1'],
  policyIds: [],
  recoveryConfirmed: true,
  createdAt: '2026-10-15T12:00:00.000Z',
  updatedAt: '2026-10-15T12:00:00.000Z'
}

// A stub provider on Anvil's chain that signs messages and typed data, and recovers `recovered` as their signer.
function signer(accounts: string[], chainId = '0x7a69', recovered = accounts[0]) {
  return vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_accounts') return accounts
    if (method === 'eth_chainId') return chainId
    if (method === 'personal_sign' || method === 'eth_signTypedData_v4') return signature
    if (method === 'personal_ecRecover') return recovered
    throw new Error('Unexpected method')
  })
}

describe('wallet QA sign-in', () => {

  it('signs Sign-In with Ethereum text that the website sign-in policy accepts for this page', async () => {
    const request = signer([account])
    const page = pageWith({ request })

    await click(page, '#sign-in')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts', 'eth_chainId', 'personal_sign', 'personal_ecRecover'])
    const [encoded, signingAccount] = request.mock.calls[2]?.[0].params as [string, string]
    // The fixture checks the returned signature over the same text, as a sign-in backend would.
    expect(request.mock.calls[3]?.[0].params).toEqual([encoded, signature])
    expect(signingAccount).toBe(account)
    expect(encoded).toMatch(/^0x(?:[0-9a-f]{2})+$/)
    const bytes = Uint8Array.from(encoded.slice(2).match(/../g) ?? [], byte => Number.parseInt(byte, 16))
    const lines = new TextDecoder().decode(bytes).split('\n')
    expect(lines.slice(0, 8)).toEqual([
      'http://127.0.0.1:4173 wants you to sign in with your Ethereum account:',
      account,
      '',
      'Sign in to the Hronaut wallet QA fixture.',
      '',
      'URI: http://127.0.0.1:4173/',
      'Version: 1',
      'Chain ID: 31337'
    ])
    expect(lines[8]).toMatch(/^Nonce: [0-9a-f]{16}$/)
    expect(lines[9]).toMatch(/^Issued At: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(lines).toHaveLength(10)
    // The same check Hronaut runs before signing without a click.
    expect(websiteSignInMessageIssue(bytes, importedWallet, 'http://127.0.0.1:4173')).toBeUndefined()

    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:start',
        value: expect.objectContaining({
          requestId: 'request-3',
          method: 'personal_sign',
          parameterSummary: { message: 'eip-4361-sign-in', encoding: 'hex-utf8', account: 'first-connected-account' }
        })
      },
      {
        kind: 'request:result',
        value: expect.objectContaining({
          requestId: 'request-3',
          method: 'personal_sign',
          result: { signatureReturned: true, signatureBytes: 65 }
        })
      },
      {
        kind: 'request:start',
        value: expect.objectContaining({
          requestId: 'request-4',
          method: 'personal_ecRecover',
          parameterSummary: { message: 'eip-4361-sign-in', signature: 'returned-signature' }
        })
      },
      {
        kind: 'request:result',
        value: expect.objectContaining({ requestId: 'request-4', method: 'personal_ecRecover', result: { addressReturned: true } })
      }
    ]))
    expect(events(page).at(-1)).toEqual({ kind: 'sign-in:verified', value: { signerMatches: true } })
    const visibleLog = page.document.querySelector('#log')?.textContent ?? ''
    expect(visibleLog.toLowerCase()).not.toContain(account.toLowerCase())
    expect(visibleLog).not.toContain(signature)
    expect(visibleLog).not.toContain(encoded)
    expect(visibleLog).not.toContain('wants you to sign in')
    expect(visibleLog).not.toContain(lines[8]?.slice('Nonce: '.length))
  })

  it('reports a signature that another account made as not matching, without naming either account', async () => {
    const other = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    const page = pageWith({ request: signer([account], '0x7a69', other) })

    await click(page, '#sign-in')

    expect(events(page).at(-1)).toEqual({ kind: 'sign-in:verified', value: { signerMatches: false } })
    const visibleLog = (page.document.querySelector('#log')?.textContent ?? '').toLowerCase()
    expect(visibleLog).not.toContain(account.toLowerCase())
    expect(visibleLog).not.toContain(other.toLowerCase())
  })

  it('skips the check when the wallet returns no signature', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x7a69'
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    })
    const page = pageWith({ request })

    await click(page, '#sign-in')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts', 'eth_chainId', 'personal_sign'])
    expect(events(page).at(-1)).toMatchObject({ kind: 'request:error', value: { method: 'personal_sign', error: { code: 4001 } } })
  })

  it('asks for no signature before the page has a connected account', async () => {
    const request = signer([])
    const page = pageWith({ request })

    await click(page, '#sign-in')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts'])
    expect(events(page).at(-1)).toEqual({
      kind: 'fixture:error',
      value: { stage: 'sign-in-account', walletBehavior: 'not-exercised', error: { category: 'fixture-error' } }
    })
  })
})

describe('wallet QA token permit', () => {
  it('asks the wallet to sign an EIP-2612 permit that Hronaut summarizes', async () => {
    const request = signer([account])
    const page = pageWith({ request })

    await click(page, '#sign-permit')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'])
    const [signingAccount, json] = request.mock.calls[2]?.[0].params as [string, string]
    expect(signingAccount).toBe(account)
    const typedData = JSON.parse(json) as { message: { owner: string; deadline: string } }
    expect(typedData).toMatchObject({
      primaryType: 'Permit',
      domain: { name: 'Hronaut QA Token', version: '1', chainId: '31337', verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' },
      message: { owner: account, spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', value: '1000000', nonce: '0' }
    })
    const deadline = Number(typedData.message.deadline) - Date.now() / 1000
    expect(deadline).toBeGreaterThan(3500)
    expect(deadline).toBeLessThanOrEqual(3600)
    // The signer accepts it, and the approval shows what the fixture describes.
    expect(() => hashTypedData(typedData as unknown as Parameters<typeof hashTypedData>[0])).not.toThrow()
    expect(typedDataDisplay(typedData, importedWallet)).toEqual({
      primaryType: 'Permit',
      domain: { name: 'Hronaut QA Token', version: '1', chainId: '31337', verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' },
      tokenAccess: {
        kind: 'allowance',
        spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        allowances: [{ token: '0x5FbDB2315678afecb367f032d93F642f64180aa3', amount: '1000000' }],
        expiresAt: new Date(Number(typedData.message.deadline) * 1000).toISOString()
      },
      warnings: ['token-permit']
    })

    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:start',
        value: expect.objectContaining({
          requestId: 'request-3',
          method: 'eth_signTypedData_v4',
          parameterSummary: { typedData: 'eip-2612-permit', spender: 'fixture-test-spender', value: '1000000', account: 'first-connected-account' }
        })
      },
      {
        kind: 'request:result',
        value: expect.objectContaining({
          requestId: 'request-3',
          method: 'eth_signTypedData_v4',
          result: { signatureReturned: true, signatureBytes: 65 }
        })
      }
    ]))
    const visibleLog = page.document.querySelector('#log')?.textContent ?? ''
    expect(visibleLog.toLowerCase()).not.toContain(account.toLowerCase())
    expect(visibleLog.toLowerCase()).not.toContain('0x70997970c51812dc3a010c7d01b50e0d17dc79c8')
    expect(visibleLog).not.toContain(signature)
    expect(visibleLog).not.toContain(typedData.message.deadline)
  })

  it('asks for no signature before the page has a connected account', async () => {
    const request = signer([])
    const page = pageWith({ request })

    await click(page, '#sign-permit')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts'])
    expect(events(page).at(-1)).toEqual({
      kind: 'fixture:error',
      value: { stage: 'permit-account', walletBehavior: 'not-exercised', error: { category: 'fixture-error' } }
    })
  })

  it('asks for no signature when the provider returns no usable chain ID', async () => {
    const request = signer([account], 'mainnet')
    const page = pageWith({ request })

    await click(page, '#sign-permit')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts', 'eth_chainId'])
    expect(events(page).at(-1)).toEqual({
      kind: 'fixture:error',
      value: { stage: 'permit-chain', walletBehavior: 'not-exercised', error: { category: 'fixture-error' } }
    })
  })

  it('records a rejected permit by its error code only', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x7a69'
      throw Object.assign(new Error(`User rejected ${account}`), { code: 4001 })
    })
    const page = pageWith({ request })

    await click(page, '#sign-permit')

    expect(events(page).at(-1)).toEqual({
      kind: 'request:error',
      value: expect.objectContaining({
        requestId: 'request-3',
        method: 'eth_signTypedData_v4',
        stage: 'provider-rejection',
        error: { category: 'provider-error', code: 4001 }
      })
    })
    expect((page.document.querySelector('#log')?.textContent ?? '').toLowerCase()).not.toContain(account.toLowerCase())
  })
})

function hashInput(page: FixturePage): HTMLInputElement {
  return page.document.querySelector('#hash') as HTMLInputElement
}

describe('wallet QA add token', () => {
  it('offers the fixture token the way a dApp button does and logs only a bounded summary', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'wallet_watchAsset') return true
      throw new Error('Unexpected method')
    })
    const page = pageWith({ request })

    await click(page, '#watch-token')

    const params = request.mock.calls[0]?.[0] as unknown as { method: string; params: unknown }
    expect(params).toEqual({
      method: 'wallet_watchAsset',
      params: { type: 'ERC20', options: { address: '0x5FbDB2315678afecb367f032d93F642f64180aa3', symbol: 'HQA', decimals: 6 } }
    })
    // Hronaut reads the offer as the fixture describes it.
    expect(parseWatchAsset(params.params)).toEqual({ type: 'ERC20', address: '0x5FbDB2315678afecb367f032d93F642f64180aa3', symbol: 'HQA', decimals: 6 })
    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:start',
        value: expect.objectContaining({
          requestId: 'request-1',
          method: 'wallet_watchAsset',
          parameterSummary: { type: 'ERC20', token: 'fixture-test-token', symbol: 'HQA', decimals: 6 }
        })
      },
      { kind: 'request:result', value: expect.objectContaining({ requestId: 'request-1', result: { accepted: true } }) }
    ]))
  })

  it('records a refused offer by its error code only', async () => {
    const request = vi.fn(async (_call: { method: string; params?: unknown }) => {
      throw Object.assign(new Error('wallet_watchAsset decimals 18 do not match the token contract decimals 6'), { code: -32602 })
    })
    const page = pageWith({ request })
    ;(page.document.querySelector('#token-decimals') as HTMLInputElement).value = '18'
    ;(page.document.querySelector('#token-symbol') as HTMLInputElement).value = 'not a symbol'

    await click(page, '#watch-token')

    expect(request.mock.calls[0]?.[0].params).toMatchObject({ options: { decimals: 18 } })
    expect(events(page)).toEqual(expect.arrayContaining([
      {
        kind: 'request:start',
        value: expect.objectContaining({ parameterSummary: { type: 'ERC20', token: 'fixture-test-token', symbol: 'other', decimals: 18 } })
      },
      {
        kind: 'request:error',
        value: expect.objectContaining({ method: 'wallet_watchAsset', stage: 'provider-rejection', error: { category: 'provider-error', code: -32602 } })
      }
    ]))
    expect(page.document.querySelector('#log')?.textContent ?? '').not.toContain('do not match')
  })
})

describe('wallet QA batch calls', () => {
  const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const recipient = '0x1000000000000000000000000000000000000001'
  const receipt = (transactionHash: string) => ({
    status: '0x1', logs: [{ data: 'private synthetic payload' }], blockHash: `0x${'c'.repeat(64)}`, blockNumber: '0x2', gasUsed: '0x5208', transactionHash
  })

  it('sends two 1 wei calls as one batch and reads its status until it is done, logging only bounded summaries', async () => {
    const statuses = [
      { version: '2.0.0', id: '0xprivate-batch', chainId: '0x7a69', status: 100, atomic: false, receipts: [receipt(`0x${'1'.repeat(64)}`)] },
      { version: '2.0.0', id: '0xprivate-batch', chainId: '0x7a69', status: 200, atomic: false, receipts: [receipt(`0x${'1'.repeat(64)}`), receipt(`0x${'2'.repeat(64)}`)] }
    ]
    const request = vi.fn(async ({ method }: { method: string; params?: unknown }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x7a69'
      if (method === 'wallet_sendCalls') return { id: '0xprivate-batch' }
      if (method === 'wallet_getCallsStatus') return statuses.shift()
      throw new Error('Unexpected method')
    })
    const page = pageWith({ request })

    await click(page, '#send-batch')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(5), { timeout: 3_000 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sent = request.mock.calls.find(([call]) => call.method === 'wallet_sendCalls')?.[0]
    expect(sent).toEqual({
      method: 'wallet_sendCalls',
      params: [{ version: '2.0.0', chainId: '0x7a69', from: account, atomicRequired: false, calls: [{ to: recipient, value: '0x1' }, { to: recipient, value: '0x1' }] }]
    })
    // Hronaut accepts the batch as the fixture writes it.
    expect(parseSendCalls(sent?.params).calls).toHaveLength(2)
    expect(request.mock.calls.filter(([call]) => call.method === 'wallet_getCallsStatus').map(([call]) => call.params))
      .toEqual([['0xprivate-batch'], ['0xprivate-batch']])
    expect(events(page).filter(({ kind }) => kind === 'request:start' || kind === 'request:result')
      .filter(({ value }) => ['wallet_sendCalls', 'wallet_getCallsStatus'].includes(value.method as string))
      .map(({ kind, value }) => [kind, value.parameterSummary ?? value.result])).toEqual([
      ['request:start', {
        version: '2.0.0', callCount: 2, recipient: 'configured-synthetic-input', value: '1 wei each', atomicRequired: false, account: 'first-connected-account'
      }],
      ['request:result', { batchIdReturned: true }],
      ['request:start', { batchId: 'returned-batch-id' }],
      ['request:result', { status: 100, receiptCount: 1, receiptStatuses: ['success'], atomic: false }],
      ['request:start', { batchId: 'returned-batch-id' }],
      ['request:result', { status: 200, receiptCount: 2, receiptStatuses: ['success', 'success'], atomic: false }]
    ])
    const visibleLog = page.document.querySelector('#log')?.textContent ?? ''
    for (const secret of [account, recipient, '0xprivate-batch', '1'.repeat(64), 'private synthetic payload']) {
      expect(visibleLog).not.toContain(secret)
    }
  })

  it('asks for no batch before the page has a connected account', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return []
      throw new Error('Unexpected method')
    })
    const page = pageWith({ request })

    await click(page, '#send-batch')

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts'])
  })

  it('records a refused batch by its error code only and reads no status', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x7a69'
      throw Object.assign(new Error(`Chain 0x7a69 is not this tab's active wallet network for ${account}`), { code: 5710 })
    })
    const page = pageWith({ request })

    await click(page, '#send-batch')
    await vi.waitFor(() => expect(events(page).some(({ kind }) => kind === 'request:error')).toBe(true))

    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts', 'eth_chainId', 'wallet_sendCalls'])
    expect(events(page)).toEqual(expect.arrayContaining([{
      kind: 'request:error',
      value: expect.objectContaining({ method: 'wallet_sendCalls', stage: 'provider-rejection', error: { category: 'provider-error', code: 5710 } })
    }]))
    expect(page.document.querySelector('#log')?.textContent ?? '').not.toContain('active wallet network')
  })
})
