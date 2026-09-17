// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
    <button id="chain"></button><button id="switch"></button><button id="send"></button>
    <button id="receipt"></button><input id="chain-id" value="0x7a6a">
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

function hashInput(page: FixturePage): HTMLInputElement {
  return page.document.querySelector('#hash') as HTMLInputElement
}
