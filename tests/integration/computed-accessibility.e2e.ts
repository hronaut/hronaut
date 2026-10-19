import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
import type { ComputedAccessibilityReport } from '../../src/shared/computed-accessibility.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

// The private text is assembled by script at load, so it is in no response body or cache entry.
const PAGE = `<!doctype html><title>Semantics</title>
<label id="qty-label" for="qty">Quantity</label><input id="qty" type="number" value="4">
<select id="fruits" multiple aria-label="Fruits"><option selected>Apple</option><option>Pear</option><option selected>Plum</option></select>
<button id="menu" aria-expanded="true" aria-controls="panel">Menu</button><div id="panel">Panel</div>
<div role="tablist"><div id="tab" role="tab" aria-selected="true" tabindex="0">Overview</div></div>
<button id="bold" aria-pressed="true">Bold</button>
<label id="note-label">Note</label><input id="note" type="text" aria-labelledby="note-label" required readonly>
<input id="secret" type="password" aria-label="Password">
<div id="editor" contenteditable="true" role="textbox" aria-label="Editor" aria-describedby="hint"></div><span id="hint"></span>
<div aria-hidden="true"><button id="hidden">Hidden</button></div>
<div inert><button id="inert">Inert</button></div>
<button id="unrendered" style="display:none">Unrendered</button>
<input id="agree" type="checkbox" checked>
<button id="large"></button>
<div id="closed" role="button"></div>
<script>
window.canary = ['private', 'semantics', crypto.randomUUID()].join('-')
document.getElementById('qty-label').append(' ' + canary)
document.getElementById('note').value = canary
document.getElementById('secret').value = canary
document.getElementById('editor').textContent = canary
document.getElementById('hint').textContent = canary
document.getElementById('large').textContent = canary + 'x'.repeat(150000)
document.getElementById('closed').attachShadow({ mode: 'closed' }).textContent = canary + 'y'.repeat(150000)
</script>`

