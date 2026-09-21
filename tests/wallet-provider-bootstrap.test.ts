// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installHronautWalletProviders } from '../src/preload/wallet-provider-bootstrap.js'

interface TestWindow extends Window {
  __hronautWalletBridge?: {
    request: ReturnType<typeof vi.fn>
    subscribe(listener: (event: unknown) => void): void
    unsubscribe(listener: (event: unknown) => void): void
  }
  ethereum?: {
    request(input: unknown): Promise<unknown>
    isHronaut: boolean
    on(event: string, listener: (...args: unknown[]) => void): TestWindow['ethereum']
    removeListener(event: string, listener: (...args: unknown[]) => void): TestWindow['ethereum']
  }
  hronautEthereum?: unknown
  solana?: {
    readonly publicKey: null | {
      toBase58(): string
      toString(): string
      toBytes(): Uint8Array
    }
    readonly isConnected: boolean
    connect(): Promise<{ publicKey: NonNullable<TestWindow['solana']>['publicKey'] }>
    disconnect(): Promise<unknown>
    signTransaction(value: unknown): Promise<unknown>
    signAllTransactions(values: unknown[]): Promise<unknown[]>
    on(event: string, listener: (...args: unknown[]) => void): TestWindow['solana']
    off(event: string, listener: (...args: unknown[]) => void): TestWindow['solana']
    removeListener(event: string, listener: (...args: unknown[]) => void): TestWindow['solana']
  }
  hronautSolana?: unknown
  tron?: {
    request(input: unknown): Promise<unknown>
    isHronaut: boolean
    isTronLink?: boolean
    on(event: string, listener: (...args: unknown[]) => void): TestWindow['tron']
    removeListener(event: string, listener: (...args: unknown[]) => void): TestWindow['tron']
    tronWeb: false | {
      ready: boolean
      defaultAddress: { base58: string | false }
      trx: { sign(transaction: unknown): Promise<unknown>; signMessageV2(message: unknown): Promise<unknown> }
    }
  }
  hronautTron?: unknown
}

