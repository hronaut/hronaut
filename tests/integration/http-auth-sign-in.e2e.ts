import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

const PASSWORD = 'PRIVATE_s3cret'
const SIGNED_IN = `Basic ${Buffer.from(`ada:${PASSWORD}`).toString('base64')}`

const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.type === 'text' ? item.text : '').join('\n')

/**
 * A website whose /reports pages ask for a username and password, whose /admin page asks in another realm, whose /poll
 * page asks for /reports/data again and again, whose /reports/refresh refusal page reloads itself, whose
 * /reports/rotate and /admin/rotate refusal pages open each other, each asking in its own realm, and whose /popups page
 * opens /reports/popup in a new window again and again, whose refusal page closes itself.
 */
function signInServer() {
  const authorizations: string[] = []
  const requests: string[] = []
  const server = createServer((request: IncomingMessage, response) => {
    const path = request.url ?? '/'
    requests.push(path)
    if (request.headers.authorization) authorizations.push(request.headers.authorization)
    if (path === '/poll') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Poll</title><script>setInterval(() => fetch("/reports/data").catch(() => {}), 200)</script>')
      return
    }
    if (path === '/popups') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Popups</title><script>let popup; setInterval(() => { if (!popup || popup.closed) popup = window.open("/reports/popup", "_blank", "popup") }, 300)</script>')
      return
    }
    const realm = path.startsWith('/reports') ? 'Reports' : path.startsWith('/admin') ? 'Admin' : undefined
    if (realm && request.headers.authorization !== SIGNED_IN) {
      const refresh = path === '/reports/refresh'
        ? '<meta http-equiv="refresh" content="0.4">'
        : path.endsWith('/rotate') ? `<meta http-equiv="refresh" content="0.4;url=${realm === 'Reports' ? '/admin/rotate' : '/reports/rotate'}">`
          : path === '/reports/popup' ? '<script>setTimeout(() => window.close(), 200)</script>' : ''
      response.writeHead(401, { 'www-authenticate': `Basic realm="${realm}"`, 'content-type': 'text/html' }).end(`<title>Denied</title>${refresh}Denied`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>${realm ?? 'Start'} page</title>${path}`)
  })
  return { server, authorizations, requests }
}

test('signs a person in to a website that asks for a username and password, as Chrome does, and shows its refusal when they cancel', async ({ appWindow, electronApp }) => {
  const { server, authorizations } = signInServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const pageTitle = () => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')
  try {
    // The load waits for the person to sign in, so the test goes on while it does.
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }) }, `${origin}/reports/2026`)
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-variant', 'http-auth')
    expect(await trustedDialogHeadline(appWindow)).toBe(`Sign in to ${origin}`)
    // A website on this computer is not read on the way, as the address bar says too.
    await expect(dialog).toContainText('never shows them to agents')
    await expect(dialog).not.toContainText('not private')
    const username = dialog.getByLabel('Username')
    await expect(username).toBeFocused()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await username.fill('ada')
    await dialog.getByLabel('Password').fill(PASSWORD)
    await dialog.getByLabel('Password').press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(pageTitle).toBe('Reports page')
    expect(authorizations).toContain(SIGNED_IN)

    // Chromium keeps the sign-in for the workspace, so the website's other pages in the realm do not ask again.
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { navigate(options: { url: string }): Promise<unknown> } }).hronaut.navigate({ url }) }, `${origin}/reports/2025`)
    await expect.poll(pageTitle).toBe('Reports page')
    await expect(dialog).toBeHidden()

    // Another realm asks again, and Cancel shows the page the website sends without credentials.
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { navigate(options: { url: string }): Promise<unknown> } }).hronaut.navigate({ url }) }, `${origin}/admin`)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.locator('.ui-dialog__footer').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(pageTitle).toBe('Denied')

    // What the person typed never reaches the shell's state or the page.
    const state = JSON.stringify(await appWindow.evaluate('window.hronaut.getState()'))
    expect(state).not.toContain(PASSWORD)
    const page = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)?.executeJavaScript('document.documentElement.outerHTML'), `${origin}/admin`)
    expect(page).not.toContain(PASSWORD)
  } finally {
    await closeFixtureServer(server)
  }
})

test('does not ask again for a sign-in the person cancelled while the page that asked is shown, however often it asks', async ({ appWindow }) => {
  const { server, requests } = signInServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }) }, `${origin}/poll`)
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.locator('.ui-dialog__footer').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    // The page goes on asking, and gets the website's refusal each time without the person being asked.
    const asked = requests.filter(path => path === '/reports/data').length
    await expect.poll(() => requests.filter(path => path === '/reports/data').length).toBeGreaterThan(asked + 3)
    await expect(dialog).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})

test('does not ask again when the refusal page of a cancelled sign-in reloads itself, and asks again when the person reloads it', async ({ appWindow }) => {
  const { server, requests } = signInServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const pageTitle = () => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')
  const refreshes = () => requests.filter(path => path === '/reports/refresh').length
  try {
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }) }, `${origin}/reports/refresh`)
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.locator('.ui-dialog__footer').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(pageTitle).toBe('Denied')
    // The refusal page reloads itself again and again, and the person is not asked.
    const asked = refreshes()
    await expect.poll(refreshes).toBeGreaterThan(asked + 3)
    await expect(dialog).toBeHidden()

    // Reload is the person's: the website asks again, and they sign in.
    await appWindow.evaluate(async () => {
      const hronaut = (window as unknown as { hronaut: { getState(): Promise<{ activeTabId: string }>, reload(tabId: string): Promise<unknown> } }).hronaut
      void hronaut.reload((await hronaut.getState()).activeTabId)
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.getByLabel('Username').fill('ada')
    await dialog.getByLabel('Password').fill(PASSWORD)
    await dialog.getByLabel('Password').press('Enter')
    await expect.poll(pageTitle).toBe('Reports page')
  } finally {
    await closeFixtureServer(server)
  }
})

test('lets the person sign in for an agent\'s page in its workspace, and never shows agents what they typed', async ({ appWindow, mcpPort, mcpToken }) => {
  const { server } = signInServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const client = new Client({ name: 'http-auth-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = await call('browser_workspaces', { action: 'create', name: 'Reports client', storage: 'scratch' })
    const workspaceId = (JSON.parse(text(workspace)) as { id: string }).id
    const opened = await call('browser_new_tab', { workspaceId, url: `${origin}/start` })
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId

    const navigation = call('browser_navigate', { workspaceId, tabId, url: `${origin}/reports/q3` })
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('“Reports client” workspace')
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.getByLabel('Username').fill('ada')
    await dialog.getByLabel('Password').fill(PASSWORD)
    await dialog.locator('.ui-dialog__footer').getByRole('button', { name: 'Sign in', exact: true }).click()
    const navigated = await navigation
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const snapshot = await call('browser_snapshot', { workspaceId, tabId })
    expect(text(snapshot)).toContain('/reports/q3')

    for (const [name, args] of [
      ['browser_network_har', { workspaceId, tabId }],
      ['browser_issues', { workspaceId, tabId, action: 'list' }]
    ] as const) {
      const result = text(await call(name, args))
      expect(result, name).not.toContain(PASSWORD)
      expect(result, name).not.toContain(SIGNED_IN.slice('Basic '.length))
    }
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('does not ask again when the refusal page of a cancelled sign-in takes turns with a page that asks in another realm', async ({ appWindow }) => {
  const { server, requests } = signInServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const turns = () => requests.filter(path => path.endsWith('/rotate')).length
  try {
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }) }, `${origin}/reports/rotate`)
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.locator('.ui-dialog__footer').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    // The pages open each other again and again, each asking in its own realm, and the person is not asked.
    const asked = turns()
    await expect.poll(turns).toBeGreaterThan(asked + 3)
    expect(requests).toContain('/admin/rotate')
    await expect(dialog).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})

test('does not ask again when a page opens new windows that ask after the person cancelled a sign-in in one', async ({ appWindow }) => {
  const { server, requests } = signInServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const popups = () => requests.filter(path => path === '/reports/popup').length
  try {
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }) }, `${origin}/popups`)
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await dialog.locator('.ui-dialog__footer').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    // Each window shows the refusal, closes, and the page opens another that asks; the person is not asked.
    const asked = popups()
    await expect.poll(popups, { timeout: 15_000 }).toBeGreaterThan(asked + 3)
    await expect(dialog).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
