import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type PdfGate = { ready: boolean; bytes: number; release(): void; restore(): void }
type PdfTestGlobal = typeof globalThis & { __pdfExportGate?: PdfGate }

for (const change of ['navigate', 'reload', 'close', 'unchanged'] as const) {
  test(`settles a PDF export after ${change} while native print completion is held`, async ({ electronApp, mcpPort, mcpToken, profileDirectory }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end('<!doctype html><title>PDF lifecycle</title><h1>Printable fixture</h1>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const url = `http://127.0.0.1:${address.port}/`
    const client = new Client({ name: 'pdf-lifecycle', version: '1' })
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const parsed = (result: CallToolResult) => {
      const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      expect(result.isError, text).not.toBe(true)
      return JSON.parse(text)
    }
    let pending: Promise<CallToolResult> | undefined
    try {
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
      }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
      const { id: workspaceId } = parsed(await call('browser_workspaces', { action: 'create', name: 'PDF lifecycle', storage: 'scratch' })) as { id: string }
      const state = parsed(await call('browser_new_tab', { workspaceId, url })) as { tabs: Array<{ id: string; url: string }> }
      const tabId = state.tabs.find(tab => tab.url === url)?.id
      expect(tabId).toBeTruthy()
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, target) => {
        const contents = webContents.getAllWebContents().find(page => page.getURL() === target)
        return contents ? contents.executeJavaScript("document.querySelector('h1')?.textContent") : null
      }, url)).toBe('Printable fixture')
      await electronApp.evaluate(({ webContents }, target) => {
        const contents = webContents.getAllWebContents().find(page => page.getURL() === target)!
        const original = contents.printToPDF
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: PdfGate = {
          ready: false, bytes: 0, release,
          restore: () => { if (!contents.isDestroyed()) contents.printToPDF = original }
        }
        ;(globalThis as PdfTestGlobal).__pdfExportGate = gate
        contents.printToPDF = async options => {
          const data = await original.call(contents, options)
          gate.bytes = data.length
          gate.ready = true
          await barrier
          return data
        }
      }, url)
      const filename = 'document-lifecycle.pdf'
      if (change === 'unchanged') await writeFile(join(profileDirectory, filename), 'existing file')
      pending = call('browser_pdf_save', { workspaceId, tabId, filename })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PdfTestGlobal).__pdfExportGate?.ready)).toBe(true)
      expect(await electronApp.evaluate(() => (globalThis as PdfTestGlobal).__pdfExportGate?.bytes)).toBeGreaterThan(1000)
      if (change !== 'unchanged') {
        await electronApp.evaluate(async ({ webContents }, { target, action }) => {
          const contents = webContents.getAllWebContents().find(page => page.getURL() === target)!
          if (action === 'close') contents.close()
          else await contents.loadURL(action === 'reload' ? target : `${target}next`)
        }, { target: url, action: change })
      }
      await electronApp.evaluate(() => (globalThis as PdfTestGlobal).__pdfExportGate!.release())
      const result = await pending
      if (change === 'unchanged') {
        const saved = parsed(result) as { filename: string; path: string; bytes: number }
        expect(saved.filename).toBe('document-lifecycle (1).pdf')
        expect(await readFile(join(profileDirectory, filename), 'utf8')).toBe('existing file')
        const bytes = await readFile(saved.path)
        expect(bytes.length).toBe(saved.bytes)
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
      } else {
        expect((await readdir(profileDirectory)).filter(name => name.endsWith('.pdf'))).toEqual([])
        expect(result.isError).toBe(true)
      }
    } finally {
      await electronApp.evaluate(() => {
        const state = globalThis as PdfTestGlobal
        state.__pdfExportGate?.restore()
        state.__pdfExportGate?.release()
        delete state.__pdfExportGate
      })
      await pending?.catch(() => undefined)
      await client.close()
      await closeFixtureServer(server)
    }
  })
}
