// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installHronautWalletProviders } from '../src/preload/wallet-provider-bootstrap.js'

interface TestWindow extends Window {
  __hronautWalletBridge?: {
    request: ReturnType<typeof vi.fn>
    subscribe(listener: (event: unknown) => void): void
    unsubscribe(listener: (event: unknown) => void): void
  }
  ethereum?: { request(input: unknown): Promise<unknown>; isHronaut: boolean }
  hronautEthereum?: unknown
  solana?: { connect(): Promise<unknown>; signTransaction(value: unknown): Promise<unknown> }
  hronautSolana?: unknown
  tron?: {
    request(input: unknown): Promise<unknown>
    isHronaut: boolean
    isTronLink?: boolean
    tronWeb: false | {
      ready: boolean
      defaultAddress: { base58: string | false }
      trx: { sign(transaction: unknown): Promise<unknown>; signMessageV2(message: unknown): Promise<unknown> }
    }
  }
  hronautTron?: unknown
}

const target = window as TestWindow

beforeEach(() => {
  delete target.ethereum
  delete target.hronautEthereum
  delete target.solana
  delete target.hronautSolana
  delete target.tron
  delete target.hronautTron
  const listeners = new Set<(event: unknown) => void>()
  target.__hronautWalletBridge = {
    request: vi.fn(async (input: unknown) => ({ input })),
    subscribe: (listener) => { listeners.add(listener) },
    unsubscribe: (listener) => { listeners.delete(listener) }
  }
})

describe('wallet provider bootstrap', () => {
  it('announces an EIP-6963 provider and supports the EIP-1193 request surface', async () => {
    const announcements: CustomEvent[] = []
    window.addEventListener('eip6963:announceProvider', (event) => announcements.push(event as CustomEvent), { once: true })

    installHronautWalletProviders()

    expect(target.ethereum?.isHronaut).toBe(true)
    await expect(target.ethereum?.request({ method: 'eth_requestAccounts' })).resolves.toBeDefined()
    expect(target.__hronautWalletBridge?.request).toHaveBeenCalledWith({ family: 'evm', method: 'eth_requestAccounts' })
    expect(announcements).toHaveLength(1)
    expect(announcements[0]?.detail.info).toMatchObject({ name: 'Hronaut', rdns: 'dev.hronaut.wallet' })
    expect(Object.isFrozen(announcements[0]?.detail)).toBe(true)

    window.dispatchEvent(new Event('eip6963:requestProvider'))
  })

  it('returns EIP-1193 provider error codes instead of leaking raw IPC failures', async () => {
    installHronautWalletProviders()
    target.__hronautWalletBridge!.request.mockRejectedValueOnce(new Error('Unsupported EVM wallet method: wallet_dangerous'))

    await expect(target.ethereum?.request({ method: 'wallet_dangerous' })).rejects.toMatchObject({
      code: 4200,
      message: 'Unsupported EVM wallet method: wallet_dangerous'
    })
    target.__hronautWalletBridge!.request.mockRejectedValueOnce(new Error('Wallet request was rejected by the user'))
    await expect(target.ethereum?.request({ method: 'personal_sign' })).rejects.toMatchObject({ code: 4001 })
  })

  it('registers Solana Wallet Standard and exposes narrowly scoped legacy compatibility', async () => {
    const register = vi.fn()
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      ;(event as CustomEvent).detail({ register })
    }, { once: true })

    installHronautWalletProviders()

    expect(register).toHaveBeenCalledOnce()
    const wallet = register.mock.calls[0]?.[0]
    expect(wallet.features).toHaveProperty('standard:connect')
    expect(wallet.features).toHaveProperty('solana:signTransaction')
    target.__hronautWalletBridge!.request.mockResolvedValueOnce(Uint8Array.from([9, 8, 7]))
    const transaction = { serialize: vi.fn(() => Uint8Array.from([1, 2, 3])) }
    const signed = await target.solana?.signTransaction(transaction) as { serialize(): Uint8Array }
    expect([...signed.serialize()]).toEqual([9, 8, 7])
    expect(transaction.serialize).toHaveBeenCalledWith({ requireAllSignatures: false, verifySignatures: false })
    expect(target.__hronautWalletBridge?.request).toHaveBeenCalledWith({
      family: 'solana', method: 'signTransaction', params: [{
        transaction: Uint8Array.from([1, 2, 3]), compatibility: 'legacy'
      }]
    })
  })

  it('rejects non-serializable legacy Solana transaction objects before IPC', async () => {
    installHronautWalletProviders()

    await expect(target.solana?.signTransaction({ message: 'not a transaction' })).rejects.toThrow('serialize')
    expect(target.__hronautWalletBridge?.request).not.toHaveBeenCalled()
  })

  it('announces TIP-6963 without pretending to be TronLink', async () => {
    const announcements: CustomEvent[] = []
    window.addEventListener('TIP6963:announceProvider', (event) => announcements.push(event as CustomEvent), { once: true })

    installHronautWalletProviders()

    expect(target.tron?.isHronaut).toBe(true)
    expect(target.tron?.isTronLink).toBeUndefined()
    expect(target.tron?.tronWeb).toBe(false)
    target.__hronautWalletBridge!.request.mockResolvedValueOnce(['TExampleAddress'])
    await target.tron?.request({ method: 'eth_requestAccounts' })
    expect(target.__hronautWalletBridge?.request).toHaveBeenCalledWith({ family: 'tron', method: 'eth_requestAccounts' })
    expect(target.tron?.tronWeb).toMatchObject({ ready: true, defaultAddress: { base58: 'TExampleAddress' } })
    const transaction = { txID: 'a'.repeat(64), raw_data: { contract: [] } }
    const tronWeb = target.tron?.tronWeb
    if (!tronWeb) throw new Error('Expected authorized Tron compatibility surface')
    await tronWeb.trx.sign(transaction)
    expect(target.__hronautWalletBridge?.request).toHaveBeenCalledWith({
      family: 'tron', method: 'tron_signTransaction', params: [transaction]
    })
    expect(announcements[0]?.detail.info.rdns).toBe('dev.hronaut.wallet')
  })

  it('does not replace providers already installed by another wallet', () => {
    const existingEthereum = { request: vi.fn(async () => undefined), isHronaut: false }
    const existingSolana = { connect: vi.fn(async () => undefined), signTransaction: vi.fn(async () => undefined) }
    const existingTron = { request: vi.fn(async () => undefined), isHronaut: false, tronWeb: false as const }
    target.ethereum = existingEthereum
    target.solana = existingSolana
    target.tron = existingTron

    installHronautWalletProviders()

    expect(target.ethereum).toBe(existingEthereum)
    expect(target.solana).toBe(existingSolana)
    expect(target.tron).toBe(existingTron)
    expect(target.hronautEthereum).toBeDefined()
    expect(target.hronautSolana).toBeDefined()
    expect(target.hronautTron).toBeDefined()
  })
})
