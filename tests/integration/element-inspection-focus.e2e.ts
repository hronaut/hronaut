import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserElementInspection, BrowserState, HronautApi } from '../../src/shared/types.js'
import { formatElementInspectionForAgent } from '../../src/shared/element-inspection.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

test('observes keyboard focus and restoration without changing the page or exposing editable values', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Focus observation fixture</title>
      <button id="modalopener">Open modal</button><button id="other">Other action</button>
      <dialog id="modal"><input id="first" aria-label="Name"><button id="last">Last action</button></dialog>
      <button id="popopener">Open non-modal</button><div id="popover" role="dialog" hidden><button id="popfirst">First popover action</button><button id="poplast">Last popover action</button></div><button id="after">After popover</button>
      <section id="secrets"><input id="plain" aria-label="Public input"><input id="password" type="password" aria-label="Public password"><div id="editor" contenteditable="true" role="textbox" aria-label="Public editor">private-editable-canary</div></section>
      <div id="openhost"></div><div id="closedhost"></div><iframe id="frame" title="Focus frame" srcdoc='<input id="inside" aria-label="Frame input">'></iframe>
      <script>
        window.broken = true;
        modalopener.onclick = () => modal.showModal();
        modal.addEventListener('close', () => (window.broken ? other : modalopener).focus());
        popopener.onclick = () => { popover.hidden = false; popfirst.focus(); };
        popover.onkeydown = event => { if (event.key === 'Escape') { popover.hidden = true; (window.broken ? other : popopener).focus(); } };
        plain.value = 'private-input-canary'; password.value = 'private-password-canary';
        openhost.attachShadow({mode:'open'}).innerHTML = '<input aria-label="Shadow input">';
        const closed = closedhost.attachShadow({mode:'closed'}); closed.innerHTML = '<input aria-label="Closed shadow input">';
        window.focusClosed = () => closed.querySelector('input').focus();
      </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  let humanWindowId: number | undefined
  const client = new Client({ name: 'focus-inspection', version: '1' })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Focus inspection', false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return result
    }
    const opened = JSON.parse(text(await call('browser_new_tab', { url, active: true }))) as BrowserState
    const tabId = opened.activeTabId!
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#modalopener')).toBeVisible()
    await expect.poll(() => page.locator('#frame').evaluate((frame: HTMLIFrameElement) => Boolean(frame.contentDocument?.querySelector('input')))).toBe(true)
    const observe = async (selector: string) => {
      const before = await page.evaluate(() => ({ active: document.activeElement?.id, html: document.body.innerHTML, scroll: [scrollX, scrollY] }))
      const selected = await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')
      const foreground = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null)
      const report = JSON.parse(text(await call('browser_element_inspect', { tabId, selector }))) as BrowserElementInspection
      expect(JSON.stringify(report)).not.toMatch(/private-(input|password|editable)-canary/)
      expect(formatElementInspectionForAgent(report)).not.toMatch(/private-(input|password|editable)-canary/)
      expect(await page.evaluate(() => ({ active: document.activeElement?.id, html: document.body.innerHTML, scroll: [scrollX, scrollY] }))).toEqual(before)
      expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(selected)
      expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null)).toBe(foreground)
      return report
    }
    // Chromium retargets shadow focus to hosts but does not propagate iframe focus.
    for (const target of ['openhost', 'closedhost', 'frame']) {
      await page.evaluate(target => {
        const element = document.getElementById(target)!
        if (target === 'openhost') element.shadowRoot!.querySelector<HTMLInputElement>('input')!.focus()
        else if (target === 'closedhost') (window as unknown as { focusClosed(): void }).focusClosed()
        else (element as HTMLIFrameElement).contentDocument!.querySelector<HTMLInputElement>('input')!.focus()
      }, target)
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(target)
      expect((await observe(`#${target}`)).accessibility).toMatchObject({ focused: target !== 'frame', focusWithin: target !== 'frame' })
    }
    for (const selector of ['#openhost input', '#closedhost input', '#frame input']) {
      const result = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector } }) as CallToolResult
      expect(result.isError).toBe(true)
    }
    const press = (key: string) => call('browser_press', { tabId, key })
    for (const broken of [true, false]) {
      await page.evaluate(broken => { (window as unknown as { broken: boolean }).broken = broken }, broken)
      await page.locator('#modalopener').click()
      await expect(page.locator('#first')).toBeFocused()
      expect((await observe('#first')).accessibility).toMatchObject({ focused: true, focusWithin: true, focusable: true })
      expect((await observe('#modal')).accessibility).toMatchObject({ focused: false, focusWithin: true })
      expect((await observe('#last')).accessibility).toMatchObject({ focused: false, focusWithin: false, focusable: true })
      await press('Tab')
      await expect(page.locator('#last')).toBeFocused()
      expect((await observe('#last')).accessibility).toMatchObject({ focused: true, focusWithin: true })
      await press('Shift+Tab')
      await expect(page.locator('#first')).toBeFocused()
      await press('Escape')
      await expect(page.locator(broken ? '#other' : '#modalopener')).toBeFocused()
      expect((await observe('#modalopener')).accessibility).toMatchObject({ focused: !broken, focusWithin: !broken })
      await page.locator('#popopener').click()
      await expect(page.locator('#popfirst')).toBeFocused()
      expect((await observe('#popover')).accessibility).toMatchObject({ focused: false, focusWithin: true })
      await press('Tab')
      await expect(page.locator('#poplast')).toBeFocused()
      await press('Tab')
      await expect(page.locator('#after')).toBeFocused()
      expect((await observe('#popover')).accessibility).toMatchObject({ focused: false, focusWithin: false })
      await press('Shift+Tab')
      await expect(page.locator('#poplast')).toBeFocused()
      await press('Escape')
      await expect(page.locator(broken ? '#other' : '#popopener')).toBeFocused()
      expect((await observe('#popopener')).accessibility).toMatchObject({ focused: !broken, focusWithin: !broken })
    }
    for (const selector of ['#plain', '#password', '#editor']) {
      await page.locator(selector).focus()
      const report = await observe(selector)
      expect(report.accessibility).toMatchObject({ focused: true, focusWithin: true })
      expect(formatElementInspectionForAgent(report)).toContain('focused=true; focusWithin=true')
      expect((await observe('#secrets')).accessibility).toMatchObject({ focused: false, focusWithin: true })
    }
    await call('browser_snapshot', { tabId })
    const ref = await page.locator('#plain').getAttribute('data-hronaut-ref')
    expect(ref).toMatch(/^e\d+$/)
    await page.locator('#plain').focus()
    const byRef = JSON.parse(text(await call('browser_element_inspect', { tabId, ref }))) as BrowserElementInspection
    expect(byRef.accessibility).toMatchObject({ focused: true, focusWithin: true })
    await page.locator('#plain').evaluate(element => element.remove())
    expect((await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, ref } }) as CallToolResult).isError).toBe(true)

    const other = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
    expect(other.activeTabId).not.toBe(tabId)
    humanWindowId = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const human = new BrowserWindow({ width: 320, height: 200, show: false })
      await human.loadURL('data:text/html,<title>Human foreground</title><input autofocus>')
      human.show()
      human.focus()
      return human.id
    })
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanWindowId)
    await observe('#password')
  } finally {
    if (humanWindowId !== undefined) await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), humanWindowId).catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
