import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  WalletCreateInputSchema,
  WalletImportDetailsSchema,
  WalletPolicySchema,
  WalletUpdateInputSchema,
  WalletWatchOnlyInputSchema,
  type WalletCreateInput,
  type WalletDescriptor,
  type WalletImportDetails,
  type WalletPolicy,
  type WalletSecretFormat,
  type WalletServiceStatus,
  type WalletUpdateInput,
  type WalletWatchOnlyInput
} from '../../shared/wallet.js'
import { generateWalletRecovery, deriveWalletAccount, validateWatchOnlyWalletAddress } from './accounts.js'
import { WalletApprovalStore } from './approvals.js'
import { WalletAuditStore, type WalletAuditEntry } from './audit.js'
import {
  PassphraseWalletKeyWrapper,
  SafeStorageWalletKeyWrapper,
  resolveWalletVaultProtection,
  type WalletSafeStorage,
  type WalletVaultProtection
} from './key-provider.js'
import { WalletPermissionStore } from './permissions.js'
import { isWalletNetworkEligibleForAutomation } from './policy.js'
import { WalletPolicyStore } from './policy-store.js'
import { WalletPolicyUsageStore } from './policy-usage.js'
import { WalletVault, type WalletSecret } from './vault.js'
import { WalletWatchOnlyStore } from './watch-only-store.js'

const PASSPHRASE_PARAMETERS = { memoryKiB: 64 * 1024, passes: 3, parallelism: 1 } as const
const IMPORT_CONFIRMATION_TTL_MS = 5 * 60_000

interface PendingImport {
  token: string
  format: WalletSecretFormat
  chainFamily: WalletDescriptor['chainFamily']
  publicAddress: string
  material: Buffer
  expiresAt: number
}

export interface WalletPreparedImport {
  token: string
  chainFamily: WalletDescriptor['chainFamily']
  publicAddress: string
  expiresAt: string
}

export interface WalletGeneratedResult {
  wallet: WalletDescriptor
  recoveryMaterial: string
}

export interface WalletServiceOptions {
  directory: string
  platform: NodeJS.Platform
  safeStorage: WalletSafeStorage
  now?: () => Date
  onChanged?: (wallets: WalletDescriptor[]) => void
  onStatusChanged?: (status: WalletServiceStatus) => void
  warn?: (message: string) => void
}

function cloneWallet(wallet: WalletDescriptor): WalletDescriptor {
  return structuredClone(wallet)
}