const target = window as TestWindow
let emitWalletEvent: (event: unknown) => void

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
  emitWalletEvent = (event) => {
    for (const listener of listeners) listener(event)
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
    target.__hronautWalletBridge!.request.mockRejectedValueOnce(
      new Error('No wallet is attached to this workspace for the requested chain')
    )
    await expect(target.ethereum?.request({ method: 'eth_chainId' })).rejects.toMatchObject({ code: 4900 })
  })

  it('delivers EIP-1193 connect information and a ProviderRpcError on disconnect', () => {
    installHronautWalletProviders()
    const connected = vi.fn()
    const disconnected = vi.fn()
    target.ethereum?.on('connect', connected)
    target.ethereum?.on('disconnect', disconnected)

    emitWalletEvent({ family: 'evm', event: 'connect', payload: { chainId: '0xaa36a7' } })
    emitWalletEvent({
      family: 'evm', event: 'disconnect', payload: { code: 1000, message: 'EVM provider disconnected' }
    })

    expect(connected).toHaveBeenCalledWith({ chainId: '0xaa36a7' })
    const error = disconnected.mock.calls[0]?.[0]
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ code: 1000, message: 'EVM provider disconnected' })
  })

  it('snapshots EIP-1193 listeners before delivering an event', () => {
    installHronautWalletProviders()
    const calls: string[] = []
    const addedDuringDelivery = () => { calls.push('added') }
    const removedDuringDelivery = () => { calls.push('removed') }
    const first = () => {
      calls.push('first')
      target.ethereum?.removeListener('accountsChanged', removedDuringDelivery)
      target.ethereum?.on('accountsChanged', addedDuringDelivery)
    }
    target.ethereum?.on('accountsChanged', first)
    target.ethereum?.on('accountsChanged', removedDuringDelivery)

    emitWalletEvent({ family: 'evm', event: 'accountsChanged', payload: ['0x01'] })
    expect(calls).toEqual(['first', 'removed'])

    calls.length = 0
    emitWalletEvent({ family: 'evm', event: 'accountsChanged', payload: ['0x02'] })
    expect(calls).toEqual(['first', 'added'])
  })

  it('supports duplicate EIP-1193 listener registrations and removes one at a time', () => {
    installHronautWalletProviders()
    const listener = vi.fn()
    target.ethereum?.on('chainChanged', listener)
    target.ethereum?.on('chainChanged', listener)

    emitWalletEvent({ family: 'evm', event: 'chainChanged', payload: '0x1' })
    expect(listener).toHaveBeenCalledTimes(2)

    target.ethereum?.removeListener('chainChanged', listener)
    emitWalletEvent({ family: 'evm', event: 'chainChanged', payload: '0x2' })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('registers Solana Wallet Standard and exposes narrowly scoped legacy compatibility', async () => {
    const register = vi.fn()
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      ;(event as CustomEvent).detail({ register })
    }, { once: true })

    installHronautWalletProviders()

    expect(register).toHaveBeenCalledOnce()
    const wallet = register.mock.calls[0]?.[0]
    expect(wallet.icon).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/)
    expect(atob(wallet.icon.split(',')[1])).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(wallet.features).toHaveProperty('standard:connect')
    expect(wallet.features).toHaveProperty('solana:signTransaction')
    expect(wallet.features['solana:signTransaction'].supportedTransactionVersions).toEqual(['legacy'])
    expect(wallet.features['solana:signAndSendTransaction'].supportedTransactionVersions).toEqual(['legacy'])
    expect(Object.isFrozen(wallet.features['solana:signTransaction'].supportedTransactionVersions)).toBe(true)
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

  it('maps an unconfigured EVM chain to the wallet-standard 4902 error', async () => {
    installHronautWalletProviders()
    target.__hronautWalletBridge!.request.mockRejectedValueOnce(
      new Error('Requested EVM chain is not configured for this workspace wallet')
    )

    await expect(target.ethereum?.request({
      method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }]
    })).rejects.toMatchObject({ code: 4902 })
  })

  it('publishes legacy Solana connection state after the user selects Hronaut', async () => {
    const address = 'HronautSolanaWalletAddress'
    const publicKeyBytes = Uint8Array.from([1, 2, 3, 4])
    target.__hronautWalletBridge!.request.mockResolvedValueOnce({
      accounts: [{
        address,
        publicKey: publicKeyBytes,
        chains: ['solana:devnet'],
        features: ['solana:signTransaction'],
        label: 'Solana developer account'
      }]
    })
    installHronautWalletProviders()

    expect(target.solana?.publicKey).toBeNull()
    expect(target.solana?.isConnected).toBe(false)

    const connected = await target.solana?.connect()

    expect(connected?.publicKey?.toBase58()).toBe(address)
    expect(connected?.publicKey?.toString()).toBe(address)
    expect([...connected!.publicKey!.toBytes()]).toEqual([...publicKeyBytes])
    expect(target.solana?.publicKey?.toBase58()).toBe(address)
    expect(target.solana?.isConnected).toBe(true)

    const returnedBytes = connected!.publicKey!.toBytes()
    returnedBytes[0] = 255
    expect([...target.solana!.publicKey!.toBytes()]).toEqual([...publicKeyBytes])

    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [address] })
    expect(target.solana?.isConnected).toBe(true)

    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [] })
    expect(target.solana?.publicKey).toBeNull()
    expect(target.solana?.isConnected).toBe(false)

    target.__hronautWalletBridge!.request.mockResolvedValueOnce(undefined)
    await target.solana?.disconnect()
    expect(target.solana?.publicKey).toBeNull()
    expect(target.solana?.isConnected).toBe(false)
  })

  it('publishes legacy Solana accountChanged events with current provider state', async () => {
    const address = 'HronautSolanaWalletAddress'
    const publicKeyBytes = Uint8Array.from([1, 2, 3, 4])
    target.__hronautWalletBridge!.request.mockResolvedValueOnce({
      accounts: [{
        address,
        publicKey: publicKeyBytes,
        chains: ['solana:devnet'],
        features: ['solana:signMessage']
      }]
    })
    installHronautWalletProviders()
    const accountChanges: Array<{ address: string | null; connected: boolean }> = []
    target.solana?.on('accountChanged', (publicKey) => {
      accountChanges.push({
        address: publicKey && typeof publicKey === 'object' && 'toBase58' in publicKey
          ? (publicKey as { toBase58(): string }).toBase58()
          : null,
        connected: target.solana?.isConnected ?? false
      })
    })

    await target.solana?.connect()
    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [address] })
    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [] })
    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [] })

    expect(accountChanges).toEqual([
      { address, connected: true },
      { address: null, connected: false }
    ])
  })

  it('publishes a legacy Solana accountChanged event when disconnect resolves before provider events', async () => {
    const address = 'HronautSolanaWalletAddress'
    target.__hronautWalletBridge!.request
      .mockResolvedValueOnce({
        accounts: [{
          address,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          chains: ['solana:devnet'],
          features: ['solana:signMessage']
        }]
      })
      .mockResolvedValueOnce(undefined)
    installHronautWalletProviders()
    const accountChanges: Array<string | null> = []
    target.solana?.on('accountChanged', (publicKey) => {
      accountChanges.push(publicKey && typeof publicKey === 'object' && 'toBase58' in publicKey
        ? (publicKey as { toBase58(): string }).toBase58()
        : null)
    })

    await target.solana?.connect()
    await target.solana?.disconnect()
    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [] })
    emitWalletEvent({ family: 'solana', event: 'disconnect' })

    expect(accountChanges).toEqual([address, null])
    expect(target.solana?.publicKey).toBeNull()
    expect(target.solana?.isConnected).toBe(false)
  })

  it('publishes Wallet Standard account changes only after complete account state is available', async () => {
    const register = vi.fn()
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      ;(event as CustomEvent).detail({ register })
    }, { once: true })
    let resolveConnect!: (value: unknown) => void
    target.__hronautWalletBridge!.request.mockImplementationOnce(() => new Promise(resolve => { resolveConnect = resolve }))
    installHronautWalletProviders()
    const wallet = register.mock.calls[0]?.[0] as {
      readonly accounts: readonly unknown[]
      features: {
        'standard:connect': { connect(): Promise<unknown> }
        'standard:disconnect': { disconnect(): Promise<unknown> }
        'standard:events': { on(event: string, listener: (properties: { accounts?: readonly unknown[] }) => void): () => void }
      }
    }
    const changes = vi.fn()
    wallet.features['standard:events'].on('change', changes)
    const legacyAccountStates: Array<{ accounts: unknown; connected: boolean }> = []
    const address = 'HronautSolanaWalletAddress'
    const account = {
      address,
      publicKey: Uint8Array.from([1, 2, 3, 4]),
      chains: ['solana:devnet'],
      features: ['solana:signTransaction'],
      label: 'Solana developer account'
    }

    const connecting = wallet.features['standard:connect'].connect()
    emitWalletEvent({ family: 'solana', event: 'accountsChanged', payload: [address] })
    expect(changes).not.toHaveBeenCalled()
    expect(wallet.accounts).toEqual([])
    target.solana?.on('accountsChanged', (accounts) => {
      legacyAccountStates.push({ accounts, connected: target.solana?.isConnected ?? false })
    })
    resolveConnect({ accounts: [account] })
    await connecting

    expect(wallet.accounts).toEqual([account])
    expect(changes).toHaveBeenCalledOnce()
    expect(changes).toHaveBeenLastCalledWith({ accounts: [account] })
    expect(legacyAccountStates).toEqual([{ accounts: [address], connected: true }])

    const legacyDisconnectStates: boolean[] = []
    target.solana?.on('disconnect', () => legacyDisconnectStates.push(target.solana?.isConnected ?? true))
    emitWalletEvent({ family: 'solana', event: 'disconnect' })
    expect(wallet.accounts).toEqual([])
    expect(changes).toHaveBeenCalledTimes(2)
    expect(changes).toHaveBeenLastCalledWith({ accounts: [] })
    expect(legacyDisconnectStates).toEqual([false])

    target.__hronautWalletBridge!.request.mockResolvedValueOnce(undefined)
    await wallet.features['standard:disconnect'].disconnect()
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('keeps Wallet Standard accounts read-only when a website mutates returned values', async () => {
    const register = vi.fn()
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      ;(event as CustomEvent).detail({ register })
    }, { once: true })
    const sourceAccount = {
      address: 'HronautSolanaWalletAddress',
      publicKey: Uint8Array.from([1, 2, 3, 4]),
      chains: ['solana:devnet'],
      features: ['solana:signMessage'],
      label: 'Solana developer account'
    }
    target.__hronautWalletBridge!.request.mockResolvedValueOnce({ accounts: [sourceAccount] })
    installHronautWalletProviders()
    const wallet = register.mock.calls[0]?.[0] as {
      readonly accounts: ReadonlyArray<{
        readonly address: string
        readonly publicKey: Uint8Array
        readonly chains: readonly string[]
        readonly features: readonly string[]
      }>
      features: { 'standard:connect': { connect(): Promise<{ accounts: typeof wallet.accounts }> } }
    }

    const connected = await wallet.features['standard:connect'].connect()
    const returned = connected.accounts[0]!
    returned.publicKey[0] = 255
    ;(returned.chains as string[]).push('solana:mainnet')
    ;(returned.features as string[]).length = 0
    sourceAccount.address = 'MutatedSourceAddress'
    sourceAccount.publicKey[1] = 255

    expect(wallet.accounts[0]).toMatchObject({
      address: 'HronautSolanaWalletAddress',
      chains: ['solana:devnet'],
      features: ['solana:signMessage']
    })
    expect([...wallet.accounts[0]!.publicKey]).toEqual([1, 2, 3, 4])
    expect(Object.isFrozen(wallet.accounts[0])).toBe(true)
  })

  it('notifies Wallet Standard apps when account metadata changes without an address change', async () => {
    const register = vi.fn()
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      ;(event as CustomEvent).detail({ register })
    }, { once: true })
    const address = 'HronautSolanaWalletAddress'
    target.__hronautWalletBridge!.request
      .mockResolvedValueOnce({
        accounts: [{
          address,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          chains: ['solana:devnet'],
          features: ['solana:signMessage']
        }]
      })
      .mockResolvedValueOnce({
        accounts: [{
          address,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          chains: ['solana:mainnet'],
          features: ['solana:signTransaction', 'solana:signMessage']
        }]
      })
    installHronautWalletProviders()
    const wallet = register.mock.calls[0]?.[0] as {
      readonly accounts: ReadonlyArray<{ readonly chains: readonly string[]; readonly features: readonly string[] }>
      features: {
        'standard:connect': { connect(): Promise<unknown> }
        'standard:events': { on(event: string, listener: (properties: { accounts?: readonly unknown[] }) => void): () => void }
      }
    }
    const changes = vi.fn()
    wallet.features['standard:events'].on('change', changes)

    await wallet.features['standard:connect'].connect()
    await wallet.features['standard:connect'].connect()

    expect(changes).toHaveBeenCalledTimes(2)
    expect(wallet.accounts[0]).toMatchObject({
      chains: ['solana:mainnet'],
      features: ['solana:signTransaction', 'solana:signMessage']
    })
  })

  it('returns a ProviderRpcError for malformed EIP-1193 request arguments', async () => {
    installHronautWalletProviders()

    await expect(target.ethereum?.request(null)).rejects.toMatchObject({
      code: -32600,
      message: 'Wallet request must include a method'
    })
    expect(target.__hronautWalletBridge?.request).not.toHaveBeenCalled()
  })

  it('supports adapter-compatible Solana event cleanup through off', () => {
    installHronautWalletProviders()
    const listener = vi.fn()

    expect(target.solana?.on('disconnect', listener)).toBe(target.solana)
    emitWalletEvent({ family: 'solana', event: 'disconnect' })
    expect(listener).toHaveBeenCalledOnce()

    expect(target.solana?.off('disconnect', listener)).toBe(target.solana)
    emitWalletEvent({ family: 'solana', event: 'disconnect' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('rejects non-serializable legacy Solana transaction objects before IPC', async () => {
    installHronautWalletProviders()

    await expect(target.solana?.signTransaction({ message: 'not a transaction' })).rejects.toThrow('serialize')
    expect(target.__hronautWalletBridge?.request).not.toHaveBeenCalled()
  })

  it('returns usable bytes for legacy Solana serialized transaction inputs', async () => {
    target.__hronautWalletBridge!.request
      .mockResolvedValueOnce(Uint8Array.from([5, 6, 7]))
      .mockResolvedValueOnce([
        Uint8Array.from([8, 9]),
        Uint8Array.from([10, 11])
      ])
    installHronautWalletProviders()

    const signed = await target.solana?.signTransaction(Uint8Array.from([1, 2, 3]))
    const signedBatch = await target.solana?.signAllTransactions([
      Uint8Array.from([1, 2]),
      Uint8Array.from([3, 4])
    ])

    expect(signed).toBeInstanceOf(Uint8Array)
    expect([...(signed as Uint8Array)]).toEqual([5, 6, 7])
    expect(signedBatch).toHaveLength(2)
    expect([...signedBatch![0] as Uint8Array]).toEqual([8, 9])
    expect([...signedBatch![1] as Uint8Array]).toEqual([10, 11])
  })

  it('rejects a malformed legacy Solana batch-signing response', async () => {
    target.__hronautWalletBridge!.request.mockResolvedValueOnce([
      Uint8Array.from([8, 9]),
      'not signed transaction bytes'
    ])
    installHronautWalletProviders()

    await expect(target.solana?.signAllTransactions([
      Uint8Array.from([1, 2]),
      Uint8Array.from([3, 4])
    ])).rejects.toThrow(/invalid transaction/i)
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

  it('returns TIP-1193 provider errors for Tron requests and compatibility calls', async () => {
    installHronautWalletProviders()
    target.__hronautWalletBridge!.request.mockRejectedValueOnce(
      new Error('Unsupported Tron wallet method: dangerous')
    )
    await expect(target.tron?.request({ method: 'dangerous' })).rejects.toMatchObject({
      code: 4200,
      message: 'Unsupported Tron wallet method: dangerous'
    })

    target.__hronautWalletBridge!.request.mockRejectedValueOnce(
      new Error('Requested Tron network is not configured for this workspace wallet')
    )
    await expect(target.tron?.request({
      method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }]
    })).rejects.toMatchObject({ code: 4901 })

    await expect(target.tron?.request(null)).rejects.toMatchObject({
      code: -32600,
      message: 'Wallet request must include a method'
    })

    emitWalletEvent({ family: 'tron', event: 'accountsChanged', payload: ['TExampleAddress'] })
    target.__hronautWalletBridge!.request.mockRejectedValueOnce(new Error('Wallet request was rejected by the user'))
    const tronWeb = target.tron?.tronWeb
    if (!tronWeb) throw new Error('Expected authorized Tron compatibility surface')
    await expect(tronWeb.trx.sign({ txID: 'transaction' })).rejects.toMatchObject({ code: 4001 })
  })

  it('updates Tron account state before events and emits typed connection transitions', () => {
    installHronautWalletProviders()
    const accountStates: Array<string | false> = []
    const connections = vi.fn()
    const disconnections: unknown[] = []
    target.tron?.on('accountsChanged', () => {
      accountStates.push(target.tron?.tronWeb ? target.tron.tronWeb.defaultAddress.base58 : false)
    })
    target.tron?.on('connect', connections)
    target.tron?.on('disconnect', (error) => {
      accountStates.push(target.tron?.tronWeb ? target.tron.tronWeb.defaultAddress.base58 : false)
      disconnections.push(error)
    })

    emitWalletEvent({ family: 'tron', event: 'accountsChanged', payload: ['TExampleAddress'] })
    emitWalletEvent({ family: 'tron', event: 'connect', payload: { chainId: '0x94a9059e' } })
    emitWalletEvent({ family: 'tron', event: 'disconnect' })

    expect(accountStates).toEqual(['TExampleAddress', false])
    expect(connections).toHaveBeenCalledWith({ chainId: '0x94a9059e' })
    expect(disconnections[0]).toBeInstanceOf(Error)
    expect(disconnections[0]).toMatchObject({ code: 4900, message: 'Tron provider disconnected' })
  })

  it('does not replace providers already installed by another wallet', () => {
    const existingEthereum = {
      request: vi.fn(async () => undefined),
      isHronaut: false,
      on: vi.fn(() => undefined),
      removeListener: vi.fn(() => undefined)
    }
    const existingSolana = {
      publicKey: null,
      isConnected: false,
      connect: vi.fn(async () => ({ publicKey: null })),
      disconnect: vi.fn(async () => undefined),
      signTransaction: vi.fn(async () => undefined),
      signAllTransactions: vi.fn(async () => []),
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn()
    }
    const existingTron = {
      request: vi.fn(async () => undefined),
      isHronaut: false,
      tronWeb: false as const,
      on: vi.fn(() => undefined),
      removeListener: vi.fn(() => undefined)
    }
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
