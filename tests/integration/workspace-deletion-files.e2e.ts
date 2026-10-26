import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, collectRendererDiagnostics, expect, launchHronaut, test } from './fixtures.js'

for (const mode of ['active', 'archived'] as const) {
  test(`explicit ${mode} deletion removes files next startup and preserves active and archived profiles`, async ({ profileDirectory, mcpPort }, testInfo) => {
    const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Deletion fixture</title>') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    let instance = await launchHronaut(profileDirectory, mcpPort)
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
        await page.executeJavaScript("localStorage.setItem('fixture-session', 'SYNTHETIC_SESSION_CANARY')")
        return page.session.storagePath!
      }, url)
      return { group, path, url }
    }
    try {
      const deleted = await create('Delete-this')
      if (mode === 'archived') await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), deleted.group)
      const archived = await create('Keep-archived')
      await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), archived.group)
      const active = await create('Keep-active')
      await closeHronaut(instance.app)
      const before = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8'))
      const storageId = [...before.mcpTabGroups, ...before.savedTabGroups].find((g: { id: string }) => g.id === deleted.group).storageId
      instance = await launchHronaut(profileDirectory, mcpPort)
      await instance.window.evaluate(async ({ group, mode }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        if (mode === 'archived') await api.deleteSavedTabGroup(group)
        else await api.closeWorkspace(group)
      }, { group: deleted.group, mode })
      // Success must already include durable intent, without a test-injected flush or quit.
      const committed = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8'))
      expect(committed.deletedWorkspaceStorageIds).toContain(storageId)
      expect([...committed.mcpTabGroups, ...committed.savedTabGroups].some((g: { storageId: string }) => g.storageId === storageId)).toBe(false)
      await closeHronaut(instance.app)
      instance = await launchHronaut(profileDirectory, mcpPort)
      // Shell creation precedes async workspace restoration. Wait for the retained
      // native page, which can open only after cold cleanup finishes.
      await expect.poll(() => instance.app.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(w => w.getURL() === url)
        return page ? page.executeJavaScript("localStorage.getItem('fixture-session') === 'SYNTHETIC_SESSION_CANARY'") : false
      }, active.url)).toBe(true)
      await expect(stat(deleted.path)).rejects.toMatchObject({ code: 'ENOENT' })
      await instance.window.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), archived.group)
      for (const kept of [active, archived]) {
        expect((await stat(kept.path)).isDirectory()).toBe(true)
        await expect.poll(() => instance.app.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(w => w.getURL() === url)
          return page ? page.executeJavaScript("localStorage.getItem('fixture-session') === 'SYNTHETIC_SESSION_CANARY'") : false
        }, kept.url)).toBe(true)
      }
      const settled = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8'))
      expect(settled.deletedWorkspaceStorageIds ?? []).not.toContain(storageId)
    } catch (error) {
      // This test launches Hronaut itself, so the fixture attaches no renderer report for it; closing would drop it.
      await testInfo.attach('renderer-exits', { body: JSON.stringify(await collectRendererDiagnostics(instance.app)), contentType: 'application/json' })
      throw error
    } finally { await closeHronaut(instance.app); await closeFixtureServer(server) }
  })
}
