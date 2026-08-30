import { randomUUID } from 'node:crypto'
import {
  WalletPermissionSchema,
  type WalletAuthorityPersistence,
  type WalletPermission,
  type WalletPermissionCheck,
  type WalletPermissionGrant
} from './authority-state.js'

export type { WalletPermission, WalletPermissionCheck, WalletPermissionGrant } from './authority-state.js'

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

  constructor(private readonly authority: WalletAuthorityPersistence) {}

  async load(): Promise<WalletPermission[]> {
    this.permissions.clear()
    for (const permission of this.authority.snapshot().permissions) {
      const key = keyFor(permission)
      if (this.permissions.has(key)) throw new Error('Wallet permission store is invalid')
      this.permissions.set(key, structuredClone(permission))
    }
    return this.list()
  }

  list(): WalletPermission[] {
    return [...this.permissions.values()]
      .map((permission) => structuredClone(permission))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  clear(): void {
    this.permissions.clear()
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
    const next = [...permissions].map((permission) => structuredClone(permission)).sort((left, right) => left.id.localeCompare(right.id))
    return this.authority.mutate((state) => { state.permissions = next })
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
