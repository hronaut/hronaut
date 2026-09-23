import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddressSuggestionOverlayRequest } from '../../src/shared/address-suggestions.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('repairs a legacy credential title before showing a visited address suggestion', async ({ profileDirectory, mcpPort }) => {
  const url = 'https://example.com/private'
  const privateUrl = `https://person:${'private-history-token-'.repeat(12)}@example.com/private`
  await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({
    version: 1,
    entries: [{
      id: 'legacy-visit', url, title: privateUrl.slice(0, 200),
      visitedAt: new Date().toISOString(), visitCount: 1
    }]
  }), 'utf8')

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    await expect.poll(() => instance.window.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url, title: url })
    ])
    await instance.window.evaluate('window.hronaut.newTab({ active: true })')
    await instance.window.getByRole('combobox', { name: 'Address' }).fill('example.com')
    const option = instance.window.locator('#address-suggestions [role="option"]')
    await expect(option).toHaveCount(1)
    await expect(option).toContainText(url)
    await expect(option).not.toContainText('private-history-token')
    expect(await readFile(join(profileDirectory, 'history.json'), 'utf8')).not.toContain('private-history-token')
  } finally {
    await closeHronaut(instance.app)
  }
})

test('shows the latest history suggestions when requests arrive during popup startup', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate('window.hronaut.newTab({ active: true })')
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  await address.fill('no-existing-matches')
  await expect(address).toHaveAttribute('aria-expanded', 'false')
  const request: AddressSuggestionOverlayRequest = {
    sessionId: 1,
    bounds: { x: 300, y: 100, width: 560, maxHeight: 440 },
    suggestions: [{ id: 'history:first', kind: 'history', title: 'First match', url: 'https://first.example/' }],
    selectedIndex: -1,
    theme: 'light',
    locale: 'en-US'
  }
  await appWindow.evaluate(`(() => {
    const initial = ${JSON.stringify(request)};
    window.hronautAddressOverlay.show(initial)
    window.hronautAddressOverlay.show({
      ...initial,
      suggestions: [{ id: 'history:latest', kind: 'history', title: 'Latest history match', url: 'https://latest.example/' }]
    })
  })()`)

  await expect.poll(() => electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes('address-overlay.html'))
    if (!contents || contents.isLoading()) return null
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    const view = main?.contentView.children.find((child) => (
      (child as unknown as { webContents?: { id: number } }).webContents?.id === contents.id
    ))
    return {
      visible: view?.getVisible(),
      text: await contents.executeJavaScript("document.querySelector('[role=option]')?.textContent")
    }
  })).toMatchObject({ visible: true, text: expect.stringContaining('Latest history match') })
})

test('updates address history when a client-rendered page sets its final title', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Loading account</title><main>Account application</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('History title fixture is unavailable')
    const url = `http://127.0.0.1:${address.port}/dashboard`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate(async (targetUrl) => {
      const history = (window as unknown as {
        hronautHistory: { list(): Promise<Array<{ url: string; title: string; visitCount: number }>> }
      }).hronautHistory
      return (await history.list()).find((entry) => entry.url === targetUrl)?.title
    }, url)).toBe('Loading account')

    await electronApp.evaluate(async ({ webContents }, targetUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === targetUrl)
      if (!page) throw new Error('History title fixture page is unavailable')
      await page.executeJavaScript("document.title = 'Account dashboard'")
    }, url)

    await expect.poll(() => appWindow.evaluate(async (targetUrl) => {
      const history = (window as unknown as {
        hronautHistory: { list(): Promise<Array<{ url: string; title: string; visitCount: number }>> }
      }).hronautHistory
      const entry = (await history.list()).find((candidate) => candidate.url === targetUrl)
      return entry ? { title: entry.title, visitCount: entry.visitCount } : null
    }, url)).toEqual({ title: 'Account dashboard', visitCount: 1 })
  } finally {
    await closeFixtureServer(server)
  }
})