function uniqueWorkspaceIds(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export class WalletService {
  readonly approvals: WalletApprovalStore
  readonly audit: WalletAuditStore
  readonly permissions: WalletPermissionStore
  readonly policies: WalletPolicyStore
  readonly policyUsage: WalletPolicyUsageStore
  readonly watchOnly: WalletWatchOnlyStore
  private readonly vaultPath: string
  private vault: WalletVault | undefined
  private protection: WalletVaultProtection | undefined
  private statusValue: WalletServiceStatus = {
    managedWallets: 'disabled', backend: 'uninitialized', watchOnlyAvailable: true, reason: 'Wallet service is not initialized'
  }
  private readonly imports = new Map<string, PendingImport>()
  private readonly importExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly options: WalletServiceOptions) {
    this.vaultPath = join(options.directory, 'vault.json')
    this.approvals = new WalletApprovalStore(join(options.directory, 'requests.json'))
    this.audit = new WalletAuditStore(join(options.directory, 'audit.jsonl'))
    this.permissions = new WalletPermissionStore(join(options.directory, 'permissions.json'))
    this.policies = new WalletPolicyStore(join(options.directory, 'policies.json'))
    this.policyUsage = new WalletPolicyUsageStore(join(options.directory, 'policy-usage.json'))
    this.watchOnly = new WalletWatchOnlyStore(join(options.directory, 'watch-only.json'))
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    await Promise.all([
      this.watchOnly.load(), this.permissions.load(), this.policies.load(), this.policyUsage.load(),
      this.approvals.load(this.now()), this.audit.verify()
    ])
    this.protection = await resolveWalletVaultProtection(
      this.options.platform,
      this.options.safeStorage,
      this.options.warn
    )
    if (this.protection.mode === 'safe-storage') {
      this.vault = new WalletVault(this.vaultPath, new SafeStorageWalletKeyWrapper(this.options.safeStorage))
      if (existsSync(this.vaultPath)) await this.vault.load()
      else await this.vault.initialize()
      this.statusValue = { managedWallets: 'ready', backend: this.protection.backend, watchOnlyAvailable: true }
    } else if (this.protection.mode === 'passphrase-required') {
      this.vault = new WalletVault(this.vaultPath, new PassphraseWalletKeyWrapper(PASSPHRASE_PARAMETERS))
      if (existsSync(this.vaultPath)) {
        await this.vault.load()
        this.statusValue = { managedWallets: 'locked', backend: this.protection.backend, watchOnlyAvailable: true }
      } else {
        this.statusValue = { managedWallets: 'passphrase-setup-required', backend: this.protection.backend, watchOnlyAvailable: true }
      }
    } else {
      this.statusValue = {
        managedWallets: 'disabled', backend: this.protection.backend, watchOnlyAvailable: true,
        reason: 'No secure wallet key-storage backend is available'
      }
    }
    this.publish()
  }

  status(): WalletServiceStatus {
    return structuredClone(this.statusValue)
  }

  list(): WalletDescriptor[] {
    return [...(this.vault?.list() ?? []), ...this.watchOnly.list()]
      .map(cloneWallet)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async setupPassphrase(passphrase: string): Promise<WalletServiceStatus> {
    if (this.statusValue.managedWallets !== 'passphrase-setup-required' || !this.vault) throw new Error('Wallet passphrase setup is unavailable')
    const bytes = this.passphraseBytes(passphrase)
    try {
      await this.vault.initialize(bytes)
      this.statusValue = { managedWallets: 'ready', backend: this.statusValue.backend, watchOnlyAvailable: true }
      await this.audit.append('vault-configured', { protection: 'argon2id-passphrase' }, this.now().toISOString())
      this.publish()
      return this.status()
    } finally {
      bytes.fill(0)
    }
  }

  async unlock(passphrase: string): Promise<WalletServiceStatus> {
    if (this.statusValue.managedWallets !== 'locked' || !this.vault) throw new Error('Wallet vault is not locked')
    const bytes = this.passphraseBytes(passphrase)
    try {
      await this.vault.unlock(bytes)
      this.statusValue = { managedWallets: 'ready', backend: this.statusValue.backend, watchOnlyAvailable: true }
      this.publish()
      return this.status()
    } finally {
      bytes.fill(0)
    }
  }

  lock(): void {
    this.vault?.lock()
    if (this.protection?.mode === 'passphrase-required' && existsSync(this.vaultPath)) {
      this.statusValue = { managedWallets: 'locked', backend: this.statusValue.backend, watchOnlyAvailable: true }
    }
    this.clearPendingImports()
    this.publish()
  }

  async generate(input: WalletCreateInput): Promise<WalletGeneratedResult> {
    const validated = WalletCreateInputSchema.parse(input)
    const vault = this.readyVault()
    const generated = await generateWalletRecovery(validated.chainFamily)
    const now = this.now().toISOString()
    const wallet: WalletDescriptor = {
      id: randomUUID(), name: validated.name, kind: validated.dedicatedAgent ? 'agent' : 'managed',
      chainFamily: validated.chainFamily, publicAddress: generated.publicAddress, network: validated.network,
      capabilities: ['read', 'sign', 'send'], workspaceIds: uniqueWorkspaceIds(validated.workspaceIds), policyIds: [],
      recoveryConfirmed: false, createdAt: now, updatedAt: now
    }
    try {
      await vault.add(wallet, generated.secret)
      await this.audit.append('wallet-created', {
        walletId: wallet.id, kind: wallet.kind, chainFamily: wallet.chainFamily, publicAddress: wallet.publicAddress
      }, now)
      this.publish()
      return { wallet: cloneWallet(wallet), recoveryMaterial: generated.secret.material.toString('utf8') }
    } finally {
      generated.secret.material.fill(0)
    }
  }

  async confirmRecovery(walletId: string): Promise<WalletDescriptor> {
    const vault = this.readyVault()
    const now = this.now().toISOString()
    const wallet = await vault.updateDescriptor(walletId, (descriptor) => ({ ...descriptor, recoveryConfirmed: true, updatedAt: now }))
    await this.audit.append('wallet-recovery-confirmed', { walletId }, now)
    this.publish()
    return wallet
  }

  async prepareImport(chainFamily: WalletDescriptor['chainFamily'], format: WalletSecretFormat, recoveryMaterial: string): Promise<WalletPreparedImport> {
    this.readyVault()
    if (!recoveryMaterial || recoveryMaterial.length > 65_536) throw new Error('Invalid wallet recovery material')
    const material = Buffer.from(recoveryMaterial, 'utf8')
    try {
      const derived = await deriveWalletAccount(chainFamily, { format, material })
      derived.privateKey.fill(0)
      const token = randomUUID()
      const expiresAt = this.now().getTime() + IMPORT_CONFIRMATION_TTL_MS
      this.imports.set(token, { token, format, chainFamily, publicAddress: derived.publicAddress, material: Buffer.from(material), expiresAt })
      const expiryTimer = setTimeout(() => this.removePendingImport(token), IMPORT_CONFIRMATION_TTL_MS)
      expiryTimer.unref()
      this.importExpiryTimers.set(token, expiryTimer)
      return { token, chainFamily, publicAddress: derived.publicAddress, expiresAt: new Date(expiresAt).toISOString() }
    } catch {
      throw new Error('Wallet recovery material is invalid for the selected chain and format')
    } finally {
      material.fill(0)
      this.expireImports()
    }
  }

  async confirmImport(token: string, details: WalletImportDetails): Promise<WalletDescriptor> {
    const vault = this.readyVault()
    this.expireImports()
    const pending = this.imports.get(token)
    if (!pending) throw new Error('Wallet import confirmation expired')
    const input = WalletImportDetailsSchema.parse(details)
    const now = this.now().toISOString()
    const wallet: WalletDescriptor = {
      id: randomUUID(), name: input.name, kind: input.dedicatedAgent ? 'agent' : 'imported',
      chainFamily: pending.chainFamily, publicAddress: pending.publicAddress, network: input.network,
      capabilities: ['read', 'sign', 'send'], workspaceIds: uniqueWorkspaceIds(input.workspaceIds), policyIds: [],
      recoveryConfirmed: true, createdAt: now, updatedAt: now
    }
    const claimed = this.takePendingImport(token)
    if (!claimed) throw new Error('Wallet import confirmation expired')
    try {
      await vault.add(wallet, { format: claimed.format, material: claimed.material })
      await this.audit.append('wallet-imported', {
        walletId: wallet.id, kind: wallet.kind, chainFamily: wallet.chainFamily, publicAddress: wallet.publicAddress
      }, now)
      this.publish()
      return cloneWallet(wallet)
    } finally {
      claimed.material.fill(0)
    }
  }

  cancelImport(token: string): boolean {
    return this.removePendingImport(token)
  }

  async addWatchOnly(input: WalletWatchOnlyInput): Promise<WalletDescriptor> {
    const validated = WalletWatchOnlyInputSchema.parse(input)
    if (!validateWatchOnlyWalletAddress(validated.chainFamily, validated.publicAddress)) throw new Error('Invalid watch-only wallet address')
    const now = this.now().toISOString()
    const wallet = await this.watchOnly.add({
      id: randomUUID(), name: validated.name, kind: 'watch-only', chainFamily: validated.chainFamily,
      publicAddress: validated.publicAddress, network: validated.network, capabilities: ['read'],
      workspaceIds: uniqueWorkspaceIds(validated.workspaceIds), policyIds: [], recoveryConfirmed: true,
      createdAt: now, updatedAt: now
    })
    await this.audit.append('wallet-created', {
      walletId: wallet.id, kind: wallet.kind, chainFamily: wallet.chainFamily, publicAddress: wallet.publicAddress
    }, now)
    this.publish()
    return wallet
  }

  async update(walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor> {
    const validatedChanges = WalletUpdateInputSchema.parse(changes)
    const current = this.requireWallet(walletId)
    const name = validatedChanges.name === undefined ? current.name : validatedChanges.name
    const workspaceIds = validatedChanges.workspaceIds === undefined
      ? current.workspaceIds
      : uniqueWorkspaceIds(validatedChanges.workspaceIds)
    const detachedWorkspaceIds = new Set(current.workspaceIds.filter((workspaceId) => !workspaceIds.includes(workspaceId)))
    const detachedPolicyIds = this.policies.list(walletId)
      .filter((policy) => detachedWorkspaceIds.has(policy.workspaceId))
      .map((policy) => policy.id)
    for (const policyId of detachedPolicyIds) await this.removePolicy(policyId)
    const now = this.now().toISOString()
    const updater = (wallet: WalletDescriptor): WalletDescriptor => ({ ...wallet, name, workspaceIds, updatedAt: now })
    const updated = current.kind === 'watch-only'
      ? await this.watchOnly.update(walletId, updater)
      : await this.readyVault().updateDescriptor(walletId, updater)
    await this.audit.append('wallet-updated', { walletId, name, workspaceIds }, now)
    this.publish()
    return updated
  }

  async remove(walletId: string): Promise<boolean> {
    const wallet = this.requireWallet(walletId)
    const active = this.approvals.list().find((request) => request.request.walletId === walletId && ['signing', 'submitted'].includes(request.status))
    if (active) throw new Error('Wallet has a signing or submitted request in progress')
    await this.approvals.cancelForWallet(walletId)
    await this.permissions.revokeForWallet(walletId)
    const policyIds = this.policies.list(walletId).map((policy) => policy.id)
    await this.policies.removeForWallet(walletId)
    await Promise.all(policyIds.map((policyId) => this.policyUsage.remove(policyId)))
    const removed = wallet.kind === 'watch-only'
      ? await this.watchOnly.remove(walletId)
      : await this.readyVault().remove(walletId)
    if (removed) {
      await this.audit.append('wallet-removed', { walletId, chainFamily: wallet.chainFamily, publicAddress: wallet.publicAddress }, this.now().toISOString())
      this.publish()
    }
    return removed
  }

  async setPolicy(input: WalletPolicy): Promise<WalletPolicy> {
    const candidate = WalletPolicySchema.parse(input)
    if (Date.parse(candidate.expiresAt) <= this.now().getTime()) {
      throw new Error('Wallet policy expiry must be in the future')
    }
    const wallet = this.requireWallet(candidate.walletId)
    if (!wallet.workspaceIds.includes(candidate.workspaceId)) throw new Error('Wallet policy workspace is not attached to the wallet')
    if (!candidate.networkIds.includes(wallet.network.id)) throw new Error('Wallet policy must include the wallet network')
    if (candidate.mode === 'bounded-auto' && !isWalletNetworkEligibleForAutomation(wallet)) {
      throw new Error('Wallet network is not eligible for automatic approval')
    }
    const policy = await this.policies.set(candidate)
    if (!wallet.policyIds.includes(policy.id)) {
      const current = this.requireWallet(wallet.id)
      const now = this.now().toISOString()
      const updater = (descriptor: WalletDescriptor): WalletDescriptor => ({
        ...descriptor,
        policyIds: [...new Set([...descriptor.policyIds, policy.id])],
        updatedAt: now
      })
      if (current.kind === 'watch-only') await this.watchOnly.update(wallet.id, updater)
      else await this.readyVault().updateDescriptor(wallet.id, updater)
    }
    await this.audit.append('policy-updated', {
      policyId: policy.id, walletId: policy.walletId, workspaceId: policy.workspaceId, mode: policy.mode
    }, this.now().toISOString())
    this.publish()
    return policy
  }

  async removePolicy(policyId: string): Promise<boolean> {
    const policy = this.policies.list().find((entry) => entry.id === policyId)
    if (!policy) return false
    const removed = await this.policies.remove(policyId)
    await this.policyUsage.remove(policyId)
    const wallet = this.list().find((entry) => entry.id === policy.walletId)
    if (wallet?.policyIds.includes(policyId)) {
      const now = this.now().toISOString()
      const updater = (descriptor: WalletDescriptor): WalletDescriptor => ({
        ...descriptor,
        policyIds: descriptor.policyIds.filter((id) => id !== policyId),
        updatedAt: now
      })
      if (wallet.kind === 'watch-only') await this.watchOnly.update(wallet.id, updater)
      else await this.readyVault().updateDescriptor(wallet.id, updater)
    }
    if (removed) await this.audit.append('policy-removed', { policyId, walletId: policy.walletId }, this.now().toISOString())
    this.publish()
    return removed
  }

  async auditHistory(): Promise<WalletAuditEntry[]> {
    return this.audit.verify()
  }

  async withSecret<T>(walletId: string, operation: (wallet: WalletDescriptor, secret: WalletSecret) => Promise<T>): Promise<T> {
    const wallet = this.requireWallet(walletId)
    if (wallet.kind === 'watch-only') throw new Error('Watch-only wallets cannot sign')
    if (!wallet.recoveryConfirmed) throw new Error('Wallet recovery material must be confirmed before signing')
    const secret = await this.readyVault().secret(walletId)
    try {
      return await operation(wallet, secret)
    } finally {
      secret.material.fill(0)
    }
  }

  cancelForNavigation(tabId: string, generation: number): void {
    void this.approvals.cancelForNavigation(tabId, generation)
  }

  cancelForTab(tabId: string): void {
    void this.approvals.cancelForTab(tabId)
  }

  cancelForWorkspace(workspaceId: string): void {
    void Promise.all([this.approvals.cancelForWorkspace(workspaceId), this.permissions.revokeForWorkspace(workspaceId)])
  }

  dispose(): void {
    this.lock()
    this.clearPendingImports()
  }

  private readyVault(): WalletVault {
    if (!this.vault || this.statusValue.managedWallets !== 'ready') throw new Error('Managed wallet vault is unavailable or locked')
    return this.vault
  }

  private requireWallet(walletId: string): WalletDescriptor {
    const wallet = this.list().find((entry) => entry.id === walletId)
    if (!wallet) throw new Error('Wallet not found')
    return wallet
  }

  private passphraseBytes(passphrase: string): Buffer {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('Wallet vault passphrase must be between 12 and 1024 characters')
    return Buffer.from(passphrase, 'utf8')
  }

  private expireImports(): void {
    const now = this.now().getTime()
    for (const [token, pending] of this.imports) {
      if (pending.expiresAt > now) continue
      this.removePendingImport(token)
    }
  }

  private clearPendingImports(): void {
    for (const token of [...this.imports.keys()]) this.removePendingImport(token)
    for (const timer of this.importExpiryTimers.values()) clearTimeout(timer)
    this.importExpiryTimers.clear()
  }

  private removePendingImport(token: string): boolean {
    const pending = this.takePendingImport(token)
    pending?.material.fill(0)
    return Boolean(pending)
  }

  private takePendingImport(token: string): PendingImport | undefined {
    const timer = this.importExpiryTimers.get(token)
    if (timer) clearTimeout(timer)
    this.importExpiryTimers.delete(token)
    const pending = this.imports.get(token)
    this.imports.delete(token)
    return pending
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private publish(): void {
    this.options.onChanged?.(this.list())
    this.options.onStatusChanged?.(this.status())
  }
}
