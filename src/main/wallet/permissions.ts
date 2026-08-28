import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { WalletCapabilitySchema, WalletChainFamilySchema, WalletRequesterSchema, type WalletCapability, type WalletRequester } from '../../shared/wallet.js'
import { writeTextFileAtomically } from '../atomic-file.js'

const NormalizedOriginSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:') && value === url.origin
}, 'Wallet permission origin must be HTTP or HTTPS')

const WalletPermissionSchema = z.object({
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

interface PersistedPermissions {
  version: 1
  permissions: WalletPermission[]
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

function keyFor(permission: Pick<WalletPermission, 'walletId' | 'workspaceId' | 'origin' | 'account' | 'chainFamily' | 'networkId' | 'requester'>): string {
  const requester = permission.requester ?? { type: 'website', id: permission.origin }
  return [permission.walletId, permission.workspaceId, permission.origin, permission.account, permission.chainFamily, permission.networkId, requester.type, requester.id].join('\u0000')
}

export class WalletPermissionStore {
  private readonly permissions = new Map<string, WalletPermission>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<WalletPermission[]> {
    this.permissions.clear()
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      const parsed = z.object({ version: z.literal(1), permissions: z.array(WalletPermissionSchema) }).strict().parse(value)
      for (const permission of parsed.permissions) this.permissions.set(keyFor(permission), structuredClone(permission))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Wallet permission store is invalid')
    }
    return this.list()
  }

  list(): WalletPermission[] {
    return [...this.permissions.values()]
      .map((permission) => structuredClone(permission))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  get(permissionId: string): WalletPermission | undefined {
    const permission = [...this.permissions.values()].find((entry) => entry.id === permissionId)
    return permission ? structuredClone(permission) : undefined
  }

  async grant(input: WalletPermissionGrant): Promise<WalletPermission> {
    const origin = normalizeOrigin(input.origin)
    if (!origin) throw new TypeError('Wallet permission origin must be HTTP or HTTPS')
    const frameOrigin = input.frameOrigin ? normalizeOrigin(input.frameOrigin) : origin
    if (!frameOrigin || frameOrigin !== origin) throw new Error('Cross-origin iframe wallet grants are not allowed')
    return this.queueMutation(async () => {
      const now = new Date().toISOString()
      const candidate = WalletPermissionSchema.parse({
        id: randomUUID(),
        walletId: input.walletId,
        workspaceId: input.workspaceId,
        origin,
        account: input.account,
        chainFamily: input.chainFamily,
        networkId: input.networkId,
        capabilities: [...new Set(input.capabilities)],
        ...(input.requester ? { requester: structuredClone(input.requester) } : {}),
        createdAt: now,
        expiresAt: input.expiresAt
      })
      if (Date.parse(candidate.expiresAt) <= Date.parse(now)) throw new TypeError('Wallet permission expiry must be in the future')
      const next = new Map(this.permissions)
      const key = keyFor(candidate)
      const existing = next.get(key)
      const permission = existing ? { ...candidate, id: existing.id, createdAt: existing.createdAt } : candidate
      next.set(key, permission)
      await this.persist(next.values())
      this.replace(next)
      return structuredClone(permission)
    })
  }

  allows(input: WalletPermissionCheck, now = new Date()): boolean {
    const origin = normalizeOrigin(input.origin)
    if (!origin || origin !== input.origin) return false
    const permission = this.permissions.get(keyFor({ ...input, origin }))
    return Boolean(
      permission &&
      Date.parse(permission.expiresAt) > now.getTime() &&
      permission.capabilities.includes(input.capability)
    )
  }

  revokeForWallet(walletId: string): Promise<number> {
    return this.revokeMatching((permission) => permission.walletId === walletId)
  }

  revokeForWorkspace(workspaceId: string): Promise<number> {
    return this.revokeMatching((permission) => permission.workspaceId === workspaceId)
  }

  revokeForWalletWorkspace(walletId: string, workspaceId: string): Promise<number> {
    return this.revokeMatching((permission) => (
      permission.walletId === walletId && permission.workspaceId === workspaceId
    ))
  }

  revokeForOrigin(workspaceId: string, origin: string): Promise<number> {
    const normalized = normalizeOrigin(origin)
    if (!normalized) return Promise.resolve(0)
    return this.revokeMatching((permission) => permission.workspaceId === workspaceId && permission.origin === normalized)
  }

  revoke(permissionId: string): Promise<boolean> {
    return this.queueMutation(async () => {
      const entry = [...this.permissions].find(([, permission]) => permission.id === permissionId)
      if (!entry) return false
      const next = new Map(this.permissions)
      next.delete(entry[0])
      await this.persist(next.values())
      this.replace(next)
      return true
    })
  }

  private revokeMatching(predicate: (permission: WalletPermission) => boolean): Promise<number> {
    return this.queueMutation(async () => {
      const next = new Map(this.permissions)
      let removed = 0
      for (const [key, permission] of next) {
        if (predicate(permission)) {
          next.delete(key)
          removed += 1
        }
      }
      if (removed) {
        await this.persist(next.values())
        this.replace(next)
      }
      return removed
    })
  }

  private replace(next: ReadonlyMap<string, WalletPermission>): void {
    this.permissions.clear()
    for (const [key, permission] of next) this.permissions.set(key, structuredClone(permission))
  }

  private persist(permissions: Iterable<WalletPermission>): Promise<void> {
    const document: PersistedPermissions = {
      version: 1,
      permissions: [...permissions].map((permission) => structuredClone(permission)).sort((left, right) => left.id.localeCompare(right.id))
    }
    return writeTextFileAtomically(this.path, `${JSON.stringify(document, null, 2)}\n`)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
