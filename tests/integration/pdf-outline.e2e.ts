import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { countBookmarks, pageSizes, readOutline } from './pdf-structure.js'

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const longHeading = `Λόγος 🚀 ${'chapter words '.repeat(40).trim()}`
const pages: Record<string, string> = {
  '/outline': `<!doctype html><html lang="en"><meta charset="utf-8"><title>Outline fixture</title>
    <style>section { break-after: page } @media print { .screen-only { display: none } }</style>
    <section><h1>Intro — café 東京</h1><p>One</p><h2>Setup (Linux) \\ notes</h2><p>Two</p><img width="40" height="40" alt="Setup diagram" src="data:image/png;base64,${PIXEL}"><h2 class="screen-only">Screen only</h2></section>
    <section><h1>Second chapter</h1><h2 aria-label="Authored label">Visible words</h2><h3>Deep</h3><h2 hidden>Hidden attribute</h2>
      <h2 style="visibility: hidden">Invisible</h2><h2 aria-label="Label only"></h2><h2 aria-hidden="true">Hidden from assistive technology</h2>
      <details><summary>More</summary><h2>Inside closed details</h2></details></section>
    <section><h1>${longHeading}</h1><h3>Skipped level</h3><div role="heading" aria-level="2">Role heading</div><p>End</p></section>`,
  '/plain': '<!doctype html><meta charset="utf-8"><title>No headings</title><p>Only a paragraph.</p>',
  '/many': `<!doctype html><meta charset="utf-8"><title>Many headings</title>${Array.from({ length: 300 }, (_, index) => {
    const level = 1 + (index % 3)
    return `<h${level}>Heading ${index}</h${level}><p>Paragraph ${index}</p>`
  }).join('')}`
}

