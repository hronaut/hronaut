import { describe, expect, it } from 'vitest'
import { walletBrokerContextFromIpc, type WalletIpcContextSource } from '../src/main/wallet/ipc-context.js'

function source(overrides: Partial<ReturnType<WalletIpcContextSource['walletPageContext']>> = {}): WalletIpcContextSource {
  return {
    walletPageContext: () => ({
      tabId: 'tab-1', workspaceId: 'workspace-1', navigationGeneration: 7,
      topLevelOrigin: 'https://dapp.example', url: 'https://dapp.example/swap', ...overrides
    })
  }
}

function event(url = 'https://dapp.example/swap') {
  const frame = { url }
  return { sender: { id: 42, mainFrame: frame }, senderFrame: frame }
}

describe('walletBrokerContextFromIpc', () => {
  it('derives the workspace, tab, generation, origin, and requester from trusted browser state', () => {
    expect(walletBrokerContextFromIpc(event(), source())).toEqual({
      workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 7,
      topLevelOrigin: 'https://dapp.example', requester: { type: 'website', id: 'https://dapp.example' }
    })
  })

  it('rejects iframe requests even when the iframe claims the top-level origin', () => {
    const topFrame = { url: 'https://dapp.example/swap' }
    const iframe = { url: 'https://dapp.example/frame' }
    expect(() => walletBrokerContextFromIpc({ sender: { id: 42, mainFrame: topFrame }, senderFrame: iframe }, source()))
      .toThrow('top-level')
  })

  it('rejects an origin mismatch caused by navigation races or origin spoofing', () => {
    expect(() => walletBrokerContextFromIpc(event('https://attacker.example/'), source())).toThrow('does not match')
  })

  it.each(['file:///tmp/dapp.html', 'data:text/html,test', 'hronaut://home/'])('rejects non-web sender URL %s', (url) => {
    expect(() => walletBrokerContextFromIpc(event(url), source())).toThrow('HTTP or HTTPS')
  })
})
