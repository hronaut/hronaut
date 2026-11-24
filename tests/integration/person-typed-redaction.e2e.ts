import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

// The person takes a sign-in page over from its agent, types an email and a password, pastes a search, signs in and
// hands the page back. What they entered then shows in the page, its address, a request body, the console and the
// page's storage, and the agent reads [redacted] in its place in each, while another workspace reads its own text.

const EMAIL = 'person-typed@example.test'
const PASSWORD = 'Hunter2-Secret!'
const PASTED = 'pasted-canary-4271'
const ASKED = 'attention-pasted-5512'
const formEncoded = (value: string): string => new URLSearchParams([['', value]]).toString().slice(1)
const SECRETS = [EMAIL, PASSWORD, PASTED, encodeURIComponent(EMAIL), encodeURIComponent(PASSWORD), formEncoded(EMAIL), formEncoded(PASSWORD)]

const PAGE = `<!doctype html><title>Sign in fixture</title>
<form id="form"><input id="email" name="email" autocomplete="username"><input id="password" type="password" name="password"
autocomplete="current-password"><input id="search" name="q"><button>Sign in</button></form><p id="welcome"></p>
<script>
form.onsubmit = async (event) => {
  event.preventDefault()
  console.log('Signing in ' + email.value)
  localStorage.setItem('account', email.value)
  history.replaceState(null, '', '/?q=' + encodeURIComponent(search.value))
  const answer = await fetch('/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.value, password: password.value }) })
  welcome.textContent = 'Welcome, ' + (await answer.json()).account
  await fetch('/audit', { method: 'POST', body: new URLSearchParams({ email: email.value, password: password.value }) })
}
</script>`

/** Keys and text the person gives the page shown in the window, which reach main as native page input. */
async function personInput(electronApp: ElectronApplication, tabUrl: string, input: { focus?: string; selectAll?: boolean; type?: string; key?: string; paste?: string }): Promise<void> {
  await electronApp.evaluate(async ({ BrowserWindow, WebContentsView, clipboard }, { tabUrl, input }) => {
    // The page in view, not a tab restored from an earlier run of this profile whose port came back.
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL().startsWith(tabUrl)
    )) as Electron.WebContentsView | undefined
    if (!view) throw new Error('The page is not shown')
    const page = view.webContents
    page.focus()
    if (input.focus) await page.executeJavaScript(`document.getElementById(${JSON.stringify(input.focus)}).focus()`)
    if (input.selectAll) page.selectAll()
    for (const character of input.type ?? '') {
      page.sendInputEvent({ type: 'keyDown', keyCode: character })
      page.sendInputEvent({ type: 'char', keyCode: character })
      page.sendInputEvent({ type: 'keyUp', keyCode: character })
    }
    if (input.key) {
      page.sendInputEvent({ type: 'keyDown', keyCode: input.key })
      page.sendInputEvent({ type: 'char', keyCode: input.key })
      page.sendInputEvent({ type: 'keyUp', keyCode: input.key })
    }
    if (input.paste) {
      clipboard.writeText(input.paste)
      page.paste()
    }
  }, { tabUrl, input })
}

/** The welcome line of the page shown in the window, as the person sees it. */
async function shownWelcome(electronApp: ElectronApplication, tabUrl: string): Promise<unknown> {
  return electronApp.evaluate(({ BrowserWindow, WebContentsView }, tabUrl) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL().startsWith(tabUrl)
    )) as Electron.WebContentsView | undefined
    return view?.webContents.executeJavaScript('document.getElementById("welcome").textContent')
  }, tabUrl)
}

