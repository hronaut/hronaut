import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PublicationGate = { held: boolean; release(): void; restore(): void }
type PublicationGlobal = typeof globalThis & { __pdfPublicationGate?: PublicationGate }

for (const change of ['pause', 'pause ABA', 'workspace access', 'workspace access ABA', 'cancel', 'replacement', 'unchanged'] as const) {
  test(`PDF publication after durable audit append across ${change}`, async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const abort = new AbortController()
    const listenerCount = () => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.listenerCount('did-navigate'), fixtureUrl)
    const listenersBefore = await listenerCount()
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_pdf_save') requestId = message.id
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
        ;(globalThis as PublicationGlobal).__pdfPublicationGate = gate
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_pdf_save') actionId = event.actionId!
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
      pending = client.callTool({ name: 'browser_pdf_save', arguments: { tabId, filename: 'publication.pdf' } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PublicationGlobal).__pdfPublicationGate?.held)).toBe(true)
      expect(await listenerCount()).toBe(listenersBefore + 1)
      // The file is already committed. This guard protects response publication, not rollback.
      const before = await readFile(join(profileDirectory, 'publication.pdf'))
      expect(before.subarray(0, 5).toString()).toBe('%PDF-')
      if (change === 'replacement') {
        await rename(join(profileDirectory, 'publication.pdf'), join(profileDirectory, 'moved.pdf'))
        await writeFile(join(profileDirectory, 'publication.pdf'), 'replacement file')
      }
      if (change === 'pause' || change === 'pause ABA' || change === 'replacement') {
        await appWindow.evaluate(async ({ id, resume }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          await api.setTabAgentPaused(id, true)
          if (resume) await api.setTabAgentPaused(id, false)
        }, { id: tabId, resume: change === 'pause ABA' })
      } else if (change === 'workspace access' || change === 'workspace access ABA') {
        await appWindow.evaluate(async ({ id, resume }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const workspaceId = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
          await api.updateTabGroup(workspaceId, { agentAccess: false })
          if (resume) await api.updateTabGroup(workspaceId, { agentAccess: true })
        }, { id: tabId, resume: change === 'workspace access ABA' })
      } else if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing synthetic request id')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Synthetic cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as PublicationGlobal).__pdfPublicationGate!.release())
      const result = await pending
      // The SDK suppresses responses to cancelled requests. Wait for the actual
      // server-side publication finally, rather than trusting the client abort.
      await expect.poll(listenerCount).toBe(listenersBefore)
      if (change !== 'cancel') expect(text(result)).not.toBe('Client cancelled')
      if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result))).toMatchObject({ filename: 'publication.pdf', bytes: before.length })
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(text(result)).not.toContain('publication.pdf')
        expect(text(result)).not.toContain(profileDirectory)
      }
      if (change === 'replacement') {
        expect(await readFile(join(profileDirectory, 'publication.pdf'), 'utf8')).toBe('replacement file')
        expect(await readFile(join(profileDirectory, 'moved.pdf'))).toEqual(before)
      } else expect(await readFile(join(profileDirectory, 'publication.pdf'))).toEqual(before)
    } finally {
      abort.abort()
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as PublicationGlobal
        scope.__pdfPublicationGate?.release()
        scope.__pdfPublicationGate?.restore()
        delete scope.__pdfPublicationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
    }
  })
}
