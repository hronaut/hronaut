/*
 * This function is intentionally self-contained: Electron serializes it into the
 * page's main world. Trusted validation and signing remain in the main process.
 */
export function installHronautWalletProviders(): void {
  type ProviderFamily = 'evm' | 'solana' | 'tron'
  type ProviderEvent = 'accountsChanged' | 'chainChanged' | 'connect' | 'disconnect'
  type Listener = (...args: unknown[]) => void
  interface Bridge {
    request(input: { family: ProviderFamily; method: string; params?: unknown }): Promise<unknown>
    subscribe(listener: (event: { family: ProviderFamily; event: ProviderEvent; payload?: unknown }) => void): void
    unsubscribe(listener: (event: { family: ProviderFamily; event: ProviderEvent; payload?: unknown }) => void): void
  }

  const target = globalThis as typeof globalThis & {
    __hronautWalletBridge?: Bridge
    ethereum?: unknown
    hronautEthereum?: unknown
    solana?: unknown
    hronautSolana?: unknown
    tron?: unknown
    hronautTron?: unknown
  }
  const bridge = target.__hronautWalletBridge
  if (!bridge || target.hronautEthereum || target.hronautSolana || target.hronautTron) return

  const createEmitter = (family: ProviderFamily) => {
    const listeners = new Map<string, Array<{ listener: Listener; receiver: unknown }>>()
    const emit = (event: string, payload?: unknown): void => {
      for (const { listener, receiver } of [...(listeners.get(event) ?? [])]) {
        try { listener.call(receiver, payload) } catch { /* A page listener must not break provider delivery. */ }
      }
    }
    const remove = (event: string, listener: Listener): void => {
      if (typeof event !== 'string' || typeof listener !== 'function') throw new TypeError('Invalid wallet event listener')
      const entries = listeners.get(event)
      if (!entries) return
      let index = entries.length - 1
      while (index >= 0 && entries[index]?.listener !== listener) index -= 1
      if (index >= 0) entries.splice(index, 1)
      if (!entries.length) listeners.delete(event)
    }
    const receive = (message: { family: ProviderFamily; event: ProviderEvent; payload?: unknown }): void => {
      if (message.family !== family) return
      let payload = message.payload
      if ((family === 'evm' || family === 'tron') && message.event === 'disconnect') {
        const candidate = payload && typeof payload === 'object'
          ? payload as { code?: unknown; message?: unknown }
          : {}
        const code = typeof candidate.code === 'number' && Number.isInteger(candidate.code)
          ? candidate.code
          : family === 'tron' ? 4900 : 1000
        const errorMessage = typeof candidate.message === 'string'
          ? candidate.message
          : family === 'tron' ? 'Tron provider disconnected' : 'EVM provider disconnected'
        payload = Object.assign(new Error(errorMessage), { code })
      }
      emit(message.event, payload)
    }
    bridge.subscribe(receive)
    return Object.freeze({
      on(event: string, listener: Listener) {
        if (typeof event !== 'string' || typeof listener !== 'function') throw new TypeError('Invalid wallet event listener')
        const entries = listeners.get(event) ?? []
        entries.push({ listener, receiver: this })
        listeners.set(event, entries)
        return this
      },
      removeListener(event: string, listener: Listener) {
        remove(event, listener)
        return this
      },
      off(event: string, listener: Listener) {
        remove(event, listener)
        return this
      },
      emit
    })
  }

  const providerRequest = (family: ProviderFamily) => async (input: unknown): Promise<unknown> => {
    if (!input || typeof input !== 'object' || typeof (input as { method?: unknown }).method !== 'string') {
      throw Object.assign(new Error('Wallet request must include a method'), { code: -32600 })
    }
    const request = input as { method: string; params?: unknown }
    try {
      return await bridge.request({ family, method: request.method, ...(request.params === undefined ? {} : { params: request.params }) })
    } catch (cause) {
      const incoming = cause as { code?: unknown; message?: unknown }
      const message = typeof incoming?.message === 'string' ? incoming.message : 'Wallet request failed'
      const code = typeof incoming?.code === 'number' && Number.isInteger(incoming.code)
        ? incoming.code
        : /reject|denied/i.test(message)
          ? 4001
          : /permission|not permitted|not authorized/i.test(message)
            ? 4100
            : /unsupported/i.test(message)
              ? 4200
              : /no wallet is attached/i.test(message)
                ? 4900
                : /chain is not configured/i.test(message)
                  ? family === 'evm' ? 4902 : 4901
                  : /chain|network/i.test(message)
                    ? 4901
                    : -32603
      throw Object.assign(new Error(message), { code })
    }
  }

  const evmEvents = createEmitter('evm')
  const ethereum = Object.freeze({
    isHronaut: true,
    request: providerRequest('evm'),
    on: evmEvents.on,
    removeListener: evmEvents.removeListener
  })
  target.hronautEthereum = ethereum
  if (!target.ethereum) target.ethereum = ethereum

  const icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByeD0iMjAiIGZpbGw9IiM1YjVmZjUiLz48cGF0aCBkPSJNMjUgMjRoMTN2MTdoMjBWMjRoMTN2NDhINThWNTNIMzh2MTlIMjV6IiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg=='
  const uuid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : '9ef3a9e8-113d-4cb7-8d3f-9f5bc1a5da7d'
  const announceEvm = (): void => {
    const detail = Object.freeze({
      info: Object.freeze({ uuid, name: 'Hronaut', icon, rdns: 'dev.hronaut.wallet' }),
      provider: ethereum
    })
    globalThis.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
  }
  globalThis.addEventListener('eip6963:requestProvider', announceEvm)
  announceEvm()

  const solanaEvents = createEmitter('solana')
  interface LegacySolanaPublicKey {
    toBase58(): string
    toString(): string
    toBytes(): Uint8Array
  }
  const legacyPublicKeyFromAccount = (account: unknown): LegacySolanaPublicKey | null => {
    if (!account || typeof account !== 'object') return null
    const candidate = account as { address?: unknown; publicKey?: unknown }
    if (typeof candidate.address !== 'string' || !(candidate.publicKey instanceof Uint8Array)) return null
    const address = candidate.address
    const bytes = Uint8Array.from(candidate.publicKey)
    return Object.freeze({
      toBase58: () => address,
      toString: () => address,
      toBytes: () => Uint8Array.from(bytes)
    })
  }
  let solanaAccounts: readonly unknown[] = []
  let solanaChains: readonly string[] = Object.freeze([
    'solana:mainnet',
    'solana:devnet',
    'solana:testnet',
    'solana:localnet'
  ])
  let legacySolanaPublicKey: LegacySolanaPublicKey | null = null
  const standardEvents = new Set<(properties: {
    accounts?: readonly unknown[]
    chains?: readonly string[]
  }) => void>()
  const accountAddresses = (accounts: readonly unknown[]): string[] => accounts.flatMap((account) => (
    account && typeof account === 'object' && typeof (account as { address?: unknown }).address === 'string'
      ? [(account as { address: string }).address]
      : []
  ))
  const readonlySolanaAccount = (account: unknown): unknown => {
    if (!account || typeof account !== 'object') return account
    const candidate = account as {
      address?: unknown
      publicKey?: unknown
      chains?: unknown
      features?: unknown
      label?: unknown
      icon?: unknown
    }
    if (typeof candidate.address !== 'string' || !(candidate.publicKey instanceof Uint8Array)) return account
    const publicKey = Uint8Array.from(candidate.publicKey)
    const chains = Array.isArray(candidate.chains)
      ? candidate.chains.filter((value): value is string => typeof value === 'string')
      : []
    const features = Array.isArray(candidate.features)
      ? candidate.features.filter((value): value is string => typeof value === 'string')
      : []
    return Object.freeze({
      address: candidate.address,
      get publicKey() { return Uint8Array.from(publicKey) },
      get chains() { return [...chains] },
      get features() { return [...features] },
      ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
      ...(typeof candidate.icon === 'string' ? { icon: candidate.icon } : {})
    })
  }
  const sameSolanaAccount = (left: unknown, right: unknown): boolean => {
    if (!left || typeof left !== 'object' || !right || typeof right !== 'object') return Object.is(left, right)
    const previous = left as {
      address?: unknown
      publicKey?: unknown
      chains?: unknown
      features?: unknown
      label?: unknown
      icon?: unknown
    }
    const next = right as typeof previous
    if (
      typeof previous.address !== 'string'
      || !(previous.publicKey instanceof Uint8Array)
      || !Array.isArray(previous.chains)
      || !Array.isArray(previous.features)
      || typeof next.address !== 'string'
      || !(next.publicKey instanceof Uint8Array)
      || !Array.isArray(next.chains)
      || !Array.isArray(next.features)
    ) return Object.is(left, right)
    const previousPublicKey = previous.publicKey
    const nextPublicKey = next.publicKey
    const previousChains = previous.chains
    const nextChains = next.chains
    const previousFeatures = previous.features
    const nextFeatures = next.features
    return previous.address === next.address
      && previous.label === next.label
      && previous.icon === next.icon
      && previousPublicKey.length === nextPublicKey.length
      && previousPublicKey.every((value, index) => value === nextPublicKey[index])
      && previousChains.length === nextChains.length
      && previousChains.every((value, index) => value === nextChains[index])
      && previousFeatures.length === nextFeatures.length
      && previousFeatures.every((value, index) => value === nextFeatures[index])
  }
  const setSolanaAccounts = (accounts: readonly unknown[], notify: boolean): boolean => {
    const next = Object.freeze(accounts.map(readonlySolanaAccount))
    const changed = solanaAccounts.length !== next.length
      || solanaAccounts.some((account, index) => !sameSolanaAccount(account, next[index]))
    const discoveredChains = next.flatMap((account) => (
      account && typeof account === 'object' && Array.isArray((account as { chains?: unknown }).chains)
        ? (account as { chains: unknown[] }).chains.filter((value): value is string => typeof value === 'string')
        : []
    ))
    const nextChains = Object.freeze([...new Set([...solanaChains, ...discoveredChains])])
    const chainsChanged = nextChains.length !== solanaChains.length
    solanaAccounts = next
    solanaChains = nextChains
    legacySolanaPublicKey = legacyPublicKeyFromAccount(solanaAccounts[0])
    if (!notify || (!changed && !chainsChanged)) return changed
    for (const listener of standardEvents) {
      try {
        listener({
          ...(changed ? { accounts: solanaAccounts } : {}),
          ...(chainsChanged ? { chains: solanaChains } : {})
        })
      } catch { /* One app listener must not block the others. */ }
    }
    return changed
  }
  const solanaRequest = async (method: string, params?: unknown): Promise<unknown> => {
    const result = await bridge.request({ family: 'solana', method, ...(params === undefined ? {} : { params }) })
    if (method === 'connect' && result && typeof result === 'object' && Array.isArray((result as { accounts?: unknown }).accounts)) {
      const changed = setSolanaAccounts((result as { accounts: unknown[] }).accounts, true)
      if (changed && legacySolanaPublicKey) {
        solanaEvents.emit('connect', legacySolanaPublicKey)
        solanaEvents.emit('accountChanged', legacySolanaPublicKey)
        solanaEvents.emit('accountsChanged', accountAddresses(solanaAccounts))
      }
      return { ...(result as Record<string, unknown>), accounts: solanaAccounts }
    } else if (method === 'disconnect') {
      if (setSolanaAccounts([], true)) solanaEvents.emit('accountChanged', null)
    }
    return result
  }
  solanaEvents.on('accountsChanged', (accounts) => {
    const addresses = Array.isArray(accounts) ? accounts.filter((value): value is string => typeof value === 'string') : []
    const currentAddress = legacySolanaPublicKey?.toBase58()
    let changed = false
    if (!addresses.length) {
      changed = setSolanaAccounts([], true)
    } else if (currentAddress && !addresses.includes(currentAddress)) {
      changed = setSolanaAccounts([], true)
    }
    if (changed) solanaEvents.emit('accountChanged', legacySolanaPublicKey)
  })
  solanaEvents.on('disconnect', () => {
    if (setSolanaAccounts([], true)) solanaEvents.emit('accountChanged', null)
  })
  const solanaWallet = Object.freeze({
    version: '1.0.0',
    name: 'Hronaut',
    icon,
    get chains() { return solanaChains },
    get accounts() { return solanaAccounts },
    features: Object.freeze({
      'standard:connect': Object.freeze({ version: '1.0.0', connect: (input?: unknown) => solanaRequest('connect', input) }),
      'standard:disconnect': Object.freeze({ version: '1.0.0', disconnect: () => solanaRequest('disconnect') }),
      'standard:events': Object.freeze({
        version: '1.0.0',
        on: (event: string, listener: (properties: {
          accounts?: readonly unknown[]
          chains?: readonly string[]
        }) => void) => {
          if (event !== 'change') throw new Error(`Unsupported Solana wallet event: ${event}`)
          standardEvents.add(listener)
          return () => standardEvents.delete(listener)
        }
      }),
      'solana:signTransaction': Object.freeze({
        version: '1.0.0',
        supportedTransactionVersions: Object.freeze(['legacy']),
        signTransaction: (...inputs: unknown[]) => solanaRequest('signTransaction', inputs)
      }),
      'solana:signAndSendTransaction': Object.freeze({
        version: '1.0.0',
        supportedTransactionVersions: Object.freeze(['legacy']),
        signAndSendTransaction: (...inputs: unknown[]) => solanaRequest('signAndSendTransaction', inputs)
      }),
      'solana:signMessage': Object.freeze({ version: '1.0.0', signMessage: (...inputs: unknown[]) => solanaRequest('signMessage', inputs) })
    })
  })
  const registerSolana = (api: unknown): void => {
    const register = (api as { register?: unknown })?.register
    if (typeof register === 'function') register(solanaWallet)
  }
  const registerEvent = new CustomEvent('wallet-standard:register-wallet', { detail: registerSolana })
  globalThis.dispatchEvent(registerEvent)
  globalThis.addEventListener('wallet-standard:app-ready', (event) => registerSolana((event as CustomEvent).detail))

  const serializeLegacyTransaction = (transaction: unknown): { transaction: Uint8Array } => {
    if (transaction instanceof Uint8Array) return { transaction: Uint8Array.from(transaction) }
    const serialize = (transaction as { serialize?: unknown } | null)?.serialize
    if (typeof serialize !== 'function') throw new TypeError('Solana transaction must provide a serialize method')
    const value = serialize.call(transaction, { requireAllSignatures: false, verifySignatures: false })
    if (!(value instanceof Uint8Array)) throw new TypeError('Solana transaction serialization failed')
    return { transaction: Uint8Array.from(value) }
  }
  const legacySignedTransaction = async (transaction: unknown): Promise<unknown> => {
    const signed = await solanaRequest('legacy_signTransaction', [serializeLegacyTransaction(transaction)])
    if (!(signed instanceof Uint8Array)) throw new Error('Solana signing returned an invalid transaction')
    if (transaction instanceof Uint8Array) return Uint8Array.from(signed)
    if (!transaction || typeof transaction !== 'object') return signed
    return new Proxy(transaction as object, {
      get(target, property, receiver) {
        if (property === 'serialize') return () => Uint8Array.from(signed)
        return Reflect.get(target, property, receiver)
      }
    })
  }
  const legacySolana = Object.freeze({
    isHronaut: true,
    get publicKey() { return legacySolanaPublicKey },
    get isConnected() { return legacySolanaPublicKey !== null },
    connect: async (options?: unknown) => {
      await solanaRequest('connect', options)
      if (!legacySolanaPublicKey) throw new Error('Solana connection returned an invalid account')
      return { publicKey: legacySolanaPublicKey }
    },
    disconnect: () => solanaRequest('disconnect'),
    signTransaction: legacySignedTransaction,
    signAllTransactions: async (transactions: unknown[]) => {
      if (!Array.isArray(transactions) || !transactions.length) throw new TypeError('Solana transactions are required')
      const signed = await solanaRequest('legacy_signAllTransactions', transactions.map(serializeLegacyTransaction))
      if (!Array.isArray(signed) || signed.length !== transactions.length) throw new Error('Solana batch signing returned an invalid result')
      if (signed.some((bytes) => !(bytes instanceof Uint8Array))) throw new Error('Solana batch signing returned an invalid transaction')
      return transactions.map((transaction, index) => {
        const bytes = signed[index] as Uint8Array
        if (transaction instanceof Uint8Array) return Uint8Array.from(bytes)
        if (!transaction || typeof transaction !== 'object') return bytes
        return new Proxy(transaction as object, {
          get(target, property, receiver) {
            if (property === 'serialize') return () => Uint8Array.from(bytes)
            return Reflect.get(target, property, receiver)
          }
        })
      })
    },
    signAndSendTransaction: async (transaction: unknown, options?: unknown) => {
      const signature = await solanaRequest('legacy_signAndSendTransaction', [{
        ...serializeLegacyTransaction(transaction), options
      }])
      return { signature }
    },
    signMessage: (message: unknown, display?: unknown) => solanaRequest('legacy_signMessage', [{
      message: message instanceof Uint8Array ? Uint8Array.from(message) : message,
      display
    }]),
    on: solanaEvents.on,
    off: solanaEvents.off,
    removeListener: solanaEvents.removeListener
  })
  target.hronautSolana = legacySolana
  if (!target.solana) target.solana = legacySolana

  const tronEvents = createEmitter('tron')
  const requestTron = providerRequest('tron')
  const tronAddressToHex = (value: string | undefined): string | false => {
    if (!value || value.length !== 34) return false
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let decoded = 0n
    for (const character of value) {
      const digit = alphabet.indexOf(character)
      if (digit < 0) return false
      decoded = decoded * 58n + BigInt(digit)
    }
    const base58Check = decoded.toString(16).padStart(50, '0')
    return base58Check.length === 50 && base58Check.startsWith('41')
      ? base58Check.slice(0, 42)
      : false
  }
  let tronAddress: string | undefined
  const tronDefaultAddress = Object.freeze({
    get base58() { return tronAddress ?? false },
    get hex() { return tronAddressToHex(tronAddress) }
  })
  const tronWebCompatibility = Object.freeze({
    get ready() { return Boolean(tronAddress) },
    get defaultAddress() { return tronDefaultAddress },
    isConnected: () => Boolean(tronAddress),
    trx: Object.freeze({
      sign: (transaction: unknown) => requestTron({ method: 'tron_signTransaction', params: [transaction] }),
      signMessageV2: (message: unknown) => requestTron({ method: 'tron_signMessage', params: [message] })
    })
  })
  tronEvents.on('accountsChanged', (accounts) => {
    tronAddress = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : undefined
  })
  tronEvents.on('disconnect', () => { tronAddress = undefined })
  const tronRequest = async (input: unknown): Promise<unknown> => {
    const request = input as { method?: unknown }
    const result = await requestTron(input)
    if ((request.method === 'eth_requestAccounts' || request.method === 'eth_accounts') && Array.isArray(result)) {
      tronAddress = typeof result[0] === 'string' ? result[0] : undefined
    }
    return result
  }
  const tron = Object.freeze({
    isHronaut: true,
    request: tronRequest,
    get tronWeb() { return tronAddress ? tronWebCompatibility : false },
    on: tronEvents.on,
    removeListener: tronEvents.removeListener
  })
  target.hronautTron = tron
  if (!target.tron) target.tron = tron
  const announceTron = (): void => {
    globalThis.dispatchEvent(new CustomEvent('TIP6963:announceProvider', {
      detail: Object.freeze({
        info: Object.freeze({ uuid, name: 'Hronaut', icon, rdns: 'dev.hronaut.wallet' }),
        provider: tron
      })
    }))
  }
  globalThis.addEventListener('TIP6963:requestProvider', announceTron)
  announceTron()
}
