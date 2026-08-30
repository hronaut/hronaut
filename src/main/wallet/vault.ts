import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { WalletDescriptorSchema, type WalletDescriptor, type WalletSecretFormat } from '../../shared/wallet.js'
import { writeTextFileAtomically } from '../atomic-file.js'
import {
  decryptWalletSecret,
  encryptWalletSecret,
  generateWalletDataEncryptionKey,
  rotateWalletSecret,
  type EncryptedWalletSecret
} from './crypto.js'
import type { PersistedWalletKeyProtection, WalletKeyWrapper } from './key-provider.js'

export type { WalletSecretFormat } from '../../shared/wallet.js'

export interface WalletSecret {
  format: WalletSecretFormat
  material: Buffer
}

interface PersistedWalletRecord {
  walletId: string
  encrypted: EncryptedWalletSecret
}

interface PersistedWalletVault {
  version: 1
  keyProtection: PersistedWalletKeyProtection
  wallets: WalletDescriptor[]
  records: PersistedWalletRecord[]
}

const EncryptedSecretSchema = z.object({
  algorithm: z.literal('xchacha20-poly1305'),
  nonce: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(131_072)
}).strict()

const ArgonParametersSchema = z.object({
  memoryKiB: z.number().int().min(8 * 1024).max(1024 * 1024),
  passes: z.number().int().min(1).max(16),
  parallelism: z.number().int().min(1).max(16)
}).strict()

const KeyProtectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('safe-storage'), wrappedKey: z.string().min(1).max(65_536) }).strict(),
  z.object({
    mode: z.literal('passphrase'),
    salt: z.string().min(1).max(128),
    parameters: ArgonParametersSchema,
    wrappedKey: EncryptedSecretSchema
  }).strict()
])

const PersistedVaultBodySchema = z.object({
  keyProtection: KeyProtectionSchema,
  wallets: z.array(WalletDescriptorSchema).max(10_000),
  records: z.array(z.object({
    walletId: z.string().min(1).max(128),
    encrypted: EncryptedSecretSchema
  }).strict()).max(10_000)
}).strict()

const PersistedVaultSchema = PersistedVaultBodySchema.extend({ version: z.literal(1) }).strict()
const LegacyPersistedVaultSchema = PersistedVaultBodySchema.extend({ version: z.literal(0) }).strict()

function migratePersistedVault(value: unknown): { document: PersistedWalletVault; migrated: boolean } {
  const envelope = z.object({ version: z.number().int() }).passthrough().parse(value)
  if (envelope.version === 1) {
    return { document: PersistedVaultSchema.parse(value) as PersistedWalletVault, migrated: false }
  }
  if (envelope.version === 0) {
    const legacy = LegacyPersistedVaultSchema.parse(value)
    return {
      document: {
        version: 1,
        keyProtection: legacy.keyProtection,
        wallets: legacy.wallets,
        records: legacy.records
      } as PersistedWalletVault,
      migrated: true
    }
  }
  throw new Error('Unsupported wallet vault schema version')
}

export async function readWalletVaultProtectionMode(path: string): Promise<PersistedWalletKeyProtection['mode']> {
  try {
    return migratePersistedVault(JSON.parse(await readFile(path, 'utf8'))).document.keyProtection.mode
  } catch {
    throw new Error('Wallet vault file is invalid')
  }
}

function cloneDescriptor(descriptor: WalletDescriptor): WalletDescriptor {
  return structuredClone(descriptor)
}

function encodeSecret(secret: WalletSecret): Buffer {
  if (!secret.material.length || secret.material.length > 65_536) throw new TypeError('Wallet signing material is invalid')
  const formatByte = secret.format === 'private-key' ? 1 : secret.format === 'mnemonic' ? 2 : 0
  if (!formatByte) throw new TypeError('Unsupported wallet secret format')
  return Buffer.concat([Buffer.from([formatByte]), secret.material])
}

function decodeSecret(value: Buffer): WalletSecret {
  if (value.length < 2 || (value[0] !== 1 && value[0] !== 2)) throw new Error('Wallet vault record is invalid')
  return {
    format: value[0] === 1 ? 'private-key' : 'mnemonic',
    material: Buffer.from(value.subarray(1))
  }
}

