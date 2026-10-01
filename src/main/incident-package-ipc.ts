import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IncidentPackages } from './incident-package.js'
import { writeTextFileAtomically } from './atomic-file.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

export function registerIncidentPackageIpc(ipc: Pick<IpcMain, 'handle'>, host: {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  tabs(): Pick<BrowserTabsManager, 'getState' | 'debugReport' | 'networkHar' | 'reproRecording'>
  version: string
  pickDestination(): Promise<string | undefined>
  write?: typeof writeTextFileAtomically
}): void {
  const packages = new IncidentPackages(host.tabs, host.version)
  const owners = new WeakSet<object>()
  function owner(event: IpcMainInvokeEvent): number {
    host.assertTrustedSender(event)
    const id = event.sender.id
    if (!owners.has(event.sender)) {
      owners.add(event.sender)
      event.sender.once('destroyed', () => packages.forget(id))
    }
    return id
  }
  ipc.handle('browser:incident-capture', async (event, input: unknown) => {
    const id = owner(event)
    const draft = await packages.capture(id, input)
    try { host.assertTrustedSender(event) } catch (error) { packages.discard(id); throw error }
    return draft
  })
  ipc.handle('browser:incident-review', (event, input: unknown) => packages.review(owner(event), input))
  ipc.handle('browser:incident-discard', event => { packages.discard(owner(event)) })
  ipc.handle('browser:incident-save', async (event, input: unknown) => {
    const id = owner(event)
    const request = z.object({ draftId: z.string().uuid(), previewId: z.string().uuid(), reviewed: z.literal(true) }).strict().parse(input)
    packages.export(id, request.draftId, request.previewId)
    const path = await host.pickDestination()
    host.assertTrustedSender(event)
    if (!path) return { saved: false }
    const preview = packages.export(id, request.draftId, request.previewId)
    await (host.write ?? writeTextFileAtomically)(path, preview.html, 0o600, () => {
      host.assertTrustedSender(event)
      packages.export(id, request.draftId, request.previewId)
    })
    return { saved: true, sha256: preview.sha256, bytes: preview.bytes }
  })
}
