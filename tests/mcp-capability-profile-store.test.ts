import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  McpCapabilityAuthorizationError,
  McpCapabilityProfileStore,
  type McpCapabilityProfileInput,
  type McpCapabilityRequest
} from '../src/main/mcp/capability-profile-store.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const otherWorkspaceId = '01912345-678a-7abc-8def-0123456789ab'
const readRequest: McpCapabilityRequest = {
  toolName: 'browser_snapshot',
  operationClass: 'read',
  workspaceId,
  origins: ['https://allowed.example']
}

describe('MCP capability profile store', () => {
  let directory: string | undefined

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = undefined
  })

  async function store(now = () => new Date('2026-09-11T12:00:00.000Z')) {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-mcp-capability-'))
    const value = new McpCapabilityProfileStore(join(directory, 'mcp-capability-profiles.json'), now)
    await value.load()
    return value
  }

  it('shows a generated credential once and persists only its digest', async () => {
    const value = await store()
    const created = await value.create({
      name: 'Read-only QA',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read']
    })

    expect(created.credential).toMatch(/^hrc1_[A-Za-z0-9_-]{43}$/)
    expect(value.authenticate(created.credential)).toEqual({
      profileId: created.profile.id,
      revision: 1,
      credentialId: created.profile.credentialId
    })

    const persisted = await readFile(join(directory!, 'mcp-capability-profiles.json'), 'utf8')
    expect(persisted).not.toContain(created.credential)
    expect(persisted).not.toContain('Read-only QA credential')
    expect(persisted).toMatch(/"credentialDigest": "[0-9a-f]{64}"/)

    const reloaded = new McpCapabilityProfileStore(join(directory!, 'mcp-capability-profiles.json'), () => new Date('2026-09-11T12:00:00.000Z'))
    await reloaded.load()
    expect(reloaded.authenticate(created.credential)?.profileId).toBe(created.profile.id)
  })

  it('accepts the registered browser and wallet tool namespaces only', async () => {
    const value = await store()
    await expect(value.create({
      name: 'Wallet reader',
      allowedTools: ['browser_snapshot', 'wallet_balance'],
      operationClasses: ['read']
    })).resolves.toHaveProperty('credential')
    await expect(value.create({
      name: 'Unknown extension',
      allowedTools: ['shell_execute'],
      operationClasses: ['read']
    })).rejects.toThrow('Capability profile tools are invalid')
  })

  it('enforces tools, actions, operation classes, workspaces, and origins without exposing private input', async () => {
    const value = await store()
    const { credential } = await value.create({
      name: 'Scoped inspector',
      allowedTools: ['browser_snapshot', 'browser_storage'],
      allowedActions: { browser_storage: ['get'] },
      operationClasses: ['read'],
      workspaceIds: [workspaceId],
      origins: ['https://allowed.example/path-is-normalized']
    })
    const grant = value.authenticate(credential)!

    expect(() => value.authorize(grant, readRequest)).not.toThrow()
    const denied: McpCapabilityRequest[] = [
      { ...readRequest, toolName: 'browser_click', operationClass: 'interact' },
      { ...readRequest, toolName: 'browser_storage', action: 'set' },
      { ...readRequest, toolName: 'browser_storage', action: 'get', operationClass: 'site-data' },
      { ...readRequest, workspaceId: otherWorkspaceId },
      { ...readRequest, origins: ['https://private.example/account?token=secret'] }
    ]
    for (const request of denied) {
      expect(() => value.authorize(grant, request)).toThrow(McpCapabilityAuthorizationError)
      try {
        value.authorize(grant, request)
      } catch (error) {
        expect(String(error)).not.toContain('private.example')
        expect(String(error)).not.toContain('secret')
      }
    }
  })

  it('invalidates credentials after expiry, profile edits, rotation, and revocation', async () => {
    let current = new Date('2026-09-11T12:00:00.000Z')
    const value = await store(() => current)
    const expiring = await value.create({
      name: 'Short task',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read'],
      expiresAt: '2026-09-11T12:01:00.000Z'
    })
    const expiringGrant = value.authenticate(expiring.credential)!
    current = new Date('2026-09-11T12:01:00.000Z')
    expect(value.authenticate(expiring.credential)).toBeNull()
    expect(() => value.authorize(expiringGrant, readRequest)).toThrow(McpCapabilityAuthorizationError)

    current = new Date('2026-09-11T12:02:00.000Z')
    const editable = await value.create({
      name: 'Editable task',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read']
    })
    const oldGrant = value.authenticate(editable.credential)!
    const edited = await value.update(editable.profile.id, {
      name: 'Edited task',
      allowedTools: ['browser_snapshot', 'browser_find'],
      operationClasses: ['read']
    })
    expect(value.authenticate(editable.credential)).toBeNull()
    expect(() => value.authorize(oldGrant, readRequest)).toThrow(McpCapabilityAuthorizationError)
    expect(value.authenticate(edited.credential)?.revision).toBe(2)

    const rotated = await value.rotate(editable.profile.id)
    expect(value.authenticate(edited.credential)).toBeNull()
    expect(value.authenticate(rotated.credential)?.revision).toBe(3)
    await value.revoke(editable.profile.id)
    expect(value.authenticate(rotated.credential)).toBeNull()
  })

  it('atomically exhausts a single-use credential at dispatch', async () => {
    const value = await store()
    const created = await value.create({
      name: 'One read',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read'],
      maxUses: 1
    })
    const grant = value.authenticate(created.credential)!

    const attempts = await Promise.allSettled([
      value.authorizeAndConsume(grant, readRequest),
      value.authorizeAndConsume(grant, readRequest)
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(value.authenticate(created.credential)).toBeNull()
    expect(value.list()[0]).toMatchObject({ useCount: 1, maxUses: 1 })
  })

  it('invalidates pending dispatches when authority changes but not when a credential is created or consumed', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-mcp-capability-'))
    const authorityChanged = vi.fn()
    const value = new McpCapabilityProfileStore(
      join(directory, 'profiles.json'),
      () => new Date('2026-09-11T12:00:00.000Z'),
      authorityChanged
    )
    await value.load()
    const created = await value.create({
      name: 'Mutable', allowedTools: ['browser_snapshot'], operationClasses: ['read'], maxUses: 4
    })
    expect(authorityChanged).not.toHaveBeenCalled()
    await value.authorizeAndConsume(value.authenticate(created.credential)!, readRequest)
    expect(authorityChanged).not.toHaveBeenCalled()

    const updated = await value.update(created.profile.id, {
      name: 'Updated', allowedTools: ['browser_snapshot'], operationClasses: ['read']
    })
    await value.rotate(updated.profile.id)
    await value.revoke(updated.profile.id)
    expect(authorityChanged).toHaveBeenCalledTimes(3)
  })

  it('derives only strict subsets and records parent authorization lineage', async () => {
    const value = await store()
    const parent = await value.create({
      name: 'Delegating QA',
      allowedTools: ['browser_click', 'browser_snapshot', 'browser_storage'],
      allowedActions: { browser_storage: ['get', 'set'] },
      operationClasses: ['read', 'interact', 'site-data'],
      workspaceIds: [workspaceId, otherWorkspaceId],
      origins: ['https://allowed.example', 'https://other.example'],
      expiresAt: '2026-09-11T13:00:00.000Z',
      maxUses: 2
    })
    const grant = value.authenticate(parent.credential)!
    const childInput: McpCapabilityProfileInput = {
      name: 'One delegated read',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read'],
      workspaceIds: [workspaceId],
      origins: ['https://allowed.example/path'],
      expiresAt: '2026-09-11T12:30:00.000Z',
      maxUses: 1
    }
    const child = await value.derive(grant, childInput)

    expect(child.profile.parentAuthorization).toEqual({
      profileId: parent.profile.id,
      revision: parent.profile.revision,
      credentialId: parent.profile.credentialId
    })
    expect(value.authenticate(child.credential)?.profileId).toBe(child.profile.id)
    expect(() => value.authorize(value.authenticate(child.credential)!, readRequest)).not.toThrow()
    const persisted = await readFile(join(directory!, 'mcp-capability-profiles.json'), 'utf8')
    expect(persisted).not.toContain(parent.credential)
    expect(persisted).not.toContain(child.credential)
    const reloaded = new McpCapabilityProfileStore(
      join(directory!, 'mcp-capability-profiles.json'),
      () => new Date('2026-09-11T12:00:00.000Z')
    )
    await reloaded.load()
    expect(reloaded.authenticate(child.credential)?.profileId).toBe(child.profile.id)

    const updatedChild = await value.update(child.profile.id, { ...childInput, name: 'Renamed delegated read' })
    expect(updatedChild.profile.parentAuthorization).toEqual(child.profile.parentAuthorization)
    expect(value.authenticate(updatedChild.credential)?.profileId).toBe(child.profile.id)
    await expect(value.update(child.profile.id, {
      ...childInput,
      name: 'Illegally widened child',
      allowedTools: ['browser_snapshot', 'browser_tabs']
    })).rejects.toThrow(McpCapabilityAuthorizationError)

    const widened: McpCapabilityProfileInput[] = [
      { ...childInput, name: 'Tool widened', allowedTools: ['browser_snapshot', 'browser_tabs'] },
      { ...childInput, name: 'Class widened', operationClasses: ['read', 'network'] },
      { ...childInput, name: 'Workspace widened', workspaceIds: [workspaceId, '01912345-678b-7abc-8def-0123456789ab'] },
      { ...childInput, name: 'Workspace unrestricted', workspaceIds: undefined },
      { ...childInput, name: 'Origin widened', origins: ['https://private.example'] },
      { ...childInput, name: 'Origin unrestricted', origins: undefined },
      { ...childInput, name: 'Expiry widened', expiresAt: '2026-09-11T13:01:00.000Z' },
      { ...childInput, name: 'Uses widened', maxUses: 3 }
    ]
    for (const candidate of widened) {
      await expect(value.derive(grant, candidate)).rejects.toThrow(McpCapabilityAuthorizationError)
    }

    await expect(value.derive(grant, {
      name: 'Action widened',
      allowedTools: ['browser_storage'],
      operationClasses: ['site-data'],
      workspaceIds: [workspaceId],
      origins: ['https://allowed.example'],
      expiresAt: '2026-09-11T12:30:00.000Z',
      maxUses: 1
    })).rejects.toThrow(McpCapabilityAuthorizationError)
  })

  it('shares bounded uses with ancestors and invalidates descendants when lineage changes', async () => {
    let current = new Date('2026-09-11T12:00:00.000Z')
    const value = await store(() => current)
    const parent = await value.create({
      name: 'Two reads',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read'],
      expiresAt: '2026-09-11T13:00:00.000Z',
      maxUses: 2
    })
    const parentGrant = value.authenticate(parent.credential)!
    const child = await value.derive(parentGrant, {
      name: 'Delegated reads',
      allowedTools: ['browser_snapshot'],
      operationClasses: ['read'],
      expiresAt: '2026-09-11T12:30:00.000Z',
      maxUses: 2
    })
    const childGrant = value.authenticate(child.credential)!

    await value.authorizeAndConsume(childGrant, readRequest)
    expect(value.list().find(profile => profile.id === parent.profile.id)?.useCount).toBe(1)
    expect(value.list().find(profile => profile.id === child.profile.id)?.useCount).toBe(1)
    await value.authorizeAndConsume(childGrant, readRequest)
    expect(value.authenticate(parent.credential)).toBeNull()
    expect(value.authenticate(child.credential)).toBeNull()
    expect(() => value.authorizeActiveDispatch(childGrant, readRequest)).not.toThrow()

    const rotatable = await value.create({
      name: 'Rotatable parent', allowedTools: ['browser_snapshot'], operationClasses: ['read']
    })
    const rotatableGrant = value.authenticate(rotatable.credential)!
    const descendant = await value.derive(rotatableGrant, {
      name: 'Invalidated child', allowedTools: ['browser_snapshot'], operationClasses: ['read'], maxUses: 1
    })
    const descendantGrant = value.authenticate(descendant.credential)!
    await value.rotate(rotatable.profile.id)
    expect(value.authenticate(descendant.credential)).toBeNull()
    expect(() => value.authorize(descendantGrant, readRequest)).toThrow(McpCapabilityAuthorizationError)
    expect(value.list().find(profile => profile.id === descendant.profile.id)?.lineageActive).toBe(false)

    current = new Date('2026-09-11T13:01:00.000Z')
    expect(value.authenticate(child.credential)).toBeNull()
  })
})