export class WalletVault {
  private readonly wallets = new Map<string, WalletDescriptor>()
  private readonly records = new Map<string, PersistedWalletRecord>()
  private keyProtection: PersistedWalletKeyProtection | undefined
  private dataEncryptionKey: Buffer | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly keyWrapper: WalletKeyWrapper
  ) {}

  async initialize(passphrase?: Uint8Array): Promise<void> {
    await this.queueMutation(async () => {
      if (this.keyProtection || this.wallets.size || this.records.size) throw new Error('Wallet vault is already initialized')
      const key = generateWalletDataEncryptionKey()
      try {
        const protection = await this.keyWrapper.wrap(key, passphrase)
        await this.persist({ version: 1, keyProtection: protection, wallets: [], records: [] })
        this.keyProtection = protection
        this.replaceDataEncryptionKey(key)
      } finally {
        key.fill(0)
      }
    })
  }

  async load(): Promise<WalletDescriptor[]> {
    this.lock()
    this.wallets.clear()
    this.records.clear()
    this.keyProtection = undefined
    let document: PersistedWalletVault
    let migrated: boolean
    try {
      const parsed = migratePersistedVault(JSON.parse(await readFile(this.path, 'utf8')))
      document = parsed.document
      migrated = parsed.migrated
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('Wallet vault file is invalid')
    }
    if (document.keyProtection.mode !== this.keyWrapper.mode) throw new Error('Wallet vault protection mode mismatch')
    const walletIds = new Set<string>()
    for (const wallet of document.wallets) {
      if (walletIds.has(wallet.id)) throw new Error('Wallet vault file is invalid')
      walletIds.add(wallet.id)
      this.wallets.set(wallet.id, cloneDescriptor(wallet))
    }
    const recordIds = new Set<string>()
    for (const record of document.records) {
      const descriptor = this.wallets.get(record.walletId)
      if (!descriptor || descriptor.kind === 'watch-only' || recordIds.has(record.walletId)) {
        throw new Error('Wallet vault file is invalid')
      }
      recordIds.add(record.walletId)
      this.records.set(record.walletId, structuredClone(record))
    }
    if ([...this.wallets.values()].some((wallet) => wallet.kind !== 'watch-only' && !recordIds.has(wallet.id))) {
      throw new Error('Wallet vault file is invalid')
    }
    this.keyProtection = structuredClone(document.keyProtection)
    if (this.keyWrapper.mode === 'safe-storage') await this.unlock()
    if (migrated) await this.persist(this.document(this.keyProtection))
    return this.list()
  }

  list(): WalletDescriptor[] {
    return [...this.wallets.values()]
      .map(cloneDescriptor)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  isLocked(): boolean {
    return !this.dataEncryptionKey
  }

  async unlock(passphrase?: Uint8Array): Promise<void> {
    if (!this.keyProtection) throw new Error('Wallet vault is not initialized')
    const { key, replacement } = await this.keyWrapper.unwrap(this.keyProtection, passphrase)
    try {
      this.authenticateRecords(key)
      if (replacement) {
        const document = this.document(replacement)
        await this.persist(document)
        this.keyProtection = replacement
      }
      this.replaceDataEncryptionKey(key)
    } finally {
      key.fill(0)
    }
  }

  lock(): void {
    this.dataEncryptionKey?.fill(0)
    this.dataEncryptionKey = undefined
  }

  async add(descriptor: WalletDescriptor, secret?: WalletSecret): Promise<WalletDescriptor> {
    return this.queueMutation(async () => {
      if (!this.keyProtection) throw new Error('Wallet vault is not initialized')
      const validated = WalletDescriptorSchema.parse(descriptor)
      if (this.wallets.has(validated.id)) throw new Error('Wallet already exists')
      if (validated.kind === 'watch-only' && secret) throw new Error('Watch-only wallets must not contain signing material')
      if (validated.kind !== 'watch-only' && !secret) throw new Error('Managed wallets require signing material')
      const nextWallets = new Map(this.wallets)
      const nextRecords = new Map(this.records)
      nextWallets.set(validated.id, cloneDescriptor(validated))
      if (secret) {
        const key = this.requireDataEncryptionKey()
        const encoded = encodeSecret(secret)
        try {
          nextRecords.set(validated.id, {
            walletId: validated.id,
            encrypted: encryptWalletSecret(key, {
              schemaVersion: 1,
              walletId: validated.id,
              chainFamily: validated.chainFamily
            }, encoded)
          })
        } finally {
          encoded.fill(0)
        }
      }
      await this.persist(this.document(this.keyProtection, nextWallets, nextRecords))
      this.replaceMaps(nextWallets, nextRecords)
      return cloneDescriptor(validated)
    })
  }

  async updateDescriptor(walletId: string, update: (descriptor: WalletDescriptor) => WalletDescriptor): Promise<WalletDescriptor> {
    return this.queueMutation(async () => {
      if (!this.keyProtection) throw new Error('Wallet vault is not initialized')
      const current = this.wallets.get(walletId)
      if (!current) throw new Error('Wallet not found')
      const validated = WalletDescriptorSchema.parse(update(cloneDescriptor(current)))
      if (validated.id !== current.id || validated.chainFamily !== current.chainFamily || validated.kind !== current.kind) {
        throw new Error('Wallet identity fields cannot be changed')
      }
      if (validated.publicAddress !== current.publicAddress) throw new Error('Wallet public address cannot be changed')
      const nextWallets = new Map(this.wallets)
      const nextRecords = new Map(this.records)
      nextWallets.set(walletId, cloneDescriptor(validated))
      await this.persist(this.document(this.keyProtection, nextWallets, nextRecords))
      this.replaceMaps(nextWallets, nextRecords)
      return cloneDescriptor(validated)
    })
  }

  async remove(walletId: string): Promise<boolean> {
    return this.queueMutation(async () => {
      if (!this.keyProtection) throw new Error('Wallet vault is not initialized')
      if (!this.wallets.has(walletId)) return false
      const nextWallets = new Map(this.wallets)
      const nextRecords = new Map(this.records)
      nextWallets.delete(walletId)
      nextRecords.delete(walletId)
      await this.persist(this.document(this.keyProtection, nextWallets, nextRecords))
      this.replaceMaps(nextWallets, nextRecords)
      return true
    })
  }

  async secret(walletId: string): Promise<WalletSecret> {
    const descriptor = this.wallets.get(walletId)
    if (!descriptor) throw new Error('Wallet not found')
    if (descriptor.kind === 'watch-only') throw new Error('Watch-only wallets do not contain signing material')
    const record = this.records.get(walletId)
    if (!record) throw new Error('Wallet vault record is missing')
    const plaintext = decryptWalletSecret(this.requireDataEncryptionKey(), {
      schemaVersion: 1,
      walletId,
      chainFamily: descriptor.chainFamily
    }, record.encrypted)
    try {
      return decodeSecret(plaintext)
    } finally {
      plaintext.fill(0)
    }
  }

  async rotateDataEncryptionKey(passphrase?: Uint8Array): Promise<void> {
    await this.queueMutation(async () => {
      if (!this.keyProtection) throw new Error('Wallet vault is not initialized')
      const currentKey = this.requireDataEncryptionKey()
      const nextKey = generateWalletDataEncryptionKey()
      try {
        const nextRecords = new Map<string, PersistedWalletRecord>()
        for (const [walletId, record] of this.records) {
          const descriptor = this.wallets.get(walletId)!
          const metadata = { schemaVersion: 1, walletId, chainFamily: descriptor.chainFamily } as const
          nextRecords.set(walletId, {
            walletId,
            encrypted: rotateWalletSecret(currentKey, nextKey, metadata, record.encrypted)
          })
        }
        const protection = await this.keyWrapper.wrap(nextKey, passphrase)
        await this.persist(this.document(protection, this.wallets, nextRecords))
        this.keyProtection = protection
        this.records.clear()
        for (const [id, record] of nextRecords) this.records.set(id, record)
        this.replaceDataEncryptionKey(nextKey)
      } finally {
        nextKey.fill(0)
      }
    })
  }

  private requireDataEncryptionKey(): Buffer {
    if (!this.dataEncryptionKey) throw new Error('Wallet vault is locked')
    return this.dataEncryptionKey
  }

  private authenticateRecords(key: Uint8Array): void {
    for (const [walletId, record] of this.records) {
      const descriptor = this.wallets.get(walletId)
      if (!descriptor) throw new Error('Wallet vault file is invalid')
      const plaintext = decryptWalletSecret(key, {
        schemaVersion: 1,
        walletId,
        chainFamily: descriptor.chainFamily
      }, record.encrypted)
      try {
        const secret = decodeSecret(plaintext)
        secret.material.fill(0)
      } finally {
        plaintext.fill(0)
      }
    }
  }

  private replaceDataEncryptionKey(key: Uint8Array): void {
    this.dataEncryptionKey?.fill(0)
    this.dataEncryptionKey = Buffer.from(key)
  }

  private replaceMaps(
    wallets: ReadonlyMap<string, WalletDescriptor>,
    records: ReadonlyMap<string, PersistedWalletRecord>
  ): void {
    this.wallets.clear()
    this.records.clear()
    for (const [id, wallet] of wallets) this.wallets.set(id, cloneDescriptor(wallet))
    for (const [id, record] of records) this.records.set(id, structuredClone(record))
  }

  private document(
    keyProtection: PersistedWalletKeyProtection,
    wallets: ReadonlyMap<string, WalletDescriptor> = this.wallets,
    records: ReadonlyMap<string, PersistedWalletRecord> = this.records
  ): PersistedWalletVault {
    return {
      version: 1,
      keyProtection: structuredClone(keyProtection),
      wallets: [...wallets.values()].map(cloneDescriptor).sort((left, right) => left.id.localeCompare(right.id)),
      records: [...records.values()].map((record) => structuredClone(record)).sort((left, right) => left.walletId.localeCompare(right.walletId))
    }
  }

  private persist(document: PersistedWalletVault): Promise<void> {
    return writeTextFileAtomically(this.path, `${JSON.stringify(document, null, 2)}\n`)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
