import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

interface RestartWindow {
  hronaut: {
    newTab(options: { url: string; active: boolean; mcpGroupId?: string }): Promise<unknown>
    createWorkspace(options: { name: string; storage: 'scratch' }): Promise<{ tabs: Array<{ id: string; mcpGroupId?: string }>; mcpTabGroups: Array<{ id: string; name: string }> }>
    navigate(options: { tabId?: string; url: string }): Promise<unknown>
    back(tabId?: string): Promise<unknown>
    forward(tabId?: string): Promise<unknown>
    selectTab(tabId: string): Promise<unknown>
    setAllHumanInteractionLocked(locked: boolean): Promise<{ allHumanInteractionLocked: boolean }>
    getState(): Promise<{ tabs: Array<{ id: string; url: string; loading: boolean; sleeping: boolean; canGoBack: boolean; canGoForward: boolean; humanInteractionInputLocked: boolean }> }>
  }
}

test('a restart loads the tabs shown, the window\'s and each workspace\'s, and brings the others back asleep, each loading with its history once shown, as Chrome', async ({ profileDirectory, mcpPort }) => {
  // A restart loaded every restored tab at once: 45 tabs came back as 45 pages loading together.
  const requests = new Map<string, number>()
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    request.resume()
    // Only the pages: Chromium also asks for each site's icon.
    if (path !== '/favicon.ico') requests.set(path, (requests.get(path) ?? 0) + 1)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Page ${path.slice(1)}</title><main style="height: 5000px">Restore fixture</main>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const [first, forward, shown, behind, client, clientBehind] = ['first', 'forward', 'shown', 'behind', 'client', 'client-behind']
    .map((name) => `http://127.0.0.1:${address.port}/${name}`) as [string, string, string, string, string, string]
  const tabAt = (window: Page, urls: string[]) => window.evaluate(async (urls) => (await (window as unknown as RestartWindow).hronaut.getState()).tabs
    .find((candidate) => urls.includes(candidate.url)), urls)
  const showing = async (window: Page, urls: string[], url: string) => {
    const tab = await tabAt(window, urls)
    return tab?.url === url && !tab.loading && !tab.sleeping
  }
  const inPage = (app: ElectronApplication, url: string, script: string) => app.evaluate(({ webContents }, { url, script }) => webContents
    .getAllWebContents().find((contents) => contents.getURL() === url)?.executeJavaScript(script) as Promise<unknown> | undefined, { url, script })
  const pageState = (app: ElectronApplication, url: string) => app.evaluate(({ webContents }, url) => {
    const history = webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.navigationHistory
    return history?.getEntryAtIndex(history.getActiveIndex())?.pageState
  }, url)
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
  const historyTab = [first, forward]
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    const window = before.window
    // A tab behind the shown one, at its first page with a page Forward of it.
    await window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: true }), first)
    await expect.poll(() => showing(window, historyTab, first)).toBe(true)
    await scroll(before.app, window, first, 1200)
    const { id: historyTabId } = (await tabAt(window, historyTab))!
    await window.evaluate(({ id, url }) => (window as unknown as RestartWindow).hronaut.navigate({ tabId: id, url }), { id: historyTabId, url: forward })
    await expect.poll(() => showing(window, historyTab, forward)).toBe(true)
    await window.evaluate((id) => (window as unknown as RestartWindow).hronaut.back(id), historyTabId)
    await expect.poll(() => showing(window, historyTab, first)).toBe(true)
    await window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: true }), shown)
    await expect.poll(() => showing(window, [shown], shown)).toBe(true)
    await window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: false }), behind)
    await expect.poll(() => showing(window, [behind], behind)).toBe(true)
    // Another workspace, whose agent reads and acts in the tab it shows, with a tab behind that one.
    await window.evaluate(async (urls) => {
      const { hronaut } = window as unknown as RestartWindow
      const created = await hronaut.createWorkspace({ name: 'Client', storage: 'scratch' })
      const mcpGroupId = created.mcpTabGroups.find((group) => group.name === 'Client')!.id
      // A new workspace starts with an empty tab, shown.
      await hronaut.navigate({ tabId: created.tabs.find((tab) => tab.mcpGroupId === mcpGroupId)!.id, url: urls[0]! })
      await hronaut.newTab({ url: urls[1]!, active: false, mcpGroupId })
    }, [client, clientBehind])
    await expect.poll(() => showing(window, [client], client)).toBe(true)
    await expect.poll(() => showing(window, [clientBehind], clientBehind)).toBe(true)
    await window.evaluate(async (id) => (window as unknown as RestartWindow).hronaut.selectTab(id), (await tabAt(window, [shown]))!.id)
    const historyPath = join(profileDirectory, 'tab-history.json')
    await expect.poll(async () => (await readFile(historyPath, 'utf8').catch(() => '')).includes(forward), { timeout: 15_000 }).toBe(true)
    await closeHronaut(before.app)
    before = undefined
    requests.clear()

    after = await launchHronaut(profileDirectory, mcpPort)
    const restarted = after.window
    await expect.poll(() => showing(restarted, [shown], shown)).toBe(true)
    await expect.poll(() => showing(restarted, [client], client)).toBe(true)
    expect(await tabAt(restarted, historyTab)).toMatchObject({ url: first, sleeping: true, loading: false, canGoBack: false, canGoForward: true })
    expect(await tabAt(restarted, [behind])).toMatchObject({ url: behind, sleeping: true, loading: false })
    expect(await tabAt(restarted, [clientBehind])).toMatchObject({ url: clientBehind, sleeping: true, loading: false })
    expect(Object.fromEntries(requests)).toEqual({ '/shown': 1, '/client': 1 })
    // Asleep, they hold no page and so no renderer process, as in Chrome: the sleeping page they first showed started
    // one for each of them.
    expect(await after.app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === '').map((contents) => contents.getOSProcessId()))).toEqual([0, 0, 0])

    // Shown, the tab loads its page where it was scrolled, with the page Forward of it, and the other stays asleep.
    await restarted.evaluate((id) => (window as unknown as RestartWindow).hronaut.selectTab(id), historyTabId)
    await expect.poll(() => showing(restarted, historyTab, first)).toBe(true)
    await expect.poll(() => inPage(after!.app, first, 'window.scrollY')).toBe(1200)
    expect(await tabAt(restarted, historyTab)).toMatchObject({ canGoBack: false, canGoForward: true })
    await restarted.evaluate((id) => (window as unknown as RestartWindow).hronaut.forward(id), historyTabId)
    await expect.poll(() => showing(restarted, historyTab, forward)).toBe(true)
    expect(await tabAt(restarted, historyTab)).toMatchObject({ canGoBack: true, canGoForward: false })
    expect(await tabAt(restarted, [behind])).toMatchObject({ sleeping: true })
    expect(Object.fromEntries(requests)).toEqual({ '/shown': 1, '/client': 1, '/first': 1, '/forward': 1 })
  } finally {
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
    await closeFixtureServer(server)
  }
})

