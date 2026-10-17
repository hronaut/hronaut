import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { pageSizes, readOutline } from './pdf-structure.js'

type PageSize = { width: number; height: number }
const size = (width: number, height: number): PageSize => ({ width, height })
const LETTER = size(612, 792)
const LETTER_LANDSCAPE = size(792, 612)
const LEGAL = size(612, 1008)
const A4_LANDSCAPE = size(842, 595)

const page = (css: string, body = '<section><h1>One</h1></section><section><h1>Two</h1></section>') =>
  `<!doctype html><meta charset="utf-8"><title>CSS paper</title><style>section { break-after: page } ${css}</style>${body}`
const pages: Record<string, string> = {
  '/a4-landscape': page('@page { size: A4 landscape }'),
  '/custom': page('@page { size: 4in 6in }'),
  '/orientation': page('@page { size: landscape }'),
  '/portrait': page('@page { size: portrait }'),
  '/none': page(''),
  '/too-small': page('@page { size: 0.5in 0.5in }'),
  '/named': page('@page wide { size: A4 landscape } .wide { page: wide }', '<section>One</section><section class="wide">Two</section>'),
  '/huge': page('@page { size: 250in 250in }'),
  '/tiny': page('@page { size: 1in 1in }', `<p>${'Words '.repeat(3_000)}</p>`)
}

// Electron's named A4 and CSS's A4 differ by about a point, so sizes match within two points.
function expectPages(actual: PageSize[], expected: PageSize[], label = ''): void {
  expect(actual.length, `${label} ${JSON.stringify(actual)}`).toBe(expected.length)
  actual.forEach((page, index) => {
    const message = `${label} page ${index + 1}: ${JSON.stringify(page)}`
    expect(Math.abs(page.width - expected[index]!.width), message).toBeLessThanOrEqual(2)
    expect(Math.abs(page.height - expected[index]!.height), message).toBeLessThanOrEqual(2)
  })
}