test('what the person typed while the page was theirs reaches the agent nowhere afterwards', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/login') {
      let body = ''
      request.on('data', (chunk) => { body += String(chunk) })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, account: (JSON.parse(body) as { email: string }).email }))
      })
      return
    }
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
  const client = new Client({ name: 'hronaut-typed-text-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const raw = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const textOf = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    const read = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await raw(name, args)
      expect(result.isError, `${name}: ${textOf(result)}`).not.toBe(true)
      const all = JSON.stringify(result)
      for (const secret of SECRETS) expect(all, `${name} must not show what the person typed`).not.toContain(secret)
      return textOf(result)
    }
    const json = <T>(text: string): T => JSON.parse(text) as T

    const workspaceId = json<{ id: string }>(await read('browser_workspaces', { action: 'create', name: 'Typed text' })).id
    const tabId = json<{ activeTabId: string }>(await read('browser_new_tab', { workspaceId, url: `${origin}/` })).activeTabId
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await read('browser_wait', { workspaceId, tabId, selector: '#email', state: 'visible' })

    // The person takes the page over and signs in.
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, true, { takeOver: true })`)
    await personInput(electronApp, origin, { focus: 'email', type: EMAIL })
    await personInput(electronApp, origin, { focus: 'password', type: PASSWORD })
    await personInput(electronApp, origin, { focus: 'search', paste: PASTED })
    await personInput(electronApp, origin, { key: 'Enter' })
    await expect.poll(() => shownWelcome(electronApp, origin)).toBe(`Welcome, ${EMAIL}`)
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, false)`)

    // The agent reads the page, its fields, address, console, requests and storage: [redacted] everywhere.
    expect(await read('browser_snapshot', { workspaceId, tabId })).toContain('Welcome, [redacted]')
    expect(await read('browser_evaluate', {
      workspaceId, tabId, script: '[email.value, password.value, search.value, localStorage.account, location.search].join(" | ")'
    })).toContain('[redacted] | [redacted] | [redacted] | [redacted] | ?q=[redacted]')
    expect(await read('browser_console', { workspaceId, tabId })).toContain('Signing in [redacted]')
    const requests = json<Array<{ id: string; url: string }>>(await read('browser_network', { workspaceId, tabId }))
    const login = requests.find(request => request.url === `${origin}/login`)
    expect(login).toBeDefined()
    expect(await read('browser_network_request', { workspaceId, tabId, requestId: login!.id })).toContain('[redacted]')
    // A form body encodes the password's ! as %21; that is hidden as well, and the email beside it, which network
    // details show, while they hide a password field themselves.
    const audit = async () => json<Array<{ id: string; url: string }>>(await read('browser_network', { workspaceId, tabId }))
      .find(request => request.url === `${origin}/audit`)
    await expect.poll(audit).toBeDefined()
    expect(await read('browser_network_request', { workspaceId, tabId, requestId: (await audit())!.id }))
      .toContain('email=[redacted]&password=')
    await read('browser_network_har', { workspaceId, tabId, includeBodies: true })
    await read('browser_network_search', { workspaceId, tabId, query: 'example.test' })
    await read('browser_storage', { workspaceId, tabId, kind: 'local-storage', action: 'list', includeValues: true })
    await read('browser_find', { workspaceId, tabId, query: 'Welcome', maxMatches: 5 })
    await read('browser_tabs', { workspaceId })
    await read('browser_status', { workspaceId })
    expect(await read('browser_snapshot', { workspaceId, tabId })).toContain('Sign in fixture')

    // An agent asks the person to sign in; what they enter before they answer is hidden too, also after they emptied
    // the field and left it, which the page reports as nothing.
    await read('browser_request_user_attention', { workspaceId, tabId, reason: 'Sign in, please.' })
    await personInput(electronApp, origin, { focus: 'search', selectAll: true, key: 'Backspace' })
    await personInput(electronApp, origin, { focus: 'email' })
    await personInput(electronApp, origin, { focus: 'search', paste: ASKED })
    await expect.poll(async () => textOf(await raw('browser_evaluate', { workspaceId, tabId, script: 'search.value' }))).not.toContain(ASKED)
    expect(textOf(await raw('browser_evaluate', { workspaceId, tabId, script: 'search.value' }))).toContain('[redacted]')

    // Another workspace reads its own pages as they are.
    const other = json<{ id: string }>(await read('browser_workspaces', { action: 'create', name: 'Other workspace' })).id
    const otherTab = json<{ activeTabId: string }>(textOf(await raw('browser_new_tab', {
      workspaceId: other, url: `data:text/html,<title>Other</title><p>${EMAIL}</p>`
    }))).activeTabId
    await expect.poll(async () => textOf(await raw('browser_snapshot', { workspaceId: other, tabId: otherTab }))).toContain(EMAIL)
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