test('a restart\'s tabs asleep take the input lock, and once woken keep it and have their page\'s dialogs watched from its first document', async ({ profileDirectory, mcpPort }) => {
  // Asleep, they have no renderer: locking every tab's input waited on them and failed as a busy page.
  let restarted = false
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    if (request.url === '/dialog') {
      response.end(`<!doctype html><title>Dialog</title>${restarted ? "<script>alert('Opened as it loads')</script>" : ''}<main>Dialog fixture</main>`)
      return
    }
    response.end('<!doctype html><title>Page</title><button id="action" style="width:160px;height:50px">Act</button>'
      + '<script>window.clicks=0;document.querySelector("#action").addEventListener("click",()=>window.clicks++)</script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const [shown, behind, dialog] = ['shown', 'behind', 'dialog'].map((name) => `http://127.0.0.1:${address.port}/${name}`) as [string, string, string]
  const tabAt = (window: Page, url: string) => window.evaluate(async (url) => (await (window as unknown as RestartWindow).hronaut.getState()).tabs
    .find((candidate) => candidate.url === url), url)
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    const window = before.window
    await window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: true }), shown)
    for (const url of [behind, dialog]) await window.evaluate((url) => (window as unknown as RestartWindow).hronaut.newTab({ url, active: false }), url)
    await expect.poll(async () => (await tabAt(window, dialog))?.loading).toBe(false)
    await expect.poll(async () => (await readFile(join(profileDirectory, 'tab-history.json'), 'utf8').catch(() => '')).includes(dialog), { timeout: 15_000 }).toBe(true)
    await closeHronaut(before.app)
    before = undefined
    restarted = true

    after = await launchHronaut(profileDirectory, mcpPort)
    const app = after.app
    const restartedWindow = after.window
    await expect.poll(async () => (await tabAt(restartedWindow, shown))?.loading).toBe(false)
    expect(await tabAt(restartedWindow, behind)).toMatchObject({ sleeping: true })
    expect(await tabAt(restartedWindow, dialog)).toMatchObject({ sleeping: true })
    expect(await restartedWindow.evaluate(() => (window as unknown as RestartWindow).hronaut.setAllHumanInteractionLocked(true)))
      .toMatchObject({ allHumanInteractionLocked: true })

    // The DevTools commands sent to the pages asleep, to see when the browser process's input barrier reaches them.
    await app.evaluate(({ webContents }) => {
      const commands: Array<[number, string, unknown]> = []
      Object.assign(globalThis, { restoredPageCommands: commands })
      for (const contents of webContents.getAllWebContents().filter((candidate) => candidate.getURL() === '')) {
        const send = contents.debugger.sendCommand.bind(contents.debugger)
        contents.debugger.sendCommand = (method: string, params?: object, sessionId?: string) => {
          commands.push([contents.id, method, params])
          return send(method, params, sessionId)
        }
      }
    })
    await restartedWindow.evaluate(async (id) => (window as unknown as RestartWindow).hronaut.selectTab(id), (await tabAt(restartedWindow, behind))!.id)
    await expect.poll(async () => (await tabAt(restartedWindow, behind))?.loading).toBe(false)
    expect(await tabAt(restartedWindow, behind)).toMatchObject({ sleeping: false, humanInteractionInputLocked: true })
    const sent = () => app.evaluate(({ webContents }, url) => {
      const id = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.id
      return (globalThis as { restoredPageCommands?: Array<[number, string, unknown]> }).restoredPageCommands!
        .filter(([page]) => page === id)
        .map(([, method, params]) => (method === 'Input.setIgnoreInputEvents' ? `${method} ${JSON.stringify(params)}` : method))
    }, behind)
    await expect.poll(sent).toContain('Network.enable')
    // The lock reaches the page as its first load starts, before its monitoring waits on the new renderer.
    const commands = await sent()
    expect(commands.indexOf('Input.setIgnoreInputEvents {"ignore":true}')).toBeGreaterThan(-1)
    expect(commands.indexOf('Input.setIgnoreInputEvents {"ignore":true}')).toBeLessThan(commands.indexOf('Network.enable'))
    const blocked = await app.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
      const point = await page.executeJavaScript('(() => { const box = document.querySelector("#action").getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } })()') as { x: number; y: number }
      const observed = new Promise<boolean>((resolve) => {
        page.on('before-mouse-event', (event, mouse) => { if (mouse.type === 'mouseUp') resolve(event.defaultPrevented) })
      })
      page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      return await observed
    }, behind)
    expect(blocked).toBe(true)
    expect(await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
      .executeJavaScript('window.clicks'), behind)).toBe(0)

    // The dialog its page opens as it first loads reaches the page's monitoring, which then has to be in place.
    await app.evaluate(({ webContents }) => {
      const asleep = webContents.getAllWebContents().filter((contents) => contents.getURL() === '')
      if (asleep.length !== 1) throw new Error(`Expected one page asleep, found ${asleep.length}`)
      const dialogs: string[] = []
      Object.assign(globalThis, { restoredPageDialogs: dialogs })
      asleep[0]!.debugger.on('message', (_event, method, params: { message?: string }) => {
        if (method === 'Page.javascriptDialogOpening') dialogs.push(params.message ?? '')
      })
    })
    await restartedWindow.evaluate(async (id) => (window as unknown as RestartWindow).hronaut.selectTab(id), (await tabAt(restartedWindow, dialog))!.id)
    await expect.poll(() => app.evaluate(() => (globalThis as { restoredPageDialogs?: string[] }).restoredPageDialogs)).toEqual(['Opened as it loads'])
    await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      ?.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined), dialog)
  } finally {
    if (after) await after.window.evaluate(() => (window as unknown as RestartWindow).hronaut.setAllHumanInteractionLocked(false)).catch(() => undefined)
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
    await closeFixtureServer(server)
  }
})
