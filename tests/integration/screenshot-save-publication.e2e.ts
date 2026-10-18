import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PublicationGate = { held: boolean; release(): void; restore(): void }
type PublicationGlobal = typeof globalThis & { __screenshotPublicationGate?: PublicationGate }

// The file is complete before the call's audit outcome is appended; holding that append lets the person change
// the call's authority, or the page, after the write and before the result is published.
for (const change of ['pause', 'workspace access', 'cancel', 'navigation', 'unchanged'] as const) {
  test(`screenshot save publication after durable audit append across ${change}`, async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const abort = new AbortController()
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_screenshot_save') requestId = message.id
      return send(message, options)
    }
    let pending: Promise<CallToolResult> | undefined
    try {
      const started = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
      expect(started.isError, text(started)).not.toBe(true)
      await electronApp.evaluate(() => {
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        let actionId = ''
        const gate: PublicationGate = { held: false, release, restore: () => { fs.open = open; syncBuiltinESMExports() } }
        ;(globalThis as PublicationGlobal).__screenshotPublicationGate = gate
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_screenshot_save') actionId = event.actionId!
              if (event.phase === 'outcome' && event.actionId === actionId && !gate.held) {
                gate.held = true
                await barrier
              }
              return write(data, options)
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      })
      pending = client.callTool({ name: 'browser_screenshot_save', arguments: { tabId, filename: 'publication' } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PublicationGlobal).__screenshotPublicationGate?.held)).toBe(true)
      // The file is already complete. This guard protects response publication, not rollback.
      const before = await readFile(join(profileDirectory, 'publication.png'))
      expect(before.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      if (change === 'pause') {
        await appWindow.evaluate(async id => { await (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true) }, tabId)
      } else if (change === 'workspace access') {
        await appWindow.evaluate(async id => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const workspaceId = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
          await api.updateTabGroup(workspaceId, { agentAccess: false })
        }, tabId)
      } else if (change === 'navigation') {
        await electronApp.evaluate(async ({ webContents }, url) => {
          await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(`${url}&after=save`)
        }, fixtureUrl)
      } else if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing synthetic request id')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Synthetic cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as PublicationGlobal).__screenshotPublicationGate!.release())
      const result = await pending
      if (change === 'unchanged' || change === 'navigation') {
        // Once the file is complete, a navigation does not change what was saved.
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result))).toMatchObject({ filename: 'publication.png', bytes: before.length })
      } else if (change === 'cancel') {
        // The SDK suppresses responses to cancelled requests.
        expect(text(result)).toBe('Client cancelled')
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(JSON.parse(text(result))).toMatchObject({ status: 'SAVED_UNCONFIRMED', effects: 'file-written', retrySafe: false })
        expect(text(result)).not.toContain('publication')
        expect(text(result)).not.toContain(profileDirectory)
      }
      expect(await readFile(join(profileDirectory, 'publication.png'))).toEqual(before)
    } finally {
      abort.abort()
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as PublicationGlobal
        scope.__screenshotPublicationGate?.release()
        scope.__screenshotPublicationGate?.restore()
        delete scope.__screenshotPublicationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
    }
  })
}
