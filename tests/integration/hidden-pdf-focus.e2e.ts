import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('exports a hidden page to PDF without interrupting foreground focus', async ({ appWindow, electronApp, mcpPort, mcpToken, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Hidden PDF fixture</title><style>body{min-height:3000px}</style><h1>Hidden print content</h1><input id="draft">')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'hidden-pdf-focus', version: '1' })
  const call = async (name: string, arguments_: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: arguments_ }) as CallToolResult
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text)
  }
  let humanId: number | undefined
  const shellId = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id)
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const { id: workspaceId } = await call('browser_workspaces', { action: 'create', name: 'Hidden PDF', storage: 'scratch' }) as { id: string }
    await appWindow.evaluate('window.hronautSettings.setFollowAgentActivity(false)')
    const state = await call('browser_new_tab', { workspaceId, url }) as { tabs: Array<{ id: string; url: string }> }
    const tabId = state.tabs.find(tab => tab.url === url)?.id
    expect(tabId).toBeTruthy()
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, target) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === target)
      return page ? page.executeJavaScript("!!document.querySelector('#draft')") : false
    }, url)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, target) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === target)
      if (!page) throw new Error('Missing print page')
      await page.executeJavaScript("window.__printIdentity = 'retained'; document.querySelector('input').value = 'unsaved'; scrollTo(0, 400)")
    }, url)
    humanId = await electronApp.evaluate(async ({ BrowserWindow }, fullscreen) => {
      BrowserWindow.getAllWindows()[0]!.hide()
      const human = new BrowserWindow({ width: 320, height: 200, show: false, fullscreen })
      await human.loadURL('data:text/html,<title>Human foreground</title><input autofocus>')
      human.show()
      human.focus()
      return human.id
    }, process.env.HRONAUT_TEST_WAYLAND === '1')
    if (process.env.HRONAUT_TEST_WAYLAND === '1') {
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.getBounds().width, humanId!)).toBeGreaterThan(1600)
      execFileSync('xdotool', ['mousemove', '960', '540', 'click', '1'])
    }
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanId)
    if (process.env.HRONAUT_TEST_WAYLAND === '1') {
      await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.setFullScreen(false), humanId)
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.getBounds().width, humanId!)).toBeLessThan(400)
    }
    await electronApp.evaluate(({ BrowserWindow }, id) => {
      const state = globalThis as typeof globalThis & { __pdfBlurCount?: number }
      state.__pdfBlurCount = 0
      BrowserWindow.fromId(id)!.on('blur', () => { state.__pdfBlurCount! += 1 })
    }, humanId)
    const pdf = await call('browser_pdf_save', { workspaceId, tabId, filename: 'hidden-focus.pdf' }) as { path: string; bytes: number }
    expect(pdf.path).toBe(join(profileDirectory, 'hidden-focus.pdf'))
    const bytes = await readFile(pdf.path)
    expect(bytes.length).toBe(pdf.bytes)
    expect(bytes.length).toBeGreaterThan(1000)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(await electronApp.evaluate(({ webContents }, target) => {
      return webContents.getAllWebContents().find(contents => contents.getURL() === target)?.executeJavaScript("({identity:window.__printIdentity,draft:document.querySelector('input').value,scroll:scrollY})")
    }, url)).toEqual({ identity: 'retained', draft: 'unsaved', scroll: 400 })
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __pdfBlurCount?: number }).__pdfBlurCount)).toBe(0)
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanId)
    expect(await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.isVisible(), shellId)).toBe(false)
  } finally {
    await client.close()
    if (humanId !== undefined) await electronApp.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.fromId(id)?.destroy()
      delete (globalThis as typeof globalThis & { __pdfBlurCount?: number }).__pdfBlurCount
    }, humanId)
    await closeFixtureServer(server)
  }
})
