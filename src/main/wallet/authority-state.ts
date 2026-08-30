import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  WalletCapabilitySchema,
  WalletChainFamilySchema,
  WalletPolicySchema,
  WalletRequesterSchema,
  type WalletCapability,
  type WalletDescriptor,
  type WalletPolicy,
  type WalletRequester
} from '../../shared/wallet.js'
import type { WalletVault } from './vault.js'

const LEGACY_AUTHORITY_MARKER = z.object({ legacyMigrationRequired: z.literal(true) }).strict()

const NormalizedOriginSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:') && value === url.origin
}, 'Wallet permission origin must be HTTP or HTTPS')

export const WalletPermissionSchema = z.object({
  id: z.string().min(1).max(128),
  walletId: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(128),
  origin: NormalizedOriginSchema,
  account: z.string().min(1).max(256),
  chainFamily: WalletChainFamilySchema,
  networkId: z.string().min(1).max(128),
  capabilities: z.array(WalletCapabilitySchema).min(1).max(3),
  requester: WalletRequesterSchema.optional(),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true })
}).strict()

export type WalletPermission = z.infer<typeof WalletPermissionSchema>

export interface WalletPermissionGrant {
  walletId: string
  workspaceId: string
  origin: string
  frameOrigin?: string
  account: string
  chainFamily: WalletPermission['chainFamily']
  networkId: string
  capabilities: readonly WalletCapability[]
  requester?: WalletRequester
  expiresAt: string
}

export interface WalletPermissionCheck extends Omit<WalletPermissionGrant, 'capabilities' | 'expiresAt' | 'frameOrigin'> {
  capability: WalletCapability
}

export const WalletPolicyUsageEntrySchema = z.object({
  policyId: z.string().trim().min(1).max(128),
  operationCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dailyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailySpend: z.string().regex(/^\d+(?:\.\d+)?$/)
}).strict()

export type WalletPolicyUsageEntry = z.infer<typeof WalletPolicyUsageEntrySchema>

const WalletAuthorityStateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  migratedLegacyAuthority: z.boolean(),
  permissions: z.array(WalletPermissionSchema).max(10_000),
  policies: z.array(WalletPolicySchema).max(10_000),
  policyUsage: z.array(WalletPolicyUsageEntrySchema).max(10_000)
}).strict()

export type WalletAuthorityState = z.infer<typeof WalletAuthorityStateSchema>

export function emptyWalletAuthorityState(): WalletAuthorityState {
  return {
    version: 1,
    revision: 0,
    migratedLegacyAuthority: false,
    permissions: [],
    policies: [],
    policyUsage: []
  }
}

export function encodeWalletAuthorityState(state: WalletAuthorityState): Buffer {
  return Buffer.from(JSON.stringify(WalletAuthorityStateSchema.parse(state)), 'utf8')
}

export class WalletAuthorityPersistence {
  private state: WalletAuthorityState | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly vaultProvider: () => WalletVault,
    private readonly legacyDirectory: string
  ) {}

  async load(wallets: readonly WalletDescriptor[]): Promise<WalletAuthorityState> {
    const vault = this.vaultProvider()
    const bytes = vault.readAuthorityState()
    let value: unknown
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown
    } catch {
      throw new Error('Wallet authority authentication failed')
    } finally {
      bytes.fill(0)
    }
    if (LEGACY_AUTHORITY_MARKER.safeParse(value).success || vault.authorityNeedsLegacyMigration()) {
      const migrated = await this.migrateLegacy(wallets)
      await vault.replaceEncryptedAuthorityState(encodeWalletAuthorityState(migrated))
      this.state = migrated
      return this.snapshot()
    }
    try {
      this.state = WalletAuthorityStateSchema.parse(value)
      return this.snapshot()
    } catch {
      throw new Error('Wallet authority authentication failed')
    }
  }

  snapshot(): WalletAuthorityState {
    if (!this.state) throw new Error('Wallet authority state is unavailable')
    return structuredClone(this.state)
  }

  mutate<T>(mutation: (draft: WalletAuthorityState) => T): Promise<T> {
    return this.queueMutation(async () => {
      const draft = this.snapshot()
      const result = mutation(draft)
      draft.revision += 1
      const next = WalletAuthorityStateSchema.parse(draft)
      await this.vaultProvider().replaceEncryptedAuthorityState(encodeWalletAuthorityState(next))
      this.state = next
      return result
    })
  }

  clear(): void {
    this.state = undefined
  }

  private async migrateLegacy(wallets: readonly WalletDescriptor[]): Promise<WalletAuthorityState> {
    const walletsById = new Map(wallets.map((wallet) => [wallet.id, wallet]))
    let policies: WalletPolicy[] = []
    try {
      const parsed = z.object({ version: z.literal(1), policies: z.array(WalletPolicySchema).max(10_000) }).strict()
        .parse(JSON.parse(await readFile(join(this.legacyDirectory, 'policies.json'), 'utf8')))
      policies = parsed.policies.flatMap((policy) => {
        const wallet = walletsById.get(policy.walletId)
        if (
          !wallet
          || wallet.kind === 'watch-only'
          || !wallet.policyIds.includes(policy.id)
          || !wallet.workspaceIds.includes(policy.workspaceId)
          || !policy.networkIds.includes(wallet.network.id)
        ) return []
        return [{ ...policy, mode: policy.mode === 'bounded-auto' ? 'always-ask' as const : policy.mode }]
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Wallet legacy policy store is invalid')
    }
    return {
      ...emptyWalletAuthorityState(),
      revision: 1,
      migratedLegacyAuthority: true,
      // Plaintext permissions and usage counters cannot be authenticated after
      // upgrade. Revoke/reset them and make every legacy automatic policy ask
      // the human before it can become active again.
      permissions: [],
      policies: policies.sort((left, right) => left.id.localeCompare(right.id)),
      policyUsage: []
    }
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
