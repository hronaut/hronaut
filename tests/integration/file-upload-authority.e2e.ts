import type { ElectronApplication } from '@playwright/test'
import type { McpToolActivity } from '../../src/main/mcp/activity-history.js'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type UploadGate = { ready: boolean; releaseReady: boolean; completeRelease(): void; commits: number; releases: number; objectId?: string; documentListeners: number; release(): void; restore(): void }
type UploadGlobal = typeof globalThis & { __uploadGate?: UploadGate }

async function uploadActivities(app: ElectronApplication, tabId: string): Promise<McpToolActivity[]> {
  return app.evaluate(async ({ webContents }, id) => {
    const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Missing Home session for upload settlement observation')
    const response = await home.session.fetch('hronaut://home/api/status')
    if (!response.ok) throw new Error(`Upload settlement observation failed: ${response.status}`)
    const state = await response.json() as { recentActivity: McpToolActivity[] }
    return state.recentActivity.filter(activity => activity.toolName === 'browser_file_upload' && activity.tabId === id)
  }, tabId)
}

const changes = ['unchanged', 'pause', 'access', 'pause ABA', 'access ABA', 'route', 'document', 'cancel'] as const
const cases = [...changes.map(change => ({ change, holdRelease: false })), { change: 'cancel' as const, holdRelease: true }]
for (const { change, holdRelease } of cases) {
  test(`file upload revalidates authority after input lookup: ${change}${holdRelease ? ' with held release completion' : ''}`, async ({ capabilities, electronApp, appWindow, profileDirectory }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    const previousActivityIds = new Set((await uploadActivities(electronApp, tabId)).map(activity => activity.activityId))
    const completedUploads = async (): Promise<McpToolActivity[]> => (await uploadActivities(electronApp, tabId)).filter(activity => !previousActivityIds.has(activity.activityId))
    const path = join(profileDirectory, 'harmless-upload-canary.txt')
    await writeFile(path, 'Local authority regression canary. No transmission.', 'utf8')
    await electronApp.evaluate(async ({ webContents }, { url, holdRelease }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      await page.executeJavaScript("document.body.innerHTML='<input id=upload-canary type=file>';window.uploadChanges=0;document.querySelector('#upload-canary').addEventListener('change',()=>window.uploadChanges++);")
      const send = page.debugger.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      let completeRelease!: () => void
      const releaseBarrier = new Promise<void>(resolve => { completeRelease = resolve })
      const gate: UploadGate = { releaseReady: false, completeRelease, ready: false, commits: 0, releases: 0, documentListeners: page.listenerCount('did-navigate'), release, restore: () => { if (!page.isDestroyed()) page.debugger.sendCommand = send } }
      ;(globalThis as UploadGlobal).__uploadGate = gate
      page.debugger.sendCommand = async (method, ...args) => {
        if (method === 'DOM.setFileInputFiles') gate.commits++
        if (method === 'Runtime.releaseObject' && args[0]?.objectId === gate.objectId) gate.releases++
        const result = await send.call(page.debugger, method, ...args)
        if (holdRelease && method === 'Runtime.releaseObject' && args[0]?.objectId === gate.objectId) {
          gate.releaseReady = true
          await releaseBarrier
        }
        if (method === 'Runtime.evaluate' && String(args[0]?.expression).includes('upload-canary')) {
          gate.objectId = (result as { result?: { objectId?: string } }).result?.objectId
          gate.ready = true
          await barrier
        }
        return result
      }
    }, { url: fixtureUrl, holdRelease })
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
      if (holdRelease) {
        await expect.poll(() => electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate!.releaseReady)).toBe(true)
        // Client cancellation and release entry are both observable before the
        // server operation's finally blocks finish. Keep that ordering deterministic.
        expect(await completedUploads()).toEqual([])
        const held = await electronApp.evaluate(({ webContents }, url) => {
          const gate = (globalThis as UploadGlobal).__uploadGate!
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
          return { commits: gate.commits, releases: gate.releases, extraListeners: page.listenerCount('did-navigate') - gate.documentListeners }
        }, fixtureUrl)
        await testInfo.attach('upload-held-release-observation', { body: JSON.stringify(held), contentType: 'application/json' })
        expect(held).toEqual({ commits: 0, releases: 1, extraListeners: 1 })
        await electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate!.completeRelease())
      }
      if (change === 'cancel') {
        // The aborted client promise is synthetic completion, not server cleanup.
        // Terminal activity is recorded only after the upload handler unwinds.
        await expect.poll(completedUploads).toMatchObject([{ result: { outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED' } }])
      }
      const observation = await electronApp.evaluate(async ({ webContents }, url) => {
        const gate = (globalThis as UploadGlobal).__uploadGate!
        const page = webContents.getAllWebContents().find(contents => contents.getURL().split('#')[0] === url.split('#')[0])!
        return { commits: gate.commits, releases: gate.releases, listenersRestored: page.listenerCount('did-navigate') === gate.documentListeners, page: await page.executeJavaScript("({ files:document.querySelector('#upload-canary').files.length, changes:window.uploadChanges })") }
      }, fixtureUrl)
      await testInfo.attach('upload-authority-observation', { body: JSON.stringify({ change, holdRelease, result, observation, activities: await completedUploads() }), contentType: 'application/json' })
      const count = change === 'unchanged' ? 1 : 0
      expect(observation).toEqual({ commits: count, releases: 1, listenersRestored: true, page: { files: count, changes: count } })
      expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
      if (change !== 'unchanged' && change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    } finally {
      transport.send = send
      await electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate?.completeRelease()).catch(() => undefined)
      await electronApp.evaluate(() => (globalThis as UploadGlobal).__uploadGate?.release()).catch(() => undefined)
      await pending?.catch(() => undefined)
      await electronApp.evaluate(() => { const scope = globalThis as UploadGlobal; scope.__uploadGate?.restore(); delete scope.__uploadGate }).catch(() => undefined)
    }
  })

}
