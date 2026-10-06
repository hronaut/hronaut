import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

for (const variant of ['404', '500', 'redirect', 'cache', '204', 'abort', 'blank']) {
  test(`frame observation requires correlated committed history for ${variant}`, async ({ capabilities, electronApp }) => {
    let childRequests = 0
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html')
      if (request.url?.startsWith('/parent')) {
        response.end(`<iframe id="chosen" src="${variant === 'blank' ? 'about:blank' : '/child'}"></iframe>`)
      } else if (request.url === '/child') {
        childRequests++
        if (variant === 'abort') { response.destroy(); return }
        if (variant === 'redirect') { response.writeHead(302, { location: '/final' }); response.end(); return }
        if (variant === '204') { response.writeHead(204); response.end(); return }
        if (variant === '404' || variant === '500') response.statusCode = Number(variant)
        if (variant === 'cache') response.setHeader('Cache-Control', 'public, max-age=3600')
        response.end('<h1>Observed committed child</h1>')
      } else response.end('<h1>Observed final redirect</h1>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      const nav = await capabilities.client.callTool({ name: 'browser_navigate', arguments: { tabId: capabilities.tabId, url: origin + '/parent' } }) as CallToolResult
      expect(nav.isError, text(nav)).not.toBe(true)
      if (variant === 'cache') {
        await electronApp.evaluate(async ({ webContents }, origin) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/parent')!
          await page.executeJavaScript(`new Promise(resolve=>{const frame=document.querySelector('#chosen');frame.onload=()=>resolve(true);frame.src='/child'})`, false)
        }, origin)
        expect(childRequests).toBe(1)
      }
      const result = await capabilities.client.callTool({ name: 'browser_snapshot', arguments: { tabId: capabilities.tabId, frameSelector: '#chosen' } }) as CallToolResult
      if (['204', 'abort', 'blank'].includes(variant)) {
        expect(result.isError, text(result)).toBe(true)
        expect(JSON.stringify(result)).not.toContain('Observed committed child')
      } else {
        expect(result.isError, text(result)).not.toBe(true)
        expect(result.structuredContent).toMatchObject({ kind: 'frame-observation', text: expect.stringContaining(variant === 'redirect' ? 'h1: Observed final redirect' : 'h1: Observed committed child') })
      }
    } finally { await closeFixtureServer(server) }
  })
}
