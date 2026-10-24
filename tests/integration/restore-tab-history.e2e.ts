import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

interface RestartWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<unknown>
    navigate(options: { tabId?: string; url: string }): Promise<unknown>
    back(tabId?: string): Promise<unknown>
    getState(): Promise<{ tabs: Array<{ id: string; url: string; loading: boolean; canGoBack: boolean }> }>
  }
}

interface SavedTabHistory { version: number; tabs: Record<string, { entries: Array<{ url: string; title: string; pageState?: string }>; index: number }> }

const SECRET = 'hunter2-secret'

test('a restart brings tabs back with their Back history, scroll and form fields, without a password, as Chrome', async ({ profileDirectory, mcpPort }) => {
  // A restart reopened each tab at its address only: Back led nowhere and the page was at its top again.
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    request.resume()
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    if (path === '/form') {
      response.end('<!doctype html><title>Sign in</title><form method="post" action="/signed-in"><input id="user" name="user">'
        + '<input id="secret" name="secret" type="password"><button>Sign in</button></form>')
      return
    }
    response.end(`<!doctype html><title>Page ${path.slice(1)}</title><main style="height: 5000px">Restart fixture</main>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const [form, signedIn, long, next] = ['form', 'signed-in', 'long', 'next'].map((name) => `http://127.0.0.1:${address.port}/${name}`) as [string, string, string, string]
  const pages = [form, signedIn, long, next]
  const tab = (window: Page) => window.evaluate(async (urls) => (await (window as unknown as RestartWindow).hronaut.getState()).tabs
    .find((candidate) => urls.includes(candidate.url)), pages)
  const showing = async (window: Page, url: string) => { const shown = await tab(window); return shown?.url === url && !shown.loading }
  const inPage = (app: ElectronApplication, url: string, script: string) => app.evaluate(({ webContents }, { url, script }) => webContents
    .getAllWebContents().find((contents) => contents.getURL() === url)?.executeJavaScript(script) as Promise<unknown> | undefined, { url, script })
  const pageState = (app: ElectronApplication, url: string) => app.evaluate(({ webContents }, url) => {
    const history = webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.navigationHistory
    return history?.getEntryAtIndex(history.getActiveIndex())?.pageState
  }, url)
  const navigate = async (window: Page, url: string) => {
    const { id } = (await tab(window))!
    await window.evaluate(({ id, url }) => (window as unknown as RestartWindow).hronaut.navigate({ tabId: id, url }), { id, url })
    await expect.poll(() => showing(window, url)).toBe(true)
  }
  const back = async (window: Page, url: string) => {
    const { id } = (await tab(window))!
    await window.evaluate((id) => (window as unknown as RestartWindow).hronaut.back(id), id)
    await expect.poll(() => showing(window, url)).toBe(true)
  }
  /** Scrolls the page and waits until its history entry holds the scroll, which Chromium saves a moment later. */
  const scroll = async (app: ElectronApplication, window: Page, url: string, top: number) => {
    let settled = await pageState(app, url)
    await expect.poll(async () => {
      await window.waitForTimeout(1_500)
      const latest = await pageState(app, url)
      const still = latest === settled
      settled = latest
      return still
    }, { timeout: 15_000 }).toBe(true)
    await inPage(app, url, `window.scrollTo(0, ${top})`)
    await expect.poll(() => inPage(app, url, 'window.scrollY')).toBe(top)
    await expect.poll(() => pageState(app, url), { timeout: 10_000 }).not.toBe(settled)
  }
  let first: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    first = await launchHronaut(profileDirectory, mcpPort)
    await first.window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: true }), form)
    await expect.poll(() => showing(first!.window, form)).toBe(true)
    await inPage(first.app, form, `document.querySelector('#user').value = 'visible-name'; document.querySelector('#secret').value = ${JSON.stringify(SECRET)}`)
    await inPage(first.app, form, 'document.querySelector("form").submit()')
    await expect.poll(() => showing(first!.window, signedIn)).toBe(true)
    // The page the form posted to holds the form's fields, the password included, in its history entry.
    await expect.poll(async () => Buffer.from(await pageState(first!.app, signedIn) ?? '', 'base64').includes(SECRET)).toBe(true)
    await navigate(first.window, long)
    await scroll(first.app, first.window, long, 1500)
    await navigate(first.window, next)
    await scroll(first.app, first.window, next, 700)
    const historyPath = join(profileDirectory, 'tab-history.json')
    await expect.poll(async () => (await readFile(historyPath, 'utf8').catch(() => '')).includes(next)).toBe(true)
    await closeHronaut(first.app)
    first = undefined

    const saved = JSON.parse(await readFile(historyPath, 'utf8')) as SavedTabHistory
    const [history] = Object.values(saved.tabs)
    expect(history?.entries.map((entry) => entry.url)).toEqual(pages)
    expect(history?.index).toBe(3)
    const states = history!.entries.map((entry) => Buffer.from(entry.pageState ?? '', 'base64'))
    // The posted page's state is left out; no saved state holds the password, in any encoding.
    expect(history!.entries[1]!.pageState).toBeUndefined()
    expect(states.some((state) => state.includes(SECRET) || state.includes(Buffer.from(SECRET, 'utf16le')))).toBe(false)
    expect(states[0]!.includes(Buffer.from('visible-name', 'utf16le'))).toBe(true)

    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => showing(second!.window, next)).toBe(true)
    expect((await tab(second.window))?.canGoBack).toBe(true)
    await expect.poll(() => inPage(second!.app, next, 'window.scrollY')).toBe(700)
    await back(second.window, long)
    await expect.poll(() => inPage(second!.app, long, 'window.scrollY')).toBe(1500)
    await back(second.window, signedIn)
    await back(second.window, form)
    await expect.poll(() => inPage(second!.app, form, '[document.querySelector("#user").value, document.querySelector("#secret").value]'))
      .toEqual(['visible-name', ''])
    expect((await tab(second.window))?.canGoBack).toBe(false)
  } finally {
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
    await closeFixtureServer(server)
  }
})
