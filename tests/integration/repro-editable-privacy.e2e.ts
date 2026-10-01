import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserReproRecording, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const marker = /draft-(direct|nested|plain|mixed|label|native)-canary/
function text(result: CallToolResult): string {
  expect(result.isError).not.toBe(true)
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}

test('excludes editable drafts from real Repro labels, timeline, MCP and reviewed incident exports', async ({ appWindow, electronApp, mcpPort, mcpToken, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Repro editable privacy</title>
      <div id="direct" contenteditable="true">draft-direct-canary</div>
      <div contenteditable="true"><span id="nested" tabindex="0">draft-nested-canary</span></div>
      <div id="plain" contenteditable="plaintext-only">draft-plain-canary</div>
      <section id="mixed" tabindex="0">${' '.repeat(200)}Public heading <span contenteditable="true">draft-mixed-canary</span> Public ending</section>
      <label for="native">${' '.repeat(200)}Public account <span contenteditable="plaintext-only">draft-label-canary</span></label>
      <input id="native" value="draft-native-canary" placeholder="Public placeholder">
      <textarea id="textarea" placeholder="Public notes">draft-native-canary</textarea>
      <select id="select" aria-label="Public choice"><option>draft-native-canary</option></select>
      <button id="public">Public action</button>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'repro-editable-privacy', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Repro editable privacy', false)
    const opened = JSON.parse(text(await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult)) as { activeTabId: string }
    const tabId = opened.activeTabId
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId), tabId)
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#direct')).toBeVisible()
    const original = await page.locator('body').innerHTML()
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    const selectors = ['#direct', '#nested', '#plain', '#mixed', '#native', '#textarea', '#select', '#public']
    for (const [index, selector] of selectors.entries()) {
      // Native key events reach the human recorder; no DOM editing is needed to
      // prove that existing draft text is incorrectly collected as target names.
      await electronApp.evaluate(async ({ webContents }, { url, selector }) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        await contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).focus()`)
        contents.focus()
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
      }, { url, selector })
      await expect.poll(() => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId).then(r => r.steps.filter(s => s.kind === 'input').length), tabId)).toBe(index + 1)
    }
    const recording = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    expect.soft(JSON.stringify(recording.steps)).not.toMatch(marker)
    expect(recording.steps.filter(s => s.kind === 'input').every(s => s.valueRedacted)).toBe(true)
    for (const step of recording.steps.filter(s => s.target)) await expect(page.locator(`css:light=${step.target!.selector}`)).toHaveCount(1)
    expect.soft(recording.steps.map(s => s.target?.label)).toEqual(expect.arrayContaining(['Public heading Public ending', 'Public account', 'Public notes', 'Public choice', 'Public action']))
    const json = text(await client.callTool({ name: 'browser_repro', arguments: { tabId, action: 'get', format: 'json' } }) as CallToolResult)
    expect.soft(json).not.toMatch(marker)
    expect((JSON.parse(json) as BrowserReproRecording).steps).toEqual(recording.steps)
    const playwright = text(await client.callTool({ name: 'browser_repro', arguments: { tabId, action: 'get', format: 'playwright' } }) as CallToolResult)
    expect.soft(playwright).not.toMatch(marker)
    expect(playwright).toContain('HRONAUT_REPRO_INPUT_')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /Repro recorder:/ }).click()
    const timeline = appWindow.getByRole('dialog', { name: 'Repro recorder' })
    await expect(timeline.getByRole('listbox', { name: 'Recorded reproduction steps' }).getByRole('option')).toHaveCount(recording.stepCount)
    expect.soft(await timeline.innerText()).not.toMatch(marker)
    await timeline.getByRole('button', { name: 'Close repro recorder', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Create debug report' }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Debug report' })
    await panel.getByText('Reviewed incident package', { exact: true }).click()
    await panel.getByRole('checkbox', { name: 'Repro steps', exact: true }).check()
    await panel.getByRole('button', { name: 'Capture selected evidence' }).click()
    await panel.getByRole('button', { name: 'Preview exact package' }).click()
    const iframe = panel.locator('iframe[title="Preview exact package"]')
    await expect(iframe).toBeVisible()
    const preview = await iframe.getAttribute('srcdoc')
    expect.soft(preview).not.toMatch(marker)
    expect(preview).toContain('Public action')
    await panel.getByRole('checkbox', { name: /I reviewed this package/ }).check()
    const destination = join(profileDirectory, 'repro-privacy-incident.html')
    await electronApp.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, destination)
    await panel.getByRole('button', { name: 'Save reviewed HTML' }).click()
    await expect(panel.getByRole('status')).toHaveText('Reviewed package saved locally.')
    const saved = await readFile(destination, 'utf8')
    expect(saved).toBe(preview)
    expect.soft(saved).not.toMatch(marker)
    expect(await page.locator('body').innerHTML()).toBe(original)
    expect(await page.locator('#native').inputValue()).toBe('draft-native-canary')
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
