import { createHash, randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { ReactInspectionBootstrap, ReactInspectionCommand, ReactInspectionResult, ReactInspectionStatus } from '../../shared/react-inspection.js'
import { observeReactTopology, type ReactInspectionProtocolResult } from './react-inspection-observer.js'

export interface ReactInspectionAuthority { assertCurrent(): void; epoch: string }
export interface ReactInspectionTarget {
  identity: object
  page: WebContents
  workspaceId: string | undefined
  workspaceIdentity: object | undefined
  permissionGeneration: number
  navigationGeneration: number
  observationGeneration: number
}
interface Host {
  resolve(tabId: string): ReactInspectionTarget
  run<T>(contentsId: number, operation: () => Promise<T>): Promise<T>
  requireDebuggerOwner(tabId: string): void
  mainWorldContextId(page: WebContents): Promise<number>
}
interface Installation {
  enabled: boolean
  intent: number
  target: ReactInspectionTarget
  assertAuthority(): void
  id?: string
  cleanup(): void
}
class InspectionFailure extends Error {
  constructor(readonly status: ReactInspectionStatus) { super(`React inspection ${status}`) }
}
export function boundReactInspectionResponse(result: ReactInspectionResult): ReactInspectionResult {
  const responseBytes = () => Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }), 'utf8')
  while (responseBytes() > 16000 && result.nodes.length) {
    result.nodes.pop()
    result.partial = true
    result.limit = 'bytes'
  }
  if (responseBytes() > 16000) throw new InspectionFailure('unavailable')
  return result
}

/** Owns ephemeral opt-in only. Never serialized into browser/workspace storage. */
export class ReactInspectionController {
  private readonly intents = new WeakMap<object, number>()
  private disposed = false
  private readonly installations = new Map<string, Installation>()
  constructor(private readonly host: Host) {}

  bootstrap(tabId: string): ReactInspectionBootstrap {
    const record = this.installations.get(tabId)
    if (!record?.enabled) return { enabled: false }
    try {
      const current = this.host.resolve(tabId)
      this.requireInstallationTarget(current, record.target)
      if (this.disposed || this.intents.get(current.identity) !== record.intent) return { enabled: false }
      record.assertAuthority()
      record.id = randomUUID()
      return { enabled: true, installationId: record.id }
    } catch {
      record.enabled = false
      return { enabled: false }
    }
  }

  status(tabId: string): ReactInspectionResult {
    const target = { ...this.host.resolve(tabId) }
    const record = this.installations.get(tabId)
    return this.result(target, !record?.enabled
      ? record?.id ? 'disabled-reload-required' : 'disabled'
      : record.id ? 'installed-readiness-unchecked' : 'reload-required', record)
  }

  disable(tabId: string): ReactInspectionResult {
    const target = { ...this.host.resolve(tabId) }
    this.intents.set(target.identity, (this.intents.get(target.identity) ?? 0) + 1)
    const record = this.installations.get(tabId)
    if (record) {
      record.enabled = false
      if (!record.target.page.isDestroyed()) record.target.page.send('react-inspection:disable')
    }
    return this.status(tabId)
  }

  invalidateWorkspace(workspaceId: string): void {
    for (const [tabId, record] of this.installations) {
      if (record.target.workspaceId === workspaceId) this.disable(tabId)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const record of this.installations.values()) record.cleanup()
    this.installations.clear()
  }