for (const format of ['svg', 'ico', 'data-svg', 'png'] as const) {
  test(`renders a website ${format} favicon as PNG and keeps it after iframe navigation`, async ({ appWindow, electronApp }) => {
    const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
    const icoHeader = Buffer.alloc(22)
    icoHeader.writeUInt16LE(1, 2)
    icoHeader.writeUInt16LE(1, 4)
    icoHeader[6] = 24
    icoHeader[7] = 24
    icoHeader.writeUInt16LE(1, 10)
    icoHeader.writeUInt16LE(32, 12)
    icoHeader.writeUInt32LE(png.length, 14)
    icoHeader.writeUInt32LE(22, 18)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'
    const icon = format === 'ico' ? Buffer.concat([icoHeader, png]) : format === 'png' ? png : Buffer.from(svg)
    const mimeType = format === 'ico' ? 'image/x-icon' : format === 'png' ? 'image/png' : 'image/svg+xml'
    const href = format === 'data-svg' ? `data:${mimeType};base64,${icon.toString('base64')}` : '/favicon'
    const server = createServer((request, response) => {
      if (request.url === '/favicon') {
        response.writeHead(200, { 'content-type': mimeType, 'content-length': icon.length })
        response.end(icon)
      } else {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(`<!doctype html><title>Website icon</title><link rel="icon" href="${href}"><main>Website icon</main><iframe></iframe>`)
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Favicon server is unavailable')
      const url = `http://127.0.0.1:${address.port}/page`
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
      const favicon = appWindow.locator('.tab.active .favicon-image')
      await expect(favicon).toHaveAttribute('src', /^data:image\/png;base64,/)
      const initialIcon = await favicon.getAttribute('src')
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
        if (!page) throw new Error('Favicon page is unavailable')
        await page.executeJavaScript(`new Promise(resolve => {
          const frame = document.querySelector('iframe');
          frame.onload = () => resolve(true);
          frame.src = '/child';
        })`)
      }, url)
      await expect(favicon).toHaveAttribute('src', initialIcon!)
    } finally {
      await closeFixtureServer(server)
    }
  })
}

test('clears a stale favicon when a same-origin navigation has no valid icon', async ({ appWindow }) => {
  const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
  const server = createServer((request, response) => {
    if (request.url === '/first-icon') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      response.end(png)
      return
    }
    if (request.url === '/first') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>First icon page</title><link rel="icon" href="/first-icon"><main>First page</main>')
      return
    }
    if (request.url === '/second') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>No icon page</title><main>Second page</main>')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Same-origin favicon server is unavailable')
    const origin = `http://127.0.0.1:${address.port}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/first`)}, active: true })`)
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', /^data:image\/png;base64,/)

    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/second`)} })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
      .toBe('No icon page')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl)'))
      .toBeUndefined()
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveCount(0)
    await expect(appWindow.locator('.tab.active .favicon-fallback')).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})

test('clears a stale favicon when the next main-document navigation fails', async ({ appWindow }) => {
  const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
  const server = createServer((request, response) => {
    if (request.url === '/favicon') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      response.end(png)
      return
    }
    if (request.url === '/available') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Available icon page</title><link rel="icon" href="/favicon"><main>Available page</main>')
      return
    }
    request.socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Failed-navigation favicon server is unavailable')
    const origin = `http://127.0.0.1:${address.port}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/available`)}, active: true })`)
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', /^data:image\/png;base64,/)

    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/unavailable`)} }).catch(() => undefined)`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem?.kind)'))
      .toBe('load-error')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl)'))
      .toBeUndefined()
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveCount(0)
    await expect(appWindow.locator('.tab.active .favicon-fallback')).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})

test('loads an authenticated favicon and retains it while the same page reloads', async ({ appWindow, electronApp }) => {
  const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
  let pageRequests = 0
  let releaseReload!: () => void
  const reloadBlocked = new Promise<void>((resolve) => { releaseReload = resolve })
  const server = createServer(async (request, response) => {
    if (request.url === '/favicon') {
      if (!request.headers.cookie?.includes('favicon-session=allowed')) {
        response.writeHead(401, { 'cache-control': 'no-store' })
        response.end('authentication required')
        return
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'image/png',
        'content-length': png.length
      })
      response.end(png)
      return
    }
    pageRequests += 1
    if (pageRequests > 1) await reloadBlocked
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html',
      'set-cookie': 'favicon-session=allowed; Path=/; SameSite=Lax'
    })
    response.end('<!doctype html><title>Authenticated icon</title><link rel="icon" href="/favicon"><main>Authenticated icon</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const serverAddress = server.address()
    if (!serverAddress || typeof serverAddress === 'string') throw new Error('Authenticated favicon server is unavailable')
    const url = `http://127.0.0.1:${serverAddress.port}/page`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    const favicon = appWindow.locator('.tab.active .favicon-image')
    await expect(favicon).toHaveAttribute('src', /^data:image\/png;base64,/)
    const initialIcon = await favicon.getAttribute('src')

    await electronApp.evaluate(({ webContents }, targetUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === targetUrl)
      if (!page) throw new Error('Authenticated favicon page is unavailable')
      page.reload()
    }, url)
    await expect.poll(() => pageRequests).toBe(2)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl)'))
      .toBe(initialIcon)

    releaseReload()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.loading)')).toBe(false)
    await expect(favicon).toHaveAttribute('src', initialIcon!)
  } finally {
    releaseReload?.()
    await closeFixtureServer(server)
  }
})

