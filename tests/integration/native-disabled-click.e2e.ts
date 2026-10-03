import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

const modes = {
  ordinary: {},
  dialog: { dialogAction: 'accept' },
  native: { native: true },
  double: { doubleClick: true }
} as const

for (const [mode, options] of Object.entries(modes)) {
  for (const targetKind of ['selector', 'ref'] as const) {
    test(`semantic click checks live native-disabled controls: ${mode} ${targetKind}`, async ({
      appWindow, electronApp, mcpPort, mcpToken
    }, testInfo) => {
      const client = new Client({ name: 'native-disabled-click', version: '1' })
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args }) as CallToolResult
        return { error: result.isError === true, text: result.content.filter(part => part.type === 'text').map(part => part.text).join('\n') }
      }
      const ok = async (name: string, args: Record<string, unknown>) => {
        const result = await call(name, args)
        expect(result.error, result.text).toBe(false)
        return result.text
      }
      const observations: unknown[] = []
      try {
        await expect.poll(async () => {
          try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
        }).toBe(true)
        await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
        }))
        const workspace = JSON.parse(await ok('browser_workspaces', { action: 'create', name: 'Native disabled fixture', storage: 'scratch' })) as { id: string; resumeKey: string }
        const html = `<!doctype html><title>Native disabled fixture</title>
          <button id="disabled" disabled>Disabled submit</button>
          <input id="input" disabled aria-label="Disabled input">
          <select id="select" disabled aria-label="Disabled select"><option>One</option></select>
          <textarea id="textarea" disabled aria-label="Disabled textarea"></textarea>
          <fieldset disabled id="fieldset"><legend><button id="legend">First legend</button></legend>
            <button id="inherited">Inherited disabled</button>
            <legend><button id="secondLegend">Second legend</button></legend>
          </fieldset>
          <button id="late">Later disabled</button>
          <button id="focusDisabled" onfocus="this.disabled = true">Disable on focus</button>
          <div id="aria" role="button" tabindex="0" aria-disabled="true">ARIA-only custom control</div>
          <script>
            window.clickCounts = {};
            for (const element of document.querySelectorAll('button,input,select,textarea,[role=button]')) {
              element.addEventListener('click', () => { clickCounts[element.id] = (clickCounts[element.id] || 0) + 1; });
            }
            document.querySelector('#late').addEventListener('click', () => {
              ${mode === 'dialog' ? 'window.dialogResult = confirm("Synthetic submit");' : ''}
            });
          </script>`
        const url = `data:text/html,${encodeURIComponent(html)}`
        const state = JSON.parse(await ok('browser_new_tab', { workspaceId: workspace.id, url, active: true })) as BrowserState
        const args = { workspaceId: workspace.id, tabId: state.activeTabId }
        await ok('browser_wait', { ...args, selector: '#disabled' })
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id!), state.activeTabId)
        const page = electronApp.context().pages().find(page => page.url() === url)!
        const snapshot = await ok('browser_snapshot', args)
        expect(snapshot).toContain('Disabled submit')
        for (const label of ['Disabled submit', 'Disabled input', 'Disabled select', 'Disabled textarea', 'Inherited disabled', 'Second legend']) {
          expect(snapshot.split('\n').find(line => line.includes(JSON.stringify(label))), label).toMatch(/ disabled$/)
        }
        for (const label of ['First legend', 'ARIA-only custom control']) {
          expect(snapshot.split('\n').find(line => line.includes(JSON.stringify(label))), label).not.toMatch(/ disabled$/)
        }
        const refs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id][data-hronaut-ref]')]
          .map(element => [element.id, element.getAttribute('data-hronaut-ref')!])))
        const target = (id: string) => {
          if (targetKind === 'selector') return { selector: `#${id}` }
          expect(refs[id], id).toMatch(/^e\d+$/)
          return { ref: refs[id] }
        }
        const count = (id: string) => page.evaluate(id => (window as unknown as { clickCounts: Record<string, number> }).clickCounts[id] || 0, id)
        const rejected = async (id: string) => {
          const result = await call('browser_click', { ...args, ...options, ...target(id) })
          const clicks = await count(id)
          observations.push({ id, result, clicks })
          expect.soft(clicks, id).toBe(0)
          expect.soft(result.error, `${id}: ${result.text}`).toBe(true)
          expect.soft(result.text, id).toContain('disabled')
        }
        for (const id of ['disabled', 'input', 'select', 'textarea', 'inherited', 'secondLegend']) await rejected(id)
        await page.evaluate(() => { (document.querySelector('#late') as HTMLButtonElement).disabled = true })
        await rejected('late') // Keep the ref captured before the live state changed.
        if (mode === 'ordinary' || mode === 'dialog') await rejected('focusDisabled')
        const expectedClicks = mode === 'double' ? 2 : 1
        for (const id of ['legend', 'aria']) {
          const result = await call('browser_click', { ...args, ...options, ...target(id) })
          expect(result.error, result.text).toBe(false)
          expect(await count(id)).toBe(expectedClicks)
        }
        await page.evaluate(() => { (document.querySelector('#late') as HTMLButtonElement).disabled = false })
        await ok('browser_snapshot', args)
        refs.late = await page.locator('#late').getAttribute('data-hronaut-ref') as string
        const enabled = await call('browser_click', { ...args, ...options, ...target('late') })
        expect(enabled.error, enabled.text).toBe(false)
        expect(JSON.parse(enabled.text)).toMatchObject({ ok: true, tag: 'button' })
        expect(await count('late')).toBe(expectedClicks)
        if (mode === 'dialog') expect(await page.evaluate('window.dialogResult')).toBe(true)
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id!, true), state.activeTabId)
        const paused = await call('browser_click', { ...args, ...options, ...target('late') })
        expect(paused.error).toBe(true)
        expect(paused.text).toContain('paused')
        expect(await count('late')).toBe(expectedClicks)
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id!, false), state.activeTabId)
        const foreign = new Client({ name: 'foreign-disabled-click', version: '1' })
        try {
          await foreign.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
          }))
          const denied = await foreign.callTool({ name: 'browser_click', arguments: { ...args, ...options, ...target('late') } }) as CallToolResult
          expect(denied.isError).toBe(true)
          expect(denied.content.filter(part => part.type === 'text').map(part => part.text).join(' ')).toContain('not authorized')
          expect(await count('late')).toBe(expectedClicks)
        } finally { await foreign.close() }
        // Credentials exist only in this disposable fixture profile.
        const profile = await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi })
          .hronautSettings.createMcpCapabilityProfile({ name: 'Read-only click fixture', preset: 'read-only' }))
        const restricted = new Client({ name: 'restricted-disabled-click', version: '1' })
        try {
          await restricted.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${profile.credential}` } }
          }))
          await ok('browser_workspaces', { action: 'release-ownership', workspaceId: workspace.id })
          const resumed = await restricted.callTool({ name: 'browser_workspaces', arguments: { action: 'resume', workspaceId: workspace.id, resumeKey: workspace.resumeKey } }) as CallToolResult
          expect(resumed.isError).not.toBe(true)
          const denied = await restricted.callTool({ name: 'browser_click', arguments: { ...args, ...options, ...target('late') } }) as CallToolResult
          expect(denied.isError).toBe(true)
          expect((await restricted.listTools()).tools.map(tool => tool.name)).not.toContain('browser_click')
          expect(await count('late')).toBe(expectedClicks)
        } finally { await restricted.close() }
      } finally {
        await testInfo.attach('native-disabled-results', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
        await client.close()
      }
    })
  }
}
