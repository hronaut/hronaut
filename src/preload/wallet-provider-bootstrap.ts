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
    const listeners = new Map<string, Set<Listener>>()
    const receive = (message: { family: ProviderFamily; event: ProviderEvent; payload?: unknown }): void => {
      if (message.family !== family) return
      for (const listener of listeners.get(message.event) ?? []) {
        try { listener(message.payload) } catch { /* A page listener must not break provider delivery. */ }
      }
    }
    bridge.subscribe(receive)
    return Object.freeze({
      on(event: string, listener: Listener) {
        if (typeof event !== 'string' || typeof listener !== 'function') throw new TypeError('Invalid wallet event listener')
        const entries = listeners.get(event) ?? new Set<Listener>()
        entries.add(listener)
        listeners.set(event, entries)
        return this
      },
      removeListener(event: string, listener: Listener) {
        listeners.get(event)?.delete(listener)
        return this
      }
    })
  }

  const providerRequest = (family: ProviderFamily) => async (input: unknown): Promise<unknown> => {
    if (!input || typeof input !== 'object' || typeof (input as { method?: unknown }).method !== 'string') {
      throw new TypeError('Wallet request must include a method')
    }
    const request = input as { method: string; params?: unknown }
    try {
      return await bridge.request({ family, method: request.method, ...(request.params === undefined ? {} : { params: request.params }) })
    } catch (cause) {
      const incoming = cause as { code?: unknown; message?: unknown }
      const message = typeof incoming?.message === 'string' ? incoming.message : 'Wallet request failed'
      const code = typeof incoming?.code === 'number'
        ? incoming.code
        : /reject|denied/i.test(message)
          ? 4001
          : /permission|not permitted|not authorized/i.test(message)
            ? 4100
            : /unsupported/i.test(message)
              ? 4200
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

  const icon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2220%22 fill=%22%235b5ff5%22/%3E%3Cpath d=%22M25 24h13v17h20V24h13v48H58V53H38v19H25z%22 fill=%22white%22/%3E%3C/svg%3E'
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
  let legacySolanaPublicKey: LegacySolanaPublicKey | null = null
  const solanaRequest = async (method: string, params?: unknown): Promise<unknown> => {
    const result = await bridge.request({ family: 'solana', method, ...(params === undefined ? {} : { params }) })
    if (method === 'connect' && result && typeof result === 'object' && Array.isArray((result as { accounts?: unknown }).accounts)) {
      solanaAccounts = Object.freeze([...(result as { accounts: unknown[] }).accounts])
      legacySolanaPublicKey = legacyPublicKeyFromAccount(solanaAccounts[0])
    } else if (method === 'disconnect') {
      solanaAccounts = []
      legacySolanaPublicKey = null
    }
    return result
  }
  const standardEvents = new Set<(properties: { accounts?: readonly unknown[] }) => void>()
  solanaEvents.on('accountsChanged', (accounts) => {
    const addresses = Array.isArray(accounts) ? accounts.filter((value): value is string => typeof value === 'string') : []
    const currentAddress = legacySolanaPublicKey?.toBase58()
    if (!addresses.length) {
      solanaAccounts = []
      legacySolanaPublicKey = null
    } else if (!addresses.includes(currentAddress ?? '')) {
      solanaAccounts = []
      legacySolanaPublicKey = null
    }
    for (const listener of standardEvents) listener({ accounts: solanaAccounts })
  })
  const solanaWallet = Object.freeze({
    version: '1.0.0',
    name: 'Hronaut',
    icon,
    chains: Object.freeze(['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet']),
    get accounts() { return solanaAccounts },
    features: Object.freeze({
      'standard:connect': Object.freeze({ version: '1.0.0', connect: (input?: unknown) => solanaRequest('connect', input) }),
      'standard:disconnect': Object.freeze({ version: '1.0.0', disconnect: () => solanaRequest('disconnect') }),
      'standard:events': Object.freeze({
        version: '1.0.0',
        on: (event: string, listener: (properties: { accounts?: readonly unknown[] }) => void) => {
          if (event !== 'change') throw new Error(`Unsupported Solana wallet event: ${event}`)
          standardEvents.add(listener)
          return () => standardEvents.delete(listener)
        }
      }),
      'solana:signTransaction': Object.freeze({ version: '1.0.0', signTransaction: (...inputs: unknown[]) => solanaRequest('signTransaction', inputs) }),
      'solana:signAndSendTransaction': Object.freeze({ version: '1.0.0', signAndSendTransaction: (...inputs: unknown[]) => solanaRequest('signAndSendTransaction', inputs) }),
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

  const serializeLegacyTransaction = (transaction: unknown): { transaction: Uint8Array; compatibility: 'legacy' } => {
    if (transaction instanceof Uint8Array) return { transaction: Uint8Array.from(transaction), compatibility: 'legacy' }
    const serialize = (transaction as { serialize?: unknown } | null)?.serialize
    if (typeof serialize !== 'function') throw new TypeError('Solana transaction must provide a serialize method')
    const value = serialize.call(transaction, { requireAllSignatures: false, verifySignatures: false })
    if (!(value instanceof Uint8Array)) throw new TypeError('Solana transaction serialization failed')
    return { transaction: Uint8Array.from(value), compatibility: 'legacy' }
  }
  const legacySignedTransaction = async (transaction: unknown): Promise<unknown> => {
    const signed = await solanaRequest('signTransaction', [serializeLegacyTransaction(transaction)])
    if (!(signed instanceof Uint8Array)) throw new Error('Solana signing returned an invalid transaction')
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
      const signed = await solanaRequest('signAllTransactions', transactions.map(serializeLegacyTransaction))
      if (!Array.isArray(signed) || signed.length !== transactions.length) throw new Error('Solana batch signing returned an invalid result')
      return transactions.map((transaction, index) => {
        const bytes = signed[index]
        if (!(bytes instanceof Uint8Array) || !transaction || typeof transaction !== 'object') return bytes
        return new Proxy(transaction as object, {
          get(target, property, receiver) {
            if (property === 'serialize') return () => Uint8Array.from(bytes)
            return Reflect.get(target, property, receiver)
          }
        })
      })
    },
    signAndSendTransaction: async (transaction: unknown, options?: unknown) => {
      const signature = await solanaRequest('signAndSendTransaction', [{
        ...serializeLegacyTransaction(transaction), options
      }])
      return { signature }
    },
    signMessage: (message: unknown, display?: unknown) => solanaRequest('signMessage', [{
      message: message instanceof Uint8Array ? Uint8Array.from(message) : message,
      display,
      compatibility: 'legacy'
    }]),
    on: solanaEvents.on,
    removeListener: solanaEvents.removeListener
  })
  target.hronautSolana = legacySolana
  if (!target.solana) target.solana = legacySolana

  const tronEvents = createEmitter('tron')
  let tronAddress: string | undefined
  const tronDefaultAddress = Object.freeze({
    get base58() { return tronAddress ?? false },
    get hex() { return false }
  })
  const tronWebCompatibility = Object.freeze({
    get ready() { return Boolean(tronAddress) },
    get defaultAddress() { return tronDefaultAddress },
    isConnected: () => Boolean(tronAddress),
    trx: Object.freeze({
      sign: (transaction: unknown) => bridge.request({ family: 'tron', method: 'tron_signTransaction', params: [transaction] }),
      signMessageV2: (message: unknown) => bridge.request({ family: 'tron', method: 'tron_signMessage', params: [message] })
    })
  })
  bridge.subscribe((event) => {
    if (event.family !== 'tron') return
    if (event.event === 'accountsChanged') {
      tronAddress = Array.isArray(event.payload) && typeof event.payload[0] === 'string' ? event.payload[0] : undefined
    } else if (event.event === 'disconnect') {
      tronAddress = undefined
    }
  })
  const tronRequest = async (input: unknown): Promise<unknown> => {
    if (!input || typeof input !== 'object' || typeof (input as { method?: unknown }).method !== 'string') {
      throw new TypeError('Wallet request must include a method')
    }
    const request = input as { method: string; params?: unknown }
    const result = await bridge.request({
      family: 'tron', method: request.method, ...(request.params === undefined ? {} : { params: request.params })
    })
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