async function site(): Promise<{ server: Server; pageUrl: string }> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.setHeader('cache-control', 'no-store')
    response.end(PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, pageUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/form` }
}

/** Runs page code from the main process, outside Hronaut's debugger session. */
function run(electronApp: ElectronApplication, pageUrl: string, script: string): Promise<unknown> {
  return electronApp.evaluate(({ webContents }, { pageUrl, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    return page.mainFrame.executeJavaScript(script)
  }, { pageUrl, script })
}

/** Accessibility events Hronaut's debugger session sends after the page changes: none once the domain is off. */
function accessibilityEventsAfterChange(electronApp: ElectronApplication, pageUrl: string): Promise<string[]> {
  return electronApp.evaluate(async ({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    const events: string[] = []
    const listener = (_event: unknown, method: string): void => { if (method.startsWith('Accessibility.')) events.push(method) }
    page.debugger.on('message', listener)
    try {
      await page.mainFrame.executeJavaScript('document.body.append(Object.assign(document.createElement("button"), { textContent: "Late" })); true')
      await new Promise(resolve => setTimeout(resolve, 500))
      return events
    } finally {
      page.debugger.removeListener('message', listener)
    }
  }, pageUrl)
}

/** Every file under the profile that contains the text, read up to 32 MB each. */
async function filesContaining(directory: string, needle: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const size = (await stat(path).catch(() => undefined))?.size
    if (size === undefined || size > 32 * 1024 * 1024) continue
    const content = await readFile(path).catch(() => undefined)
    if (content?.includes(needle)) found.push(path)
  }
  return found
}

async function read(client: Client, tabId: string, selector: string): Promise<ComputedAccessibilityReport> {
  const result = await call(client, 'browser_computed_accessibility', { tabId, selector })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as ComputedAccessibilityReport
}

test('reports Chromium\'s roles, ignored reasons and states without the page\'s text', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await site()
  try {
    const navigated = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const canary = await run(electronApp, pageUrl, 'window.canary') as string
    expect(canary).toMatch(/^private-semantics-/)

    const outputs: string[] = []
    const report = async (selector: string): Promise<ComputedAccessibilityReport> => {
      const result = await read(client, tabId, selector)
      outputs.push(JSON.stringify(result))
      return result
    }
    const quantity = await report('#qty')
    expect(quantity).toMatchObject({ source: 'chromium-accessibility-tree', role: 'spinbutton', ignored: false, ignoredReasons: [] })
    expect(quantity.chromium).toMatch(/^\d+\./)
    expect((await report('#fruits'))).toMatchObject({ role: 'listbox', states: { multiselectable: true } })
    expect((await report('#menu'))).toMatchObject({ role: 'button', states: { expanded: true } })
    expect((await report('#tab'))).toMatchObject({ role: 'tab', states: { selected: true } })
    expect((await report('#bold'))).toMatchObject({ role: 'button', states: { pressed: true } })
    expect((await report('#note'))).toMatchObject({ role: 'textbox', states: { required: true, readonly: true } })
    expect((await report('#secret'))).toMatchObject({ role: 'textbox', states: { required: false } })
    expect((await report('#editor'))).toMatchObject({ role: 'textbox', states: { editable: 'richtext' } })
    expect((await report('#hidden'))).toMatchObject({ ignored: true, ignoredReasons: ['ariaHiddenSubtree'] })
    expect((await report('#inert'))).toMatchObject({ ignored: true, ignoredReasons: ['inertElement'] })
    expect((await report('#unrendered'))).toMatchObject({ ignored: true, ignoredReasons: ['notRendered'] })
    const agree = await report('#agree')
    expect(agree).toMatchObject({ role: 'checkbox', states: { checked: true } })
    expect(agree.notReported).toContain('expanded')
    expect(agree.states).not.toHaveProperty('expanded')

    // Hronaut's own heuristics still say textbox and combobox; this report leaves them as they are.
    const inspected = await call(client, 'browser_element_inspect', { tabId, selector: '#qty' })
    expect(inspected.isError, text(inspected)).not.toBe(true)
    expect(text(inspected)).not.toContain('spinbutton')

    for (const output of outputs) expect(output).not.toContain(canary)
    const logs = await call(client, 'browser_diagnostic_logs', { tabId })
    expect(text(logs)).not.toContain(canary)
    expect(await accessibilityEventsAfterChange(electronApp, pageUrl)).toEqual([])
    // The control: the scan does find what Hronaut keeps about the page, such as its address.
    await expect.poll(() => filesContaining(profileDirectory, pageUrl), { timeout: 10_000 }).not.toEqual([])
    expect(await filesContaining(profileDirectory, canary)).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})

test('refuses elements with too much text, also when the text sits in a closed shadow root', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await site()
  try {
    const navigated = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const canary = await run(electronApp, pageUrl, 'window.canary') as string

    const large = await call(client, 'browser_computed_accessibility', { tabId, selector: '#large' })
    expect(large.isError).toBe(true)
    expect(text(large)).toContain('exceed 100,000 characters')
    const closed = await call(client, 'browser_computed_accessibility', { tabId, selector: '#closed' })
    expect(closed.isError).toBe(true)
    expect(text(closed)).toContain('closed shadow root')
    for (const output of [text(large), text(closed)]) expect(output).not.toContain(canary)

    const several = await call(client, 'browser_computed_accessibility', { tabId, selector: 'button' })
    expect(text(several)).toContain('more than one element')
    const both = await call(client, 'browser_computed_accessibility', { tabId, selector: '#qty', ref: 'e1' })
    expect(text(both)).toContain('exactly one of ref or selector')

    // A refused read leaves the page's tools working.
    expect((await read(client, tabId, '#menu')).states).toMatchObject({ expanded: true })
    expect(await accessibilityEventsAfterChange(electronApp, pageUrl)).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})
