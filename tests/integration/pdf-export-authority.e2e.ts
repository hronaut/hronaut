import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PdfGate = { ready: boolean; bytes: number; release(): void; restore(): void }
type PdfGlobal = typeof globalThis & { __pdfAuthorityGate?: PdfGate }

const cases = [
  ['render', 'pause'], ['render', 'pause ABA'], ['render', 'global pause ABA'],
  ['render', 'workspace access ABA'], ['render', 'ownership release'], ['render', 'cancel'],
  ['write', 'pause'], ['write', 'cancel'], ['close', 'pause'], ['close', 'cancel'],
  ['write', 'replacement'], ['render', 'unchanged'], ['render', 'human']
] as const
for (const [phase, change] of cases) {
  test(`PDF export ${phase} boundary across ${change}`, async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const abort = new AbortController()
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_pdf_save') requestId = message.id
      return send(message, options)
    }
    let pending: Promise<CallToolResult> | undefined
    try {
      await electronApp.evaluate(({ webContents }, { url, phase }) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const original = page.printToPDF
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        const gate: PdfGate = { ready: false, bytes: 0, release, restore: () => {
          if (!page.isDestroyed()) page.printToPDF = original
          fs.open = open
          syncBuiltinESMExports()
        } }
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (args[1] === 'wx' && String(args[0]).endsWith('.pdf')) {
            const write = handle.writeFile.bind(handle)
            const close = handle.close.bind(handle)
            handle.writeFile = async (data, options) => {
              await write(data, options)
              if (phase === 'write') { gate.ready = true; await barrier }
            }
            handle.close = async () => {
              await close()
              if (phase === 'close' && !gate.ready) { gate.ready = true; await barrier }
            }
          }
          return handle
        }
        syncBuiltinESMExports()
        ;(globalThis as PdfGlobal).__pdfAuthorityGate = gate
        page.printToPDF = async options => {
          const bytes = await original.call(page, options)
          gate.bytes = bytes.length
          if (phase === 'render') { gate.ready = true; await barrier }
          return bytes
        }
      }, { url: fixtureUrl, phase })
      if (change === 'unchanged' || change === 'human' || change === 'ownership release') await writeFile(join(profileDirectory, 'authority.pdf'), 'existing file')
      pending = change === 'human'
        ? appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.savePdf({ tabId: id, filename: 'authority.pdf' }).then(value => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })), tabId)
        : client.callTool({ name: 'browser_pdf_save', arguments: { tabId, filename: 'authority.pdf' } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PdfGlobal).__pdfAuthorityGate?.ready)).toBe(true)
      expect(await electronApp.evaluate(() => (globalThis as PdfGlobal).__pdfAuthorityGate?.bytes)).toBeGreaterThan(1000)
      if (change === 'replacement') {
        await rename(join(profileDirectory, 'authority.pdf'), join(profileDirectory, 'moved.pdf'))
        await writeFile(join(profileDirectory, 'authority.pdf'), 'replacement file')
      }
      if (change === 'pause' || change === 'replacement' || change === 'human') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
      } else if (change === 'pause ABA') {
        await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.setTabAgentPaused(id, true); await api.setTabAgentPaused(id, false) }, tabId)
      } else if (change === 'global pause ABA') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      } else if (change === 'workspace access ABA' || change === 'ownership release') {
        const workspaceId = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!, tabId)
        if (change === 'workspace access ABA') {
          await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.updateTabGroup(id, { agentAccess: false }); await api.updateTabGroup(id, { agentAccess: true }) }, workspaceId)
        } else {
          const released = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId } }) as CallToolResult
          expect(released.isError, text(released)).toBe(true)
          expect(JSON.parse(text(released))).toMatchObject({ status: 'BUSY', reason: 'WORKSPACE_BUSY', dispatch: 'not-dispatched' })
        }
      } else if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing synthetic request id')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Synthetic cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as PdfGlobal).__pdfAuthorityGate!.release())
      const result = await pending
      if (change !== 'cancel') expect(text(result)).not.toBe('Client cancelled')
      if (change === 'cancel') {
        await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
          const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
          return home?.executeJavaScript("fetch('/api/status').then(r=>r.json()).then(s=>s.recentActivity.some(a=>a.toolName==='browser_pdf_save'&&a.result.outcome==='cancelled'))")
        })).toBe(true)
      }
      if (change === 'unchanged' || change === 'human' || change === 'ownership release') {
        expect(result.isError, text(result)).not.toBe(true)
        const saved = JSON.parse(text(result)) as { filename: string; path: string; bytes: number }
        expect(saved.filename).toBe('authority (1).pdf')
        expect(await readFile(join(profileDirectory, 'authority.pdf'), 'utf8')).toBe('existing file')
        const bytes = await readFile(saved.path)
        expect(bytes.length).toBe(saved.bytes)
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
      } else {
        expect(result.isError, text(result)).toBe(true)
        if (change === 'replacement') {
          expect(await readFile(join(profileDirectory, 'authority.pdf'), 'utf8')).toBe('replacement file')
          expect((await readFile(join(profileDirectory, 'moved.pdf'))).subarray(0, 5).toString()).toBe('%PDF-')
        } else expect((await readdir(profileDirectory)).filter(name => name.endsWith('.pdf'))).toEqual([])
      }
    } finally {
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as PdfGlobal
        scope.__pdfAuthorityGate?.release()
        scope.__pdfAuthorityGate?.restore()
        delete scope.__pdfAuthorityGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
    }
  })
}