  async run(tabId: string, command: ReactInspectionCommand, authority: ReactInspectionAuthority): Promise<ReactInspectionResult> {
    authority.assertCurrent()
    const target = { ...this.host.resolve(tabId) }
    const original = this.installations.get(tabId)
    if (command.action === 'disable') return this.disable(tabId)
    if (command.action === 'status') return this.status(tabId)
    if (!/^https?:\/\//.test(target.page.getURL())) return this.result(target, 'unavailable')
    const intent = (this.intents.get(target.identity) ?? 0) + (command.action === 'enable' ? 1 : 0)
    this.intents.set(target.identity, intent)
    const deadline = Date.now() + 2000
    let timedOut = false
    let detached = false
    const current = () => {
      authority.assertCurrent()
      if (this.disposed || this.intents.get(target.identity) !== intent) throw new InspectionFailure('interrupted')
      if (timedOut || Date.now() >= deadline) throw new InspectionFailure('timed-out')
      const actual = this.host.resolve(tabId)
      this.requireInstallationTarget(actual, target)
      if (actual.navigationGeneration !== target.navigationGeneration || actual.observationGeneration !== target.observationGeneration) throw new InspectionFailure('interrupted')
      if (command.action === 'tree' && (this.installations.get(tabId) !== original || !original?.enabled)) throw new InspectionFailure('unavailable')
    }
    const owner = () => {
      current()
      if (detached || !target.page.debugger.isAttached()) throw new InspectionFailure('interrupted')
      this.host.requireDebuggerOwner(tabId)
    }
    const operation = this.host.run(target.page.id, async () => {
      current()
      if (command.action === 'enable') {
        original?.cleanup()
        const record: Installation = {
          enabled: true, intent, target,
          assertAuthority: () => {
            authority.assertCurrent()
            this.requireInstallationTarget(this.host.resolve(tabId), target)
          },
          cleanup: () => {
            target.page.removeListener('destroyed', destroyed)
            target.page.removeListener('did-start-navigation', navigation)
          }
        }
        const destroyed = () => {
          record.cleanup()
          if (this.installations.get(tabId) === record) this.installations.delete(tabId)
        }
        const navigation = (_event: Electron.Event, _url: string, sameDocument: boolean, mainFrame: boolean) => {
          if (mainFrame && !sameDocument) record.id = undefined
        }
        target.page.once('destroyed', destroyed)
        target.page.on('did-start-navigation', navigation)
        this.installations.set(tabId, record)
        return this.result(target, 'reload-required', record)
      }
      owner()
      if (!original?.id) return this.result(target, 'reload-required', original)
      const prefix = createHash('sha256').update(JSON.stringify([
        target.workspaceId, tabId, original.id, target.permissionGeneration,
        target.navigationGeneration, target.observationGeneration, authority.epoch
      ])).digest('hex') + ':'
      if (command.subtreeId && !command.subtreeId.startsWith(prefix)) throw new InspectionFailure('stale-observation')
      const group = `react-inspection-${randomUUID()}`
      const onDetach = () => { detached = true }
      target.page.debugger.on('detach', onDetach)
      try {
        const contextId = await this.host.mainWorldContextId(target.page)
        owner()
        const observation = await observeReactTopology({ send: async (method, params) => {
          owner()
          const response = await target.page.debugger.sendCommand(method, { ...params, objectGroup: group, ...(method === 'Runtime.evaluate' ? { contextId } : {}) }) as ReactInspectionProtocolResult
          owner()
          return response
        } }, command.subtreeId?.slice(prefix.length), original.id)
        owner()
        return boundReactInspectionResponse({
          ...this.result(target, observation.status, original),
          nodes: observation.nodes.map(node => ({ ...node, id: prefix + node.id, parent: node.parent ? prefix + node.parent : null })),
          visited: observation.visited, partial: Boolean(observation.limit), ...(observation.limit ? { limit: observation.limit } : {})
        })
      } finally {
        try {
          if (!detached && !target.page.isDestroyed() && target.page.debugger.isAttached()) {
            // Do not take over a session that DevTools or another recorder is acquiring.
            this.host.requireDebuggerOwner(tabId)
            await target.page.debugger.sendCommand('Runtime.releaseObjectGroup', { objectGroup: group })
          }
        } catch { /* Detached sessions discard their handles; never attach to clean up. */ }
        target.page.debugger.removeListener('detach', onDetach)
      }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new InspectionFailure('timed-out')) }, Math.max(0, deadline - Date.now()))
      })])
      current()
      return result
    } catch (error) {
      // Authorization failures retain the gateway's original typed rejection.
      authority.assertCurrent()
      return this.result(target, error instanceof InspectionFailure ? error.status
        : error instanceof Error && error.message === 'stale subtree' ? 'stale-observation' : 'unavailable', original)
    } finally {
      if (timer) clearTimeout(timer)
      // Caller timeout does not cancel the native command or release its queue slot.
    }
  }

  private requireInstallationTarget(current: ReactInspectionTarget, expected: ReactInspectionTarget): void {
    if (current.identity !== expected.identity || current.page !== expected.page || current.page.isDestroyed()
      || current.workspaceId !== expected.workspaceId || current.workspaceIdentity !== expected.workspaceIdentity
      || current.permissionGeneration !== expected.permissionGeneration) throw new InspectionFailure('interrupted')
  }

  private result(target: ReactInspectionTarget, status: ReactInspectionStatus, record?: Installation): ReactInspectionResult {
    return {
      status, enabled: record?.enabled === true, reloadRequired: status === 'reload-required' || status === 'disabled-reload-required',
      navigationGeneration: target.navigationGeneration, ...(record?.id ? { installationId: record.id } : {}),
      nodes: [], partial: false, visited: 0, coverage: 'observed-topology-only'
    }
  }
}