test('adds heading bookmarks to a PDF export only when asked', async ({ appWindow, electronApp, mcpPort, mcpToken, profileDirectory }) => {
  // About a dozen exports, one with 300 tagged headings, took 31 s with startup in the pinned Docker image.
  test.slow()
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(pages[new URL(request.url ?? '/', 'http://fixture').pathname] ?? pages['/plain'])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'pdf-outline', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const textOf = (result: CallToolResult) => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const parsed = (result: CallToolResult) => {
    expect(result.isError, textOf(result)).not.toBe(true)
    return JSON.parse(textOf(result))
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const { id: workspaceId } = parsed(await call('browser_workspaces', { action: 'create', name: 'PDF outline', storage: 'scratch' })) as { id: string }
    const openPage = async (path: string): Promise<string> => {
      const url = `${origin}${path}`
      const state = parsed(await call('browser_new_tab', { workspaceId, url })) as { tabs: Array<{ id: string; url: string }> }
      const tabId = state.tabs.find(tab => tab.url === url)?.id
      expect(tabId).toBeTruthy()
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, target) => {
        const contents = webContents.getAllWebContents().find(page => page.getURL() === target)
        return contents && !contents.isLoading() ? contents.executeJavaScript('document.readyState') : null
      }, url)).toBe('complete')
      return tabId!
    }
    const save = async (args: Record<string, unknown>) => {
      const result = await call('browser_pdf_save', { workspaceId, ...args })
      const saved = parsed(result) as { filename: string; path: string; bytes: number }
      // Results stay file metadata; heading text never leaves the PDF.
      expect(Object.keys(saved).sort()).toEqual(['bytes', 'filename', 'path'])
      expect(textOf(result)).not.toMatch(/café|chapter|Visible words|Heading \d/)
      const pdf = await readFile(saved.path)
      expect(pdf.length).toBe(saved.bytes)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdf.subarray(-8).toString('latin1')).toContain('%%EOF')
      return pdf
    }

    const outlineTab = await openPage('/outline')
    const outlined = await save({ tabId: outlineTab, filename: 'outline.pdf', outline: true })
    const bookmarks = readOutline(outlined)
    if (!bookmarks) throw new Error('The PDF has no outline')
    expect(pageSizes(outlined)).toHaveLength(3)
    // Chromium keeps a long heading whole but can drop the space where its lines wrap.
    expect(bookmarks[2]!.title.replace(/\s+/g, '')).toBe(longHeading.replace(/\s+/g, ''))
    bookmarks[2]!.title = longHeading
    // Print-hidden, hidden, invisible, aria-hidden, closed-details and label-only headings are left out; visible text
    // wins over aria-label, and a skipped level nests under the nearest higher heading.
    expect(bookmarks).toEqual([
      { title: 'Intro — café 東京', page: 1, children: [{ title: 'Setup (Linux) \\ notes', page: 1, children: [] }] },
      { title: 'Second chapter', page: 2, children: [
        { title: 'Visible words', page: 2, children: [{ title: 'Deep', page: 2, children: [] }] }
      ] },
      { title: longHeading, page: 3, children: [
        { title: 'Skipped level', page: 3, children: [] },
        { title: 'Role heading', page: 3, children: [] }
      ] }
    ])
    expect(outlined.toString('latin1')).toContain('/StructTreeRoot')
    expect(outlined.toString('latin1')).toContain('/Lang (en)')
    // Tagging also writes image alt text into the file, which REFERENCE.md warns about.
    expect(outlined.toString('latin1')).toContain('/Alt (Setup diagram)')

    // Omitted or false keeps today's untagged export without bookmarks.
    for (const outline of [undefined, false]) {
      const plain = await save({ tabId: outlineTab, filename: 'plain.pdf', ...(outline === undefined ? {} : { outline }) })
      expect(readOutline(plain)).toBeNull()
      expect(plain.toString('latin1')).not.toContain('/StructTreeRoot')
      expect(pageSizes(plain)).toEqual(Array(3).fill({ width: 612, height: 792 }))
    }

    for (const [options, size] of [
      [{ landscape: true, pageSize: 'A4' }, { width: 842, height: 595 }],
      [{ pageSize: 'Legal' }, { width: 612, height: 1008 }]
    ] as const) {
      const pdf = await save({ tabId: outlineTab, filename: 'paper.pdf', outline: true, ...options })
      expect(pageSizes(pdf), JSON.stringify(options)).toHaveLength(3)
      for (const page of pageSizes(pdf)) {
        expect(Math.abs(page.width - size.width), JSON.stringify(options)).toBeLessThanOrEqual(2)
        expect(Math.abs(page.height - size.height), JSON.stringify(options)).toBeLessThanOrEqual(2)
      }
      expect(readOutline(pdf)!.map(bookmark => bookmark.title).slice(0, 2)).toEqual(['Intro — café 東京', 'Second chapter'])
    }

    const before = (await readdir(profileDirectory)).filter(name => name.endsWith('.pdf')).sort()
    for (const outline of ['yes', 1, null]) {
      const rejected = await call('browser_pdf_save', { workspaceId, tabId: outlineTab, filename: 'invalid.pdf', outline })
      expect(rejected.isError, textOf(rejected)).toBe(true)
      expect(textOf(rejected)).toContain('outline')
    }
    await expect(appWindow.evaluate(`window.hronaut.savePdf(${JSON.stringify({ tabId: outlineTab, filename: 'invalid.pdf', outline: 'yes' })})`))
      .rejects.toThrow('Invalid PDF options')
    expect((await readdir(profileDirectory)).filter(name => name.endsWith('.pdf')).sort()).toEqual(before)

    // A page without headings gets no bookmarks, though the PDF is still tagged.
    const plainTab = await openPage('/plain')
    const noHeadings = await save({ tabId: plainTab, filename: 'no-headings.pdf', outline: true })
    expect(readOutline(noHeadings)).toBeNull()
    expect(noHeadings.toString('latin1')).toContain('/StructTreeRoot')
    expect(pageSizes(noHeadings)).toEqual([{ width: 612, height: 792 }])

    const manyTab = await openPage('/many')
    const started = performance.now()
    const many = await save({ tabId: manyTab, filename: 'many.pdf', outline: true })
    const outlineMs = Math.round(performance.now() - started)
    const manyBookmarks = readOutline(many)!
    expect(countBookmarks(manyBookmarks)).toBe(300)
    expect(manyBookmarks[0]).toMatchObject({ title: 'Heading 0', page: 1, children: [{ title: 'Heading 1', children: [{ title: 'Heading 2' }] }] })
    expect(manyBookmarks.at(-1)!.title).toBe('Heading 297')
    const plainStarted = performance.now()
    const manyPlain = await save({ tabId: manyTab, filename: 'many-plain.pdf' })
    test.info().annotations.push({
      type: 'pdf-outline-cost',
      description: `300 headings: ${many.length} bytes in ${outlineMs} ms with outline, ${manyPlain.length} bytes in ${Math.round(performance.now() - plainStarted)} ms without`
    })

    // The human shell export takes the same option for a tab in the background.
    const shellUrl = `${origin}/outline?shell`
    const shellState = await appWindow.evaluate(`window.hronaut.newTab(${JSON.stringify({ url: shellUrl, active: false })})`) as { tabs: Array<{ id: string; url: string }> }
    const shellTab = shellState.tabs.find(tab => tab.url === shellUrl)!.id
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(page => page.getURL() === target)
      return contents && !contents.isLoading() ? contents.executeJavaScript('document.readyState') : null
    }, shellUrl)).toBe('complete')
    const shellSaved = await appWindow.evaluate(`window.hronaut.savePdf(${JSON.stringify({ tabId: shellTab, filename: 'shell.pdf', outline: true })})`) as { path: string }
    const shellTitles = readOutline(await readFile(shellSaved.path))!.map(bookmark => bookmark.title)
    expect(shellTitles).toHaveLength(3)
    expect(shellTitles.slice(0, 2)).toEqual(['Intro — café 東京', 'Second chapter'])
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