test('uses a valid favicon promptly while an earlier advertised candidate is stalled', async ({ appWindow, electronApp }) => {
  const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
  let releaseStalled!: () => void
  const stalled = new Promise<void>((resolve) => { releaseStalled = resolve })
  let stalledRequests = 0
  let validRequests = 0
  const server = createServer(async (request, response) => {
    if (request.url === '/stalled-icon') {
      stalledRequests += 1
      await stalled
      response.writeHead(503)
      response.end()
      return
    }
    if (request.url === '/valid-icon') {
      validRequests += 1
      releaseStalled()
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      response.end(png)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Fallback icon</title><main>Fallback icon</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fallback favicon server is unavailable')
    const url = `http://127.0.0.1:${address.port}/page`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.loading)')).toBe(false)
    await electronApp.evaluate(({ webContents }, fixture) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === fixture.url)
      if (!page) throw new Error('Fallback favicon page is unavailable')
      page.emit('page-favicon-updated', {} as never, [fixture.stalled, fixture.valid])
    }, {
      url,
      stalled: `http://127.0.0.1:${address.port}/stalled-icon`,
      valid: `http://127.0.0.1:${address.port}/valid-icon`
    })
    await expect.poll(() => stalledRequests).toBeGreaterThan(0)
    await expect.poll(() => validRequests, { timeout: 3_000 }).toBeGreaterThan(0)
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', /^data:image\/png;base64,/)
  } finally {
    releaseStalled?.()
    await closeFixtureServer(server)
  }
})

test('persists a favicon that finishes after the navigation state save', async ({ appWindow, profileDirectory }) => {
  const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
  let releaseFavicon!: () => void
  const faviconBlocked = new Promise<void>((resolve) => { releaseFavicon = resolve })
  const server = createServer(async (request, response) => {
    if (request.url === '/favicon') {
      await faviconBlocked
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      response.end(png)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Delayed icon</title><link rel="icon" href="/favicon"><main>Delayed icon</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Delayed favicon server is unavailable')
    const url = `http://127.0.0.1:${address.port}/page`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    const statePath = join(profileDirectory, 'tabs.json')
    await expect.poll(async () => {
      const state = JSON.parse(await readFile(statePath, 'utf8')) as { tabs: Array<{ url: string; faviconDataUrl?: string }> }
      const tab = state.tabs.find((candidate) => candidate.url === url)
      return tab ? { found: true, favicon: tab.faviconDataUrl } : { found: false }
    }).toEqual({ found: true, favicon: undefined })

    releaseFavicon()
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(async () => {
      const state = JSON.parse(await readFile(statePath, 'utf8')) as { tabs: Array<{ url: string; faviconDataUrl?: string }> }
      return state.tabs.find((candidate) => candidate.url === url)?.faviconDataUrl
    }).toMatch(/^data:image\/png;base64,/)
  } finally {
    releaseFavicon?.()
    await closeFixtureServer(server)
  }
})
