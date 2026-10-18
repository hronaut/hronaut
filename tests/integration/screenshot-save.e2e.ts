import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface SavedScreenshot {
  filename: string
  path: string
  mimeType: string
  width: number
  height: number
  bytes: number
  capturedAt: string
}

// A red page with a blue square in its top-left corner, so saved pixels can be checked.
const PAGE = `<!doctype html><title>Screenshot save fixture</title>
<style>html, body { margin: 0; height: 100%; background: rgb(255, 0, 0) } #mark { position: fixed; left: 0; top: 0; width: 100px; height: 100px; background: rgb(0, 0, 255) }</style>
<div id="mark"></div>`

test('saves the viewport as a PNG in downloads and returns only where it went', async ({ appWindow, electronApp, mcpPort, mcpToken, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'hronaut-screenshot-save-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const textOf = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      if (result.isError) throw new Error(textOf(result))
      return JSON.parse(textOf(result)) as T
    }
    const workspaceId = (await call<{ id: string }>('browser_workspaces', { action: 'create', name: 'Screenshot records' })).id
    const tabId = (await call<{ activeTabId: string }>('browser_new_tab', { workspaceId, url: `${origin}/` })).activeTabId
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const ready = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, selector: '#mark', state: 'visible' } }) as CallToolResult
    expect(ready.isError, textOf(ready)).not.toBe(true)
    const save = (args: Record<string, unknown> = {}) => client.callTool({ name: 'browser_screenshot_save', arguments: { workspaceId, tabId, ...args } }) as Promise<CallToolResult>
    /** The saved PNG's colour at a fraction of its width and height, decoded in main. */
    const pixel = (path: string, fx: number, fy: number) => electronApp.evaluate(({ nativeImage }, { path, fx, fy }) => {
      const image = nativeImage.createFromPath(path)
      const { width, height } = image.getSize()
      const bitmap = image.toBitmap({ scaleFactor: 1 })
      const offset = (Math.floor(fy * height) * width + Math.floor(fx * width)) * 4
      // The bitmap is BGRA.
      return { r: bitmap[offset + 2], g: bitmap[offset + 1], b: bitmap[offset], width, height }
    }, { path, fx, fy })

    // The result is text only: metadata about the file, no image and no base64.
    const result = await save({ filename: 'qa-record' })
    expect(result.isError, textOf(result)).not.toBe(true)
    expect(result.content.map(part => part.type)).toEqual(['text'])
    expect(textOf(result).length).toBeLessThan(1000)
    const saved = JSON.parse(textOf(result)) as SavedScreenshot
    expect(saved).toMatchObject({ filename: 'qa-record.png', path: join(profileDirectory, 'qa-record.png'), mimeType: 'image/png' })
    expect(Object.keys(saved).sort()).toEqual(['bytes', 'capturedAt', 'filename', 'height', 'mimeType', 'path', 'width'])
    expect(Number.isNaN(Date.parse(saved.capturedAt))).toBe(false)
    expect((await stat(saved.path)).size).toBe(saved.bytes)
    expect((await readFile(saved.path)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(await pixel(saved.path, 0.5, 0.5)).toEqual({ r: 255, g: 0, b: 0, width: saved.width, height: saved.height })
    const ratio = await call<number>('browser_evaluate', { workspaceId, tabId, script: 'devicePixelRatio' })
    expect(await pixel(saved.path, (50 * ratio) / saved.width, (50 * ratio) / saved.height)).toMatchObject({ r: 0, g: 0, b: 255 })

    // The same name again never overwrites: the next file gets a number.
    const first = await readFile(saved.path)
    const again = await call<SavedScreenshot>('browser_screenshot_save', { workspaceId, tabId, filename: 'qa-record' })
    expect(again.filename).toBe('qa-record (1).png')
    expect(await readFile(saved.path)).toEqual(first)
    const together = await Promise.all([save({ filename: 'together' }), save({ filename: 'together' })])
    const togetherPaths = together.filter(entry => !entry.isError).map(entry => (JSON.parse(textOf(entry)) as SavedScreenshot).path)
    expect(togetherPaths.length).toBeGreaterThan(0)
    expect(new Set(togetherPaths).size).toBe(togetherPaths.length)

    // maxWidth scales the saved image down.
    const small = await call<SavedScreenshot>('browser_screenshot_save', { workspaceId, tabId, maxWidth: 100 })
    expect(small.width).toBeLessThanOrEqual(100)
    expect(small.filename).toBe('Screenshot save fixture.png')

    // Unsafe names and options this tool does not take fail before anything is written.
    const before = (await readdir(profileDirectory)).filter(name => name.endsWith('.png')).sort()
    for (const args of [
      { filename: '../escape' }, { filename: 'folder/file' }, { filename: 'CON' }, { filename: 'trailing.' },
      { fullPage: true }, { format: 'jpeg' }, { annotateRefs: ['e1'] }, { clip: { x: 0, y: 0, width: 10, height: 10 } }, { selector: '#mark' }, { maxWidth: 10 }
    ]) {
      const rejected = await save(args)
      expect(rejected.isError, JSON.stringify(args)).toBe(true)
    }
    expect((await readdir(profileDirectory)).filter(name => name.endsWith('.png')).sort()).toEqual(before)
    expect((await readdir(dirname(profileDirectory))).some(name => name === 'escape.png')).toBe(false)

    // A navigation while the capture is pending rejects the export and leaves no file.
    await electronApp.evaluate(({ webContents }, prefix) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(prefix))!
      const original = page.capturePage.bind(page)
      const scope = globalThis as typeof globalThis & { releaseCapture?: () => void; captureHeld?: boolean }
      page.capturePage = (async (...args: Parameters<typeof page.capturePage>) => {
        page.capturePage = original
        scope.captureHeld = true
        await new Promise<void>(resolve => { scope.releaseCapture = resolve })
        return original(...args)
      }) as typeof page.capturePage
    }, origin)
    const pending = save({ filename: 'navigated' })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { captureHeld?: boolean }).captureHeld === true)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, prefix) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(prefix))!
      await page.loadURL(`${prefix}/next`)
      ;(globalThis as typeof globalThis & { releaseCapture?: () => void }).releaseCapture?.()
    }, origin)
    const navigated = await pending
    expect(navigated.isError).toBe(true)
    expect(textOf(navigated)).toContain('page changed')
    expect((await readdir(profileDirectory)).some(name => name.startsWith('navigated'))).toBe(false)

    // An ordinary screenshot still returns its image.
    const ordinary = await client.callTool({ name: 'browser_screenshot', arguments: { workspaceId, tabId } }) as CallToolResult
    expect(ordinary.content.some(part => part.type === 'image')).toBe(true)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
