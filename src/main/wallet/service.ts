import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertWalletNetworkForChainFamily,
  WalletCreateInputSchema,
  WalletImportDetailsSchema,
  WalletPolicySchema,
  WalletUpdateInputSchema,
  WalletWatchOnlyInputSchema,
  walletAllowsWorkspace,
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
import { emptyWalletAuthorityState, encodeWalletAuthorityState, WalletAuthorityPersistence } from './authority-state.js'
import {
  PassphraseWalletKeyWrapper,
  SafeStorageWalletKeyWrapper,
  resolveWalletVaultProtection,
  type WalletSafeStorage,
  type WalletVaultProtection
} from './key-provider.js'
import { WalletPermissionStore } from './permissions.js'
import { isMainnetAgentAutomationPolicy, isWalletNetworkEligibleForAutomation } from './policy.js'
import { WalletPolicyStore } from './policy-store.js'
import { WalletPolicyUsageStore } from './policy-usage.js'
import { readWalletVaultProtectionMode, WalletVault, type WalletSecret } from './vault.js'
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

declare const signingAuthorizationBrand: unique symbol
export type WalletSigningAuthorization = object & { readonly [signingAuthorizationBrand]: true }

interface SigningAuthorizationRecord {
  walletId: string
  requestId: string
  approvalHash: string
  expiresAt: number
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
  readonly authority: WalletAuthorityPersistence
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
  private signingAuthorizations = new WeakMap<object, SigningAuthorizationRecord>()

