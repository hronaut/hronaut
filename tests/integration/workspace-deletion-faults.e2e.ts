import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

type Fault = 'clear-held' | 'intent-rejected' | 'intent-committed'
for (const mode of ['active', 'archived'] as const) for (const fault of ['clear-held', 'intent-rejected', 'intent-committed'] as const) {
  test(`${mode} deletion survives process interruption at ${fault}`, async ({ profileDirectory, mcpPort }, info) => {
    const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Deletion fault fixture</title>') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    let instance = await launchHronaut(profileDirectory, mcpPort)
    let deletion: Promise<'completed' | 'rejected' | 'transport-closed'> | undefined
    const create = async (name: string) => {
      const url = `${origin}/${name}`
      const group = await instance.window.evaluate(async ({ url, name }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const state = await api.createWorkspace({ name, storage: 'scratch' })
        await api.navigate({ tabId: state.activeTabId!, url })
        return state.mcpTabGroups.find(g => g.name === name)!.id
      }, { url, name })
      await expect.poll(() => instance.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(w => w.getURL() === url && !w.isLoading()), url)).toBe(true)
      const path = await instance.app.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(w => w.getURL() === url)!
        await page.executeJavaScript(`localStorage.setItem('fixture-session', ${JSON.stringify('SYNTHETIC_FAULT_CANARY' + new URL(url).pathname)})`)
        return page.session.storagePath!
      }, url)
      return { group, path, url }
    }
    const readState = async () => JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8')) as {
      mcpTabGroups: Array<{ id: string; storageId: string }>
      savedTabGroups: Array<{ id: string; storageId: string }>
      deletedWorkspaceStorageIds?: string[]
    }
    const present = async (url: string) => instance.app.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(w => w.getURL() === url)
      return page ? page.executeJavaScript(`localStorage.getItem('fixture-session') === ${JSON.stringify('SYNTHETIC_FAULT_CANARY' + new URL(url).pathname)}`) : null
    }, url)
    try {
      const target = await create('Delete-target')
      if (mode === 'archived') await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), target.group)
      const archived = await create('Retain-archived')
      await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), archived.group)
      const active = await create('Retain-active')
      // Establish durable control sessions before the deliberate process interruption.
      await closeHronaut(instance.app)
      const initial = await readState()
      const storageId = [...initial.mcpTabGroups, ...initial.savedTabGroups].find(g => g.id === target.group)!.storageId
      instance = await launchHronaut(profileDirectory, mcpPort)
      await expect.poll(() => present(active.url)).toBe(true)
      await instance.app.evaluate(({ session }, { storageId, fault, metadataPath }) => {
        const scope = globalThis as typeof globalThis & { __deletionFault?: { entered: boolean } }
        const state = { entered: false }; scope.__deletionFault = state
        const held = new Promise<void>(() => undefined)
        if (fault === 'clear-held') {
          const targetSession = session.fromPartition(`persist:hronaut-workspace-${storageId}`)
          targetSession.clearData = async () => { state.entered = true; await held }
        } else {
          const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
          const { syncBuiltinESMExports } = process.getBuiltinModule('node:module') as typeof import('node:module')
          const original = fs.rename
          fs.rename = async (from, to) => {
            if (String(to) === metadataPath) {
              const snapshot = JSON.parse(await fs.readFile(from, 'utf8')) as { deletedWorkspaceStorageIds?: string[] }
              if (snapshot.deletedWorkspaceStorageIds?.includes(storageId)) {
                if (fault === 'intent-rejected') { state.entered = true; throw new Error('Synthetic deletion-intent write failure') }
                await original(from, to)
                state.entered = true
                await held
                return
              }
            }
            await original(from, to)
          }
          syncBuiltinESMExports()
        }
      }, { storageId, fault: fault as Fault, metadataPath: join(profileDirectory, 'tabs.json') })
      deletion = instance.window.evaluate(async ({ group, mode }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        try {
          if (mode === 'archived') await api.deleteSavedTabGroup(group)
          else await api.closeWorkspace(group)
          return 'completed' as const
        } catch { return 'rejected' as const }
      }, { group: target.group, mode }).catch(() => 'transport-closed' as const)
      await expect.poll(() => instance.app.evaluate(() => (globalThis as typeof globalThis & { __deletionFault?: { entered: boolean } }).__deletionFault?.entered)).toBe(true)
      if (fault === 'intent-rejected') expect(await deletion).toBe('rejected')
      const boundary = await readState()
      const committed = fault === 'intent-committed'
      expect([...boundary.mcpTabGroups, ...boundary.savedTabGroups].some(g => g.storageId === storageId)).toBe(!committed)
      expect((boundary.deletedWorkspaceStorageIds ?? []).includes(storageId)).toBe(committed)
      const child = instance.app.process()
      const exited = new Promise<NodeJS.Signals | null>(resolve => child.once('exit', (_code, signal) => resolve(signal)))
      expect(child.kill('SIGKILL')).toBe(true)
      expect(await exited).toBe('SIGKILL')
      await deletion
      instance = await launchHronaut(profileDirectory, mcpPort)
      await expect.poll(() => present(active.url)).toBe(true)
      await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), archived.group)
      await expect.poll(() => present(archived.url)).toBe(true)
      const recovered = await readState()
      if (committed) {
        await expect(stat(target.path)).rejects.toMatchObject({ code: 'ENOENT' })
        expect([...recovered.mcpTabGroups, ...recovered.savedTabGroups].some(g => g.storageId === storageId)).toBe(false)
        expect(recovered.deletedWorkspaceStorageIds ?? []).not.toContain(storageId)
      } else {
        expect((await stat(target.path)).isDirectory()).toBe(true)
        expect([...recovered.mcpTabGroups, ...recovered.savedTabGroups].some(g => g.storageId === storageId)).toBe(true)
        expect(recovered.deletedWorkspaceStorageIds ?? []).not.toContain(storageId)
        {
          if (mode === 'archived') await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), target.group)
          // A rejected intent write preserves ownership, not a rollback of logical clearing.
          await expect.poll(() => present(target.url)).toBe(fault === 'clear-held')
        }
      }
      await info.attach('deletion-fault-boundary', { body: JSON.stringify({ mode, fault, committed, processSignal: 'SIGKILL', retainedActiveAndArchivedSessions: true, powerLossSimulated: false }), contentType: 'application/json' })
    } finally { await closeHronaut(instance.app); await Promise.allSettled([deletion].filter(Boolean)); await closeFixtureServer(server) }
  })
}