test('exports the paper size from the page\'s CSS only when asked', async ({ appWindow, electronApp, mcpPort, mcpToken, profileDirectory }) => {
  // The 1,000-page refusal renders 1,001 tiny pages first.
  test.slow()
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(pages[new URL(request.url ?? '/', 'http://fixture').pathname] ?? pages['/none'])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'pdf-css-page-size', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const textOf = (result: CallToolResult) => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const parsed = (result: CallToolResult) => {
    expect(result.isError, textOf(result)).not.toBe(true)
    return JSON.parse(textOf(result))
  }
  const savedPdfs = async () => (await readdir(profileDirectory)).filter(name => name.endsWith('.pdf')).sort()
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const { id: workspaceId } = parsed(await call('browser_workspaces', { action: 'create', name: 'CSS paper', storage: 'scratch' })) as { id: string }
    const waitForPage = (url: string) => expect.poll(() => electronApp.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(page => page.getURL() === target)
      return contents && !contents.isLoading() ? contents.executeJavaScript('document.readyState') : null
    }, url)).toBe('complete')
    const tabs = new Map<string, string>()
    const tabFor = async (path: string): Promise<string> => {
      const known = tabs.get(path)
      if (known) return known
      const url = `${origin}${path}`
      const state = parsed(await call('browser_new_tab', { workspaceId, url })) as { tabs: Array<{ id: string; url: string }> }
      const tabId = state.tabs.find(tab => tab.url === url)?.id
      expect(tabId).toBeTruthy()
      await waitForPage(url)
      tabs.set(path, tabId!)
      return tabId!
    }
    const save = async (path: string, options: Record<string, unknown>) => {
      const saved = parsed(await call('browser_pdf_save', { workspaceId, tabId: await tabFor(path), filename: 'paper.pdf', ...options })) as { path: string; bytes: number }
      const pdf = await readFile(saved.path)
      expect(pdf.length).toBe(saved.bytes)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      return pageSizes(pdf)
    }
    const saveFile = async (path: string, options: Record<string, unknown>) =>
      readFile((parsed(await call('browser_pdf_save', { workspaceId, tabId: await tabFor(path), filename: 'paper.pdf', ...options })) as { path: string }).path)

    // The CSS size wins over pageSize and landscape; without the option Chromium already turns the paper to the CSS orientation.
    for (const options of [{}, { pageSize: 'Legal' }, { landscape: true }, { pageSize: 'A4', landscape: false }]) {
      expectPages(await save('/a4-landscape', { preferCSSPageSize: true, ...options }), [A4_LANDSCAPE, A4_LANDSCAPE], JSON.stringify(options))
    }
    expectPages(await save('/a4-landscape', {}), [LETTER_LANDSCAPE, LETTER_LANDSCAPE])
    expectPages(await save('/a4-landscape', { preferCSSPageSize: false, pageSize: 'Legal' }), [size(1008, 612), size(1008, 612)])
    expectPages(await save('/custom', { preferCSSPageSize: true, landscape: true }), [size(288, 432), size(288, 432)])
    expectPages(await save('/custom', { pageSize: 'Legal' }), [LEGAL, LEGAL])

    // An orientation alone turns the chosen paper; no size, or one Chromium ignores, falls back to pageSize and landscape.
    expectPages(await save('/orientation', { preferCSSPageSize: true, pageSize: 'A4', landscape: false }), [A4_LANDSCAPE, A4_LANDSCAPE])
    expectPages(await save('/portrait', { preferCSSPageSize: true, pageSize: 'Legal', landscape: true }), [LEGAL, LEGAL])
    expectPages(await save('/none', { preferCSSPageSize: true, pageSize: 'Legal' }), [LEGAL, LEGAL])
    expectPages(await save('/none', { preferCSSPageSize: true, landscape: true }), [LETTER_LANDSCAPE, LETTER_LANDSCAPE])
    expectPages(await save('/too-small', { preferCSSPageSize: true }), [LETTER, LETTER])

    // Named pages keep their own sizes, and Chromium writes sizes over the 200-inch PDF limit as authored.
    expectPages(await save('/named', { preferCSSPageSize: true }), [LETTER, A4_LANDSCAPE])
    expectPages(await save('/huge', { preferCSSPageSize: true }), [size(18_000, 18_000), size(18_000, 18_000)])

    // Heading bookmarks survive the page range the CSS size adds.
    const both = await saveFile('/a4-landscape', { preferCSSPageSize: true, outline: true })
    expectPages(pageSizes(both), [A4_LANDSCAPE, A4_LANDSCAPE])
    expect(readOutline(both)).toEqual([{ title: 'One', page: 1, children: [] }, { title: 'Two', page: 2, children: [] }])

    const before = await savedPdfs()
    const tinyTab = await tabFor('/tiny')
    const started = performance.now()
    const refused = await call('browser_pdf_save', { workspaceId, tabId: tinyTab, filename: 'tiny.pdf', preferCSSPageSize: true })
    test.info().annotations.push({ type: 'pdf-css-page-limit', description: `1in pages refused after ${Math.round(performance.now() - started)} ms` })
    expect(refused.isError, textOf(refused)).toBe(true)
    expect(textOf(refused)).toContain('more than 1,000 pages')
    const tiny = pageSizes(await readFile((parsed(await call('browser_pdf_save', { workspaceId, tabId: tinyTab, filename: 'tiny.pdf' })) as { path: string }).path))
    expectPages(tiny, tiny.map(() => LETTER), 'without preferCSSPageSize')

    for (const preferCSSPageSize of ['yes', 1, null]) {
      const rejected = await call('browser_pdf_save', { workspaceId, tabId: tinyTab, filename: 'invalid.pdf', preferCSSPageSize })
      expect(rejected.isError, textOf(rejected)).toBe(true)
      expect(textOf(rejected)).toContain('preferCSSPageSize')
    }
    await expect(appWindow.evaluate(`window.hronaut.savePdf(${JSON.stringify({ tabId: tinyTab, filename: 'invalid.pdf', preferCSSPageSize: 'yes' })})`))
      .rejects.toThrow('Invalid PDF options')
    expect(await savedPdfs()).toEqual([...before, 'tiny.pdf'].sort())

    // The human shell export takes the same option for a tab in the background.
    const shellUrl = `${origin}/a4-landscape?shell`
    const shellState = await appWindow.evaluate(`window.hronaut.newTab(${JSON.stringify({ url: shellUrl, active: false })})`) as { tabs: Array<{ id: string; url: string }> }
    const shellTab = shellState.tabs.find(tab => tab.url === shellUrl)!.id
    await waitForPage(shellUrl)
    const shellSaved = await appWindow.evaluate(`window.hronaut.savePdf(${JSON.stringify({ tabId: shellTab, filename: 'shell.pdf', preferCSSPageSize: true })})`) as { path: string }
    expectPages(pageSizes(await readFile(shellSaved.path)), [A4_LANDSCAPE, A4_LANDSCAPE])
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