  constructor(private readonly options: WalletServiceOptions) {
    this.vaultPath = join(options.directory, 'vault.json')
    this.approvals = new WalletApprovalStore(join(options.directory, 'requests.json'))
    this.audit = new WalletAuditStore(join(options.directory, 'audit.jsonl'))
    this.authority = new WalletAuthorityPersistence(() => {
      if (!this.vault) throw new Error('Wallet vault is unavailable')
      return this.vault
    }, options.directory)
    this.permissions = new WalletPermissionStore(this.authority)
    this.policies = new WalletPolicyStore(this.authority)
    this.policyUsage = new WalletPolicyUsageStore(this.authority)
    this.watchOnly = new WalletWatchOnlyStore(join(options.directory, 'watch-only.json'))
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    const storeResults = await Promise.allSettled([
      this.watchOnly.load(), this.approvals.load(this.now()), this.audit.verify()
    ])
    const failedStore = storeResults.find((result) => result.status === 'rejected')
    if (failedStore?.status === 'rejected') throw failedStore.reason

    const vaultExists = existsSync(this.vaultPath)
    const persistedProtection = vaultExists ? await readWalletVaultProtectionMode(this.vaultPath) : undefined
    const detectedProtection = await resolveWalletVaultProtection(
      this.options.platform,
      this.options.safeStorage,
      this.options.warn
    )
    if (persistedProtection === 'passphrase') {
      this.protection = { mode: 'passphrase-required', backend: 'unknown' }
      this.vault = new WalletVault(this.vaultPath, new PassphraseWalletKeyWrapper(PASSPHRASE_PARAMETERS))
      await this.vault.load()
      this.statusValue = { managedWallets: 'locked', backend: 'passphrase', watchOnlyAvailable: true }
    } else if (persistedProtection === 'safe-storage' && detectedProtection.mode !== 'safe-storage') {
      this.protection = detectedProtection
      this.statusValue = {
        managedWallets: 'disabled', backend: detectedProtection.backend, watchOnlyAvailable: true,
        reason: 'The operating-system secure storage required by this wallet vault is unavailable'
      }
    } else if (detectedProtection.mode === 'safe-storage') {
      this.protection = detectedProtection
      this.vault = new WalletVault(this.vaultPath, new SafeStorageWalletKeyWrapper(this.options.safeStorage))
      if (vaultExists) await this.vault.load()
      else await this.vault.initialize(undefined, encodeWalletAuthorityState(emptyWalletAuthorityState()))
      await this.loadAuthorityStores()
      this.statusValue = { managedWallets: 'ready', backend: detectedProtection.backend, watchOnlyAvailable: true }
    } else if (detectedProtection.mode === 'passphrase-required') {
      this.protection = detectedProtection
      this.vault = new WalletVault(this.vaultPath, new PassphraseWalletKeyWrapper(PASSPHRASE_PARAMETERS))
      this.statusValue = { managedWallets: 'passphrase-setup-required', backend: detectedProtection.backend, watchOnlyAvailable: true }
    } else {
      this.protection = detectedProtection
      this.statusValue = {
        managedWallets: 'disabled', backend: detectedProtection.backend, watchOnlyAvailable: true,
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
      await this.vault.initialize(bytes, encodeWalletAuthorityState(emptyWalletAuthorityState()))
      await this.loadAuthorityStores()
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
    const bytes = this.protection?.mode === 'passphrase-required'
      ? this.passphraseBytes(passphrase)
      : undefined
    try {
      await this.vault.unlock(bytes)
      try {
        await this.loadAuthorityStores()
      } catch (error) {
        this.clearAuthorityStores()
        this.vault.lock()
        throw error
      }
      this.statusValue = { managedWallets: 'ready', backend: this.statusValue.backend, watchOnlyAvailable: true }
      this.publish()
      return this.status()
    } finally {
      bytes?.fill(0)
    }
  }

  lock(): void {
    this.vault?.lock()
    this.signingAuthorizations = new WeakMap()
    this.clearAuthorityStores()
    if (this.vault && this.statusValue.managedWallets === 'ready' && existsSync(this.vaultPath)) {
      this.statusValue = { managedWallets: 'locked', backend: this.statusValue.backend, watchOnlyAvailable: true }
    }
    this.clearPendingImports()
    this.publish()
  }

  async generate(input: WalletCreateInput): Promise<WalletGeneratedResult> {
    const validated = WalletCreateInputSchema.parse(input)
    assertWalletNetworkForChainFamily(validated.chainFamily, validated.network)
    const vault = this.readyVault()
    const generated = await generateWalletRecovery(validated.chainFamily)
    const now = this.now().toISOString()
    const wallet: WalletDescriptor = {
      id: randomUUID(), name: validated.name, kind: validated.dedicatedAgent ? 'agent' : 'managed',
      chainFamily: validated.chainFamily, publicAddress: generated.publicAddress, network: validated.network,
      capabilities: ['read', 'sign', 'send'], workspaceIds: uniqueWorkspaceIds(validated.workspaceIds), policyIds: [],
      ...(validated.availableInAllWorkspaces ? { availableInAllWorkspaces: true } : {}),
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
    assertWalletNetworkForChainFamily(pending.chainFamily, input.network)
    const now = this.now().toISOString()
    const wallet: WalletDescriptor = {
      id: randomUUID(), name: input.name, kind: input.dedicatedAgent ? 'agent' : 'imported',
      chainFamily: pending.chainFamily, publicAddress: pending.publicAddress, network: input.network,
      capabilities: ['read', 'sign', 'send'], workspaceIds: uniqueWorkspaceIds(input.workspaceIds), policyIds: [],
      ...(input.availableInAllWorkspaces ? { availableInAllWorkspaces: true } : {}),
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
    assertWalletNetworkForChainFamily(validated.chainFamily, validated.network)
    if (!validateWatchOnlyWalletAddress(validated.chainFamily, validated.publicAddress)) throw new Error('Invalid watch-only wallet address')
    const now = this.now().toISOString()
    const wallet = await this.watchOnly.add({
      id: randomUUID(), name: validated.name, kind: 'watch-only', chainFamily: validated.chainFamily,
      publicAddress: validated.publicAddress, network: validated.network, capabilities: ['read'],
      workspaceIds: uniqueWorkspaceIds(validated.workspaceIds), policyIds: [], recoveryConfirmed: true,
      ...(validated.availableInAllWorkspaces ? { availableInAllWorkspaces: true } : {}),
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
    const rpcUrl = validatedChanges.rpcUrl === undefined ? current.network.rpcUrl : validatedChanges.rpcUrl
    const rpcChanged = rpcUrl !== current.network.rpcUrl
    const workspaceIds = validatedChanges.workspaceIds === undefined
      ? current.workspaceIds
      : uniqueWorkspaceIds(validatedChanges.workspaceIds)
    const availableInAllWorkspaces = validatedChanges.availableInAllWorkspaces
      ?? current.availableInAllWorkspaces
      ?? false
    const nextScope = { workspaceIds, availableInAllWorkspaces }
    const outOfScopeWorkspaceIds = new Set([
      ...current.workspaceIds,
      ...this.approvals.list()
        .filter((record) => record.request.walletId === walletId)
        .map((record) => record.request.workspaceId),
      ...this.permissions.list()
        .filter((permission) => permission.walletId === walletId)
        .map((permission) => permission.workspaceId),
      ...this.policies.list(walletId).map((policy) => policy.workspaceId)
    ].filter((workspaceId) => !walletAllowsWorkspace(nextScope, workspaceId)))
    const detachedPolicyIds = this.policies.list(walletId)
      .filter((policy) => outOfScopeWorkspaceIds.has(policy.workspaceId))
      .map((policy) => policy.id)
    let removedPolicyCount = detachedPolicyIds.length
    const detachedActive = this.approvals.list().find((request) => (
      request.request.walletId === walletId
      && outOfScopeWorkspaceIds.has(request.request.workspaceId)
      && ['signing', 'submitted'].includes(request.status)
    ))
    if (detachedActive) throw new Error('Wallet has a signing or submitted request in a detached workspace')
    if (rpcChanged) {
      const active = this.approvals.list().find((request) => (
        request.request.walletId === walletId && ['signing', 'submitted'].includes(request.status)
      ))
      if (active) throw new Error('Wallet has a signing or submitted request in progress')
      await this.approvals.cancelForWallet(walletId)
      const policyIds = this.policies.list(walletId).map((policy) => policy.id)
      removedPolicyCount = policyIds.length
      for (const policyId of policyIds) await this.removePolicy(policyId)
    } else {
      for (const workspaceId of outOfScopeWorkspaceIds) {
        await this.approvals.cancelForWalletWorkspace(walletId, workspaceId)
      }
      for (const policyId of detachedPolicyIds) await this.removePolicy(policyId)
    }
    for (const workspaceId of outOfScopeWorkspaceIds) {
      await this.permissions.revokeForWalletWorkspace(walletId, workspaceId)
    }
    const now = this.now().toISOString()
    const updater = (wallet: WalletDescriptor): WalletDescriptor => {
      const { availableInAllWorkspaces: _previousScope, ...rest } = wallet
      return {
        ...rest,
        name,
        workspaceIds,
        ...(availableInAllWorkspaces ? { availableInAllWorkspaces: true } : {}),
        network: { ...wallet.network, rpcUrl },
        updatedAt: now
      }
    }
    const updated = current.kind === 'watch-only'
      ? await this.watchOnly.update(walletId, updater)
      : await this.readyVault().updateDescriptor(walletId, updater)
    await this.audit.append('wallet-updated', { walletId, name, workspaceIds, availableInAllWorkspaces }, now)
    if (rpcChanged) {
      await this.audit.append('wallet-rpc-updated', {
        walletId,
        chainFamily: current.chainFamily,
        networkId: current.network.id,
        removedPolicyCount
      }, now)
    }
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
    if (candidate.mode === 'bounded-auto' && !wallet.capabilities.includes('sign')) {
      throw new Error('Wallet does not support signing automation')
    }
    if (!walletAllowsWorkspace(wallet, candidate.workspaceId)) throw new Error('Wallet policy workspace is not attached to the wallet')
    if (!candidate.networkIds.includes(wallet.network.id)) throw new Error('Wallet policy must include the wallet network')
    if (candidate.mode === 'bounded-auto') {
      if (wallet.network.environment === 'mainnet') {
        if (wallet.chainFamily !== 'evm' || wallet.kind !== 'agent') {
          throw new Error('Mainnet Bypass Approve mode requires a dedicated EVM agent wallet')
        }
        if (!isMainnetAgentAutomationPolicy(candidate, this.now())) {
          throw new Error('Mainnet Bypass Approve mode requires complete transaction, spend, fee, operation, and expiry limits')
        }
      } else {
        if (candidate.allowMainnetAgentAutomation) {
          throw new Error('Bypass Approve mode is only valid for a mainnet agent policy')
        }
        if (!isWalletNetworkEligibleForAutomation(wallet)) {
          throw new Error('Wallet network is not eligible for automatic approval')
        }
      }
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

  authorizeSigning(requestId: string): WalletSigningAuthorization {
    const record = this.approvals.get(requestId)
    if (!record) throw new Error('Wallet request not found')
    this.approvals.assertApprovedRequest(record.id, record.request)
    const wallet = this.requireWallet(record.request.walletId)
    if (
      wallet.kind === 'watch-only'
      || wallet.chainFamily !== record.request.chainFamily
      || wallet.network.id !== record.request.networkId
      || !walletAllowsWorkspace(wallet, record.request.workspaceId)
    ) throw new Error('Wallet signing authority no longer matches the wallet')
    if (!record.approvalHash) throw new Error('Wallet request is not approved')
    if (!this.permissions.allows({
      walletId: wallet.id,
      workspaceId: record.request.workspaceId,
      origin: record.request.topLevelOrigin,
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      requester: record.request.requester,
      capability: 'read'
    }, this.now())) throw new Error('Wallet account access was revoked before signing')
    const token = Object.freeze({}) as WalletSigningAuthorization
    this.signingAuthorizations.set(token, {
      walletId: wallet.id,
      requestId: record.id,
      approvalHash: record.approvalHash,
      expiresAt: Date.parse(record.request.expiresAt)
    })
    return token
  }

  async withSecret<T>(
    walletId: string,
    authorization: WalletSigningAuthorization,
    operation: (wallet: WalletDescriptor, secret: WalletSecret) => Promise<T>
  ): Promise<T> {
    const authority = this.signingAuthorizations.get(authorization)
    if (authority) this.signingAuthorizations.delete(authorization)
    if (!authority || authority.walletId !== walletId || authority.expiresAt <= this.now().getTime()) {
      throw new Error('Wallet signing authorization is invalid or expired')
    }
    const approval = this.approvals.get(authority.requestId)
    if (
      !approval
      || (approval.status !== 'approved' && approval.status !== 'signing')
      || approval.approvalHash !== authority.approvalHash
      || approval.request.walletId !== walletId
    ) throw new Error('Wallet signing authorization is no longer valid')
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

  private async loadAuthorityStores(): Promise<void> {
    const vault = this.vault
    if (!vault || vault.isLocked()) throw new Error('Wallet vault is unavailable or locked')
    const managedIds = new Set(vault.list().map((wallet) => wallet.id))
    if (this.watchOnly.list().some((wallet) => managedIds.has(wallet.id))) {
      throw new Error('Wallet identity authentication failed')
    }
    await this.authority.load(vault.list())
    await Promise.all([this.permissions.load(), this.policies.load(), this.policyUsage.load()])
  }

  private clearAuthorityStores(): void {
    this.permissions.clear()
    this.policies.clear()
    this.policyUsage.clear()
    this.authority.clear()
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
