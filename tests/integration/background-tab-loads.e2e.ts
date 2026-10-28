import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('pages opened behind the shown one to load in their turn, as by Open all, load three at a time in order', async ({ appWindow }) => {
  // Open all opened every bookmark's page at once, and 45 pages loading together took the processor from the window.
  const held = new Map<string, ServerResponse>()
  const requested: string[] = []
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    request.resume()
    if (path === '/favicon.ico') { response.writeHead(404); response.end(); return }
    requested.push(path)
    held.set(path, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const release = (path: string) => {
    const response = held.get(path)!
    held.delete(path)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Page ${path.slice(1)}</title>`)
  }
  const paths = ['/one', '/two', '/three', '/four', '/five']
  const tabs = () => appWindow.evaluate(async (origin) => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs
    .filter((tab) => tab.url.startsWith(origin)).map(({ url, sleeping, loading }) => ({ path: new URL(url).pathname, sleeping, loading })), origin)
  try {
    for (const path of paths) {
      await appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: false, focus: false, loadsInTurn: true }), `${origin}${path}`)
    }
    await expect.poll(() => requested).toEqual(['/one', '/two', '/three'])
    expect(await tabs()).toEqual([
      { path: '/one', sleeping: false, loading: true },
      { path: '/two', sleeping: false, loading: true },
      { path: '/three', sleeping: false, loading: true },
      { path: '/four', sleeping: true, loading: false },
      { path: '/five', sleeping: true, loading: false }
    ])
    // The next one waits for one of the three, whichever finishes first.
    await appWindow.waitForTimeout(1_000)
    expect(requested).toEqual(['/one', '/two', '/three'])
    release('/two')
    await expect.poll(() => requested).toEqual(['/one', '/two', '/three', '/four'])
    release('/one')
    await expect.poll(() => requested).toEqual(paths)
    for (const path of ['/three', '/four', '/five']) release(path)
    await expect.poll(tabs).toEqual(paths.map((path) => ({ path, sleeping: false, loading: false })))
  } finally {
    for (const path of [...held.keys()]) release(path)
    await closeFixtureServer(server)
  }
})

test('a page waiting for its turn loads at once when it is shown', async ({ appWindow }) => {
  const requested: string[] = []
  const held: ServerResponse[] = []
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    request.resume()
    if (path === '/favicon.ico') { response.writeHead(404); response.end(); return }
    requested.push(path)
    if (path === '/shown') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><title>Shown</title>')
      return
    }
    held.push(response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    for (const path of ['/one', '/two', '/three', '/shown']) {
      await appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: false, focus: false, loadsInTurn: true }), `${origin}${path}`)
    }
    await expect.poll(() => requested).toEqual(['/one', '/two', '/three'])
    const shown = await appWindow.evaluate(async (url) => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs
      .find((tab) => tab.url === url)!, `${origin}/shown`)
    expect(shown.sleeping).toBe(true)
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), shown.id)
    await expect.poll(() => requested).toEqual(['/one', '/two', '/three', '/shown'])
    await expect.poll(() => appWindow.evaluate(async (id) => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs
      .find((tab) => tab.id === id), shown.id)).toMatchObject({ title: 'Shown', sleeping: false, loading: false, active: true })
  } finally {
    for (const response of held) { response.writeHead(204); response.end() }
    await closeFixtureServer(server)
  }
})
