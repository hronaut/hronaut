import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

/** A one-page PDF that says `text`, with the byte offsets its cross-reference table needs. */
function pdf(text: string): Buffer {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/** A website that sends /report.pdf to show, /attachment.pdf to download and /embedded, a page showing the report. */
async function pdfServer() {
  const document = pdf('Quarterly report')
  const server = createServer((request, response) => {
    if (request.url === '/embedded') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Embedded report</title><embed src="/report.pdf" type="application/pdf" width="600" height="400">')
    } else if (request.url === '/report.pdf') {
      response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': document.length }).end(document)
    } else if (request.url === '/attachment.pdf') {
      response.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="invoice.pdf"', 'content-length': document.length }).end(document)
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Start</title>Start')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

type ShellWindow = typeof window & {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<unknown>
    getState(): Promise<{ tabs: Array<{ title: string; url: string; active: boolean }> }>
  }
  hronautDownloads: { list(): Promise<Array<{ filename?: string; state?: string }>> }
}

test('shows a PDF in its tab with Chromium\'s viewer, as Chrome does, whose Download button saves it, and still downloads one the website sends as an attachment', async ({ appWindow, electronApp }) => {
  const { server, origin } = await pdfServer()
  const activeTab = async () => (await appWindow.evaluate(() => (window as ShellWindow).hronaut.getState())).tabs.find(tab => tab.active)
  const downloads = async () => (await appWindow.evaluate(() => (window as ShellWindow).hronautDownloads.list())).map(download => [download.filename, download.state])
  try {
    await appWindow.evaluate(url => { void (window as ShellWindow).hronaut.newTab({ url, active: true }) }, `${origin}/report.pdf`)
    await expect.poll(async () => (await activeTab())?.url).toBe(`${origin}/report.pdf`)
    // The viewer, Chromium's own page, draws the PDF in a frame of the tab, and names the tab after the file.
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)?.mainFrame.framesInSubtree
      .some(frame => frame.origin === 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'), `${origin}/report.pdf`)).toBe(true)
    await expect.poll(async () => (await activeTab())?.title).toBe('report.pdf')
    expect(await downloads()).toEqual([])

    // The viewer's Download button, once the viewer shows the PDF's one page, saves it as any website download.
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const viewer = webContents.getAllWebContents().find(contents => contents.getURL() === url)?.mainFrame.framesInSubtree
        .find(frame => frame.origin === 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai')
      return viewer?.executeJavaScript(`(() => {
        const toolbar = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar')?.shadowRoot
        if (toolbar?.querySelector('viewer-page-selector')?.shadowRoot?.querySelector('#pagelength')?.textContent?.trim() !== '1') return false
        const save = toolbar.querySelector('viewer-download-controls')?.shadowRoot?.querySelector('#save')
        save?.click()
        return Boolean(save)
      })()`, true)
    }, `${origin}/report.pdf`)).toBe(true)
    await expect.poll(downloads).toEqual([['report.pdf', 'completed']])

    await appWindow.evaluate(url => { void (window as ShellWindow).hronaut.newTab({ url, active: true }) }, `${origin}/attachment.pdf`)
    await expect.poll(downloads).toEqual(expect.arrayContaining([['invoice.pdf', 'completed']]))
  } finally {
    await closeFixtureServer(server)
  }
})

test('shows a PDF a page embeds, and tells websites that it can, as Chrome does', async ({ appWindow, electronApp }) => {
  const { server, origin } = await pdfServer()
  try {
    await appWindow.evaluate(url => { void (window as ShellWindow).hronaut.newTab({ url, active: true }) }, `${origin}/embedded`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)?.mainFrame.framesInSubtree
      .some(frame => frame.origin === 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'), `${origin}/embedded`)).toBe(true)
    // Websites read this to embed a PDF rather than offer it as a download.
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)?.executeJavaScript('navigator.pdfViewerEnabled'), `${origin}/embedded`)).toBe(true)
    expect(await appWindow.evaluate(() => (window as ShellWindow).hronautDownloads.list())).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})

test('shows an agent\'s PDF in its tab, which the agent can read the page of and take a screenshot of', async ({ appWindow, mcpPort, mcpToken }) => {
  const { server, origin } = await pdfServer()
  const client = new Client({ name: 'pdf-viewer-test', version: '1' })
  const text = (result: CallToolResult): string => result.content.map(item => item.type === 'text' ? item.text : '').join('\n')
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, `${name}: ${text(result)}`).not.toBe(true)
    return result
  }
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspaceId = (JSON.parse(text(await call('browser_workspaces', { action: 'create', name: 'Reports', storage: 'scratch' }))) as { id: string }).id
    const tabId = (JSON.parse(text(await call('browser_new_tab', { workspaceId, url: `${origin}/start` }))) as { activeTabId: string }).activeTabId
    await call('browser_navigate', { workspaceId, tabId, url: `${origin}/report.pdf` })
    expect(text(await call('browser_snapshot', { workspaceId, tabId }))).toContain(`URL: ${origin}/report.pdf`)
    expect((await call('browser_screenshot', { workspaceId, tabId })).content.some(item => item.type === 'image')).toBe(true)
    expect(await appWindow.evaluate(() => (window as ShellWindow).hronautDownloads.list())).toEqual([])
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
