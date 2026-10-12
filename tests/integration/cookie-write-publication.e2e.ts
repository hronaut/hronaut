import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PublicationGate = { held: boolean; release(): void; restore(): void }
type PublicationGlobal = typeof globalThis & { __cookiePublicationGate?: PublicationGate }

for (const change of ['pause ABA', 'navigation ABA', 'unchanged'] as const) {
  test(`Cookie publication after durable audit append across ${change}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
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
        ;(globalThis as PublicationGlobal).__cookiePublicationGate = gate
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_storage') actionId = event.actionId!
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
      pending = client.callTool({ name: 'browser_storage', arguments: { tabId, kind: 'cookies', action: 'set', key: 'publication-fixture', value: 'synthetic-publication-cookie-canary', includeValues: true } }) as Promise<CallToolResult>
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PublicationGlobal).__cookiePublicationGate?.held)).toBe(true)
      // The native write has completed; this barrier is in later audit persistence.
      expect(await electronApp.evaluate(async ({ webContents }, url) => (await webContents.getAllWebContents().find(p => p.getURL() === url)!.session.cookies.get({ url, name: 'publication-fixture' })).length, fixtureUrl)).toBe(1)
      if (change === 'pause ABA') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        await api.setTabAgentPaused(id, false)
      }, tabId)
      if (change === 'navigation ABA') await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        await page.loadURL('data:text/html,cookie publication changed')
        await page.loadURL(url)
      }, fixtureUrl)
      await electronApp.evaluate(() => (globalThis as PublicationGlobal).__cookiePublicationGate!.release())
      const result = await pending
      if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result))).toMatchObject({ changed: true })
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', attemptedWrites: 1, acknowledgedWrites: 1, retrySafe: false })
        expect(text(result)).not.toContain('synthetic-publication-cookie-canary')
        expect(text(result)).not.toContain('publication-fixture')
      }
      expect(await electronApp.evaluate(async ({ webContents }, url) => (await webContents.getAllWebContents().find(p => p.getURL() === url)!.session.cookies.get({ url, name: 'publication-fixture' })).length, fixtureUrl)).toBe(1)
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as PublicationGlobal
        scope.__cookiePublicationGate?.release()
        scope.__cookiePublicationGate?.restore()
        delete scope.__cookiePublicationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
    }
  })
}
