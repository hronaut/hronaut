import { createServer } from 'node:http'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

interface RestartWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean }): Promise<unknown>
    navigate(options: { tabId?: string; url: string }): Promise<unknown>
    getState(): Promise<{ tabs: Array<{ id: string; url: string; loading: boolean }> }>
  }
}

test('a restart keeps the sign-ins of session cookies, as Chrome continuing where you left off', async ({ profileDirectory, mcpPort }) => {
  // A restart dropped every cookie without an expiry, which signed the person out of sites that keep their sign-in so.
  const server = createServer((request, response) => {
    request.resume()
    const headers: Record<string, string | string[]> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    if (request.url === '/sign-in') headers['set-cookie'] = ['sid=signed-in; Path=/; HttpOnly; SameSite=Lax', 'remember=yes; Path=/; Max-Age=3600']
    response.writeHead(200, headers)
    response.end(`<!doctype html><title>Who</title><output>${request.headers.cookie ?? 'signed out'}</output>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const signIn = `http://127.0.0.1:${address.port}/sign-in`
  const who = `http://127.0.0.1:${address.port}/who`
  const showing = (window: Page, url: string) => window.evaluate(async (url) => (await (window as unknown as RestartWindow).hronaut.getState()).tabs
    .some((tab) => tab.url === url && !tab.loading), url)
  const inPage = (app: ElectronApplication, url: string, script: string) => app.evaluate(({ webContents }, { url, script }) => webContents
    .getAllWebContents().find((contents) => contents.getURL() === url)?.executeJavaScript(script) as Promise<unknown> | undefined, { url, script })
  /** The cookies the page's request sent, in any order, as one set again later is sent after those kept. */
  const cookies = async (app: ElectronApplication) => String(await inPage(app, who, 'document.querySelector("output").textContent')).split('; ').sort()
  const storagePath = (app: ElectronApplication, url: string) => app.evaluate(({ webContents }, url) => webContents
    .getAllWebContents().find((contents) => contents.getURL() === url)?.session.storagePath ?? null, url)
  let first: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    first = await launchHronaut(profileDirectory, mcpPort)
    await first.window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: true }), signIn)
    await expect.poll(() => showing(first!.window, signIn)).toBe(true)
    const { id } = (await first.window.evaluate(async () => (await (window as unknown as RestartWindow).hronaut.getState()).tabs))
      .find((tab) => tab.url === signIn)!
    await first.window.evaluate(({ id, url }) => (window as unknown as RestartWindow).hronaut.navigate({ tabId: id, url }), { id, url: who })
    await expect.poll(() => showing(first!.window, who)).toBe(true)
    expect(await cookies(first.app)).toEqual(['remember=yes', 'sid=signed-in'])
    const workspaceStorage = await storagePath(first.app, who)
    expect(workspaceStorage).toContain(join(profileDirectory, 'Partitions', 'hronaut-workspace-'))
    await closeHronaut(first.app)
    first = undefined

    // Only the session cookie is saved, in the workspace's own storage, readable by the person only.
    const file = join(workspaceStorage!, 'Hronaut Session Cookies.json')
    const saved = await readFile(file, 'utf8')
    expect(saved).not.toContain('remember')
    if (!JSON.parse(saved).encrypted) expect(saved).toContain('signed-in')
    expect((await lstat(file)).mode & 0o777).toBe(0o600)

    second = await launchHronaut(profileDirectory, mcpPort)
    // The tab loads again only once the session cookie is back, so its first request is signed in.
    await expect.poll(() => showing(second!.window, who)).toBe(true)
    expect(await cookies(second.app)).toEqual(['remember=yes', 'sid=signed-in'])
    const restored = await second.app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)!
      return (await contents.session.cookies.get({ name: 'sid' })).map(({ session, httpOnly, sameSite, hostOnly }) => ({ session, httpOnly, sameSite, hostOnly }))
    }, who)
    expect(restored).toEqual([{ session: true, httpOnly: true, sameSite: 'lax', hostOnly: true }])
  } finally {
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
    await closeFixtureServer(server)
  }
})
