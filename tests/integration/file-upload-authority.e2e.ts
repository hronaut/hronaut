import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type UploadGate = { ready: boolean; commits: number; releases: number; objectId?: string; documentListeners: number; release(): void; restore(): void }
type UploadGlobal = typeof globalThis & { __uploadGate?: UploadGate }

for (const change of ['unchanged', 'pause', 'access', 'pause ABA', 'access ABA', 'route', 'document', 'cancel'] as const) {
  test(`file upload revalidates authority after input lookup: ${change}`, async ({ capabilities, electronApp, appWindow, profileDirectory }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    const path = join(profileDirectory, 'harmless-upload-canary.txt')
    await writeFile(path, 'Local authority regression canary. No transmission.', 'utf8')
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      await page.executeJavaScript("document.body.innerHTML='<input id=upload-canary type=file>';window.uploadChanges=0;document.querySelector('#upload-canary').addEventListener('change',()=>window.uploadChanges++);")
      const send = page.debugger.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: UploadGate = { ready: false, commits: 0, releases: 0, documentListeners: page.listenerCount('did-navigate'), release, restore: () => { if (!page.isDestroyed()) page.debugger.sendCommand = send } }
      ;(globalThis as UploadGlobal).__uploadGate = gate
      page.debugger.sendCommand = async (method, ...args) => {
        if (method === 'DOM.setFileInputFiles') gate.commits++
        if (method === 'Runtime.releaseObject' && args[0]?.objectId === gate.objectId) gate.releases++
        const result = await send.call(page.debugger, method, ...args)
        if (method === 'Runtime.evaluate' && String(args[0]?.expression).includes('upload-canary')) {
          gate.objectId = (result as { result?: { objectId?: string } }).result?.objectId
          gate.ready = true
          await barrier
        }
        return result
      }
    }, fixtureUrl)
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_file_upload') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    try {
      pending = client.callTool({ name: 'browser_file_upload', arguments: { tabId, selector: '#upload-canary', paths: [path] } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate!.ready)).toBe(true)
      if (change.startsWith('pause')) await appWindow.evaluate(async ({ id, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        if (resume) await api.setTabAgentPaused(id, false)
      }, { id: tabId, resume: change === 'pause ABA' })
      if (change.startsWith('access')) await appWindow.evaluate(async ({ id, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false })
        if (resume) await api.updateTabGroup(workspace, { agentAccess: true })
      }, { id: tabId, resume: change === 'access ABA' })
      if (change === 'route') await electronApp.evaluate(async ({ webContents }, url) => {
        await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("location.hash='changed-upload-context'")
      }, fixtureUrl)
      if (change === 'document') await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        await page.loadURL(url)
        await page.executeJavaScript("document.body.innerHTML='<input id=upload-canary type=file>';window.uploadChanges=0;document.querySelector('#upload-canary').addEventListener('change',()=>window.uploadChanges++);")
      }, fixtureUrl)
      if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing upload request id')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled upload cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate!.release())
      const result = await pending
      await expect.poll(() => electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate!.releases)).toBe(1)
      const observation = await electronApp.evaluate(async ({ webContents }, url) => {
        const gate = (globalThis as UploadGlobal).__uploadGate!
        const page = webContents.getAllWebContents().find(contents => contents.getURL().split('#')[0] === url.split('#')[0])!
        return { commits: gate.commits, releases: gate.releases, listenersRestored: page.listenerCount('did-navigate') === gate.documentListeners, page: await page.executeJavaScript("({ files:document.querySelector('#upload-canary').files.length, changes:window.uploadChanges })") }
      }, fixtureUrl)
      await testInfo.attach('upload-authority-observation', { body: JSON.stringify({ change, result, observation }), contentType: 'application/json' })
      const count = change === 'unchanged' ? 1 : 0
      expect(observation).toEqual({ commits: count, releases: 1, listenersRestored: true, page: { files: count, changes: count } })
      expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
      if (change !== 'unchanged' && change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    } finally {
      transport.send = send
      await electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate?.release()).catch(() => undefined)
      await pending?.catch(() => undefined)
      await electronApp.evaluate(() => { const scope = globalThis as UploadGlobal; scope.__uploadGate?.restore(); delete scope.__uploadGate }).catch(() => undefined)
    }
  })

}
