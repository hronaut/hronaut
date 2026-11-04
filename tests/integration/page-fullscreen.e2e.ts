import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerEveryTrustedDialog } from './trusted-dialog-fixture.js'

const TITLE = 'Fullscreen video'

async function openVideoPage(
  appWindow: Page,
  electronApp: ElectronApplication,
  path = ''
): Promise<{ server: ReturnType<typeof createServer>, origin: string }> {
  const video = '<video id="video" style="width:320px;height:180px;background:#000"></video>'
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url === '/popup'
      ? '<!doctype html><title>Popup</title>'
      : request.url === '/player'
        ? `<!doctype html><title>${TITLE}</title><div id="player">${video}</div>`
        : `<!doctype html><title>${TITLE}</title>${video}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, active: true })`)
  await expect.poll(() => electronApp.evaluate(({ webContents }, title) => (
    webContents.getAllWebContents().some((contents) => contents.getTitle() === title && !contents.isLoading())
  ), TITLE)).toBe(true)
  // The person allows the site's full screen request.
  await answerEveryTrustedDialog(appWindow, 'Allow')
  return { server, origin }
}

/** The video page's view bounds, the window's content size and whether the window and the page are in full screen. */
function fullscreenState(electronApp: ElectronApplication) {
  return electronApp.evaluate(async ({ BrowserWindow }, title) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!
    const view = window.contentView.children.find((child) => {
      const contents = (child as Electron.WebContentsView).webContents
      return contents && !contents.isDestroyed() && contents.getTitle() === title
    }) as Electron.WebContentsView | undefined
    const content = window.getContentBounds()
    return {
      windowFullScreen: window.isFullScreen(),
      content: { width: content.width, height: content.height },
      view: view?.getBounds() ?? null,
      pageFullscreen: view ? await view.webContents.executeJavaScript('Boolean(document.fullscreenElement)') as boolean : null
    }
  }, TITLE)
}

function videoTabId(appWindow: Page): Promise<string> {
  return appWindow.evaluate(
    `window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === ${JSON.stringify(TITLE)}).id)`
  ) as Promise<string>
}

function requestFullscreen(electronApp: ElectronApplication, elementId = 'video'): Promise<string> {
  return electronApp.evaluate(async ({ webContents }, { title, elementId }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!
    return page.executeJavaScript(
      `document.getElementById(${JSON.stringify(elementId)}).requestFullscreen().then(() => "entered", (error) => error.name)`,
      true
    ) as Promise<string>
  }, { title: TITLE, elementId })
}

test('gives a video in full screen the whole window and puts the page back in its card when it leaves', async ({
  appWindow,
  electronApp
}) => {
  // The window went full screen, but the page stayed in its card beside the tabs and under the toolbar.
  const { server } = await openVideoPage(appWindow, electronApp)
  try {
    const before = await fullscreenState(electronApp)
    expect(before.view).not.toEqual({ x: 0, y: 0, ...before.content })
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => {
      const state = await fullscreenState(electronApp)
      return state.windowFullScreen && JSON.stringify(state.view) === JSON.stringify({ x: 0, y: 0, ...state.content })
    }, { message: 'the page fills the window in full screen' }).toBe(true)
    await electronApp.evaluate(async ({ webContents }, title) => {
      await webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!
        .executeJavaScript('document.exitFullscreen()')
    }, TITLE)
    await expect.poll(() => fullscreenState(electronApp)).toEqual(before)
  } finally {
    await closeFixtureServer(server)
  }
})

test('takes a page out of full screen when another tab is selected', async ({ appWindow, electronApp }) => {
  // The window stayed in full screen over the new tab, and the hidden page kept its full screen.
  const { server } = await openVideoPage(appWindow, electronApp)
  try {
    const before = await fullscreenState(electronApp)
    const tabId = await videoTabId(appWindow)
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)
    await appWindow.evaluate("window.hronaut.newTab({ url: 'about:blank', active: true })")
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!.isFullScreen()
    ))).toBe(false)
    // Back on the video, the page is in its card and no longer in full screen.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await expect.poll(() => fullscreenState(electronApp)).toEqual(before)
  } finally {
    await closeFixtureServer(server)
  }
})

test('takes a page out of every full screen it nested when another tab is selected', async ({ appWindow, electronApp }) => {
  // Leaving took only the video out of full screen, inside a player that stayed in it, so the window stayed in full
  // screen over the new tab.
  const { server } = await openVideoPage(appWindow, electronApp, '/player')
  try {
    const before = await fullscreenState(electronApp)
    const tabId = await videoTabId(appWindow)
    expect(await requestFullscreen(electronApp, 'player')).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)
    expect(await requestFullscreen(electronApp, 'video')).toBe('entered')
    await appWindow.evaluate("window.hronaut.newTab({ url: 'about:blank', active: true })")
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!.isFullScreen()
    ))).toBe(false)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await expect.poll(() => fullscreenState(electronApp)).toEqual(before)
  } finally {
    await closeFixtureServer(server)
  }
})

test('keeps a page in full screen when the split pane it hides opens a window', async ({ appWindow, electronApp }) => {
  // The hidden pane's window took the view, which ended the split view and the full screen the person was watching.
  const { server, origin } = await openVideoPage(appWindow, electronApp)
  try {
    const tabId = await videoTabId(appWindow)
    const paneUrl = 'data:text/html,<title>Hidden pane</title>'
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(paneUrl)}, active: false })`)
    await expect.poll(() => appWindow.evaluate("window.hronaut.getState().then((state) => state.tabs.some((tab) => tab.title === 'Hidden pane'))")).toBe(true)
    const paneId = await appWindow.evaluate("window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === 'Hidden pane').id)") as string
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(paneId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => Boolean(state.splitView))')).toBe(true)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)

    // The hidden pane's page opens a window on its own, such as from a timer.
    await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Hidden pane')!
        .executeJavaScript(`window.open(${JSON.stringify(url)}); true`)
    }, `${origin}/popup`)
    await expect.poll(() => appWindow.evaluate("window.hronaut.getState().then((state) => state.tabs.some((tab) => tab.title === 'Popup'))")).toBe(true)
    // It opens behind: the video stays in full screen and the split view stays.
    expect(await appWindow.evaluate('window.hronaut.getState().then((state) => ({ active: state.activeTabId, split: Boolean(state.splitView) }))'))
      .toEqual({ active: tabId, split: true })
    expect(await fullscreenState(electronApp)).toMatchObject({ windowFullScreen: true, pageFullscreen: true })
  } finally {
    await closeFixtureServer(server)
  }
})

test('takes the window out of full screen when the page in full screen closes', async ({ appWindow, electronApp }) => {
  // Electron never reports that a closed page left full screen, so the window stayed in full screen showing Home.
  const { server } = await openVideoPage(appWindow, electronApp)
  try {
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)
    const tabId = await videoTabId(appWindow)
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!.isFullScreen()
    ))).toBe(false)
  } finally {
    await closeFixtureServer(server)
  }
})

test('takes a page out of full screen when a browser shortcut opens the address field', async ({ appWindow, electronApp }) => {
  // Ctrl/Cmd+L focused the address field and opened its suggestions behind the page in full screen.
  const { server } = await openVideoPage(appWindow, electronApp)
  try {
    const before = await fullscreenState(electronApp)
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)
    await electronApp.evaluate(({ webContents }, title) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!
      page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
    }, TITLE)
    await expect.poll(() => fullscreenState(electronApp)).toEqual(before)
    await expect(appWindow.getByRole('combobox', { name: 'Address' })).toBeFocused()
  } finally {
    await closeFixtureServer(server)
  }
})

test('keeps the window out of full screen for a page in a tab it does not show, and the page in its card', async ({ appWindow, electronApp }) => {
  // Electron put the window in full screen for a page in any tab, so a page in a tab the person did not see, such as one
  // an agent clicked in, put the person's window in full screen and straight back.
  const { server } = await openVideoPage(appWindow, electronApp)
  try {
    const tabId = await videoTabId(appWindow)
    const inCard = await fullscreenState(electronApp)
    // The person allows the site full screen once, so its later requests need no prompt.
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)
    await electronApp.evaluate(async ({ webContents }, title) => {
      await webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!.executeJavaScript('document.exitFullscreen()')
    }, TITLE)
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(false)
    await appWindow.evaluate("window.hronaut.newTab({ url: 'about:blank', active: true })")
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId !== ${JSON.stringify(tabId)})`)).toBe(true)

    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!
      const record = globalThis as { fullScreenChanges?: string[], noteFullScreen?: () => void }
      record.fullScreenChanges = []
      record.noteFullScreen = () => { record.fullScreenChanges!.push(window.isFullScreen() ? 'entered' : 'left') }
      window.on('enter-full-screen', record.noteFullScreen)
      window.on('leave-full-screen', record.noteFullScreen)
    })
    const windowChanges = () => electronApp.evaluate(({ BrowserWindow }) => ({
      windowFullScreen: BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!.isFullScreen(),
      changes: (globalThis as { fullScreenChanges?: string[] }).fullScreenChanges
    }))
    try {
      // The request is kept to see how it ends: Chromium answers a page out of view once the page is shown.
      await electronApp.evaluate(async ({ webContents }, title) => {
        await webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!.executeJavaScript(`
          window.fullscreenAnswer = 'none'
          document.getElementById('video').requestFullscreen().then(() => { window.fullscreenAnswer = 'entered' }, (error) => { window.fullscreenAnswer = error.name })
          true
        `, true)
      }, TITLE)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await windowChanges()).toEqual({ windowFullScreen: false, changes: [] })

      // Shown, the page gets the full screen Chromium kept for it and leaves it at once, in its card.
      await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, title) => (
        webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!.executeJavaScript('window.fullscreenAnswer')
      ), TITLE)).toBe('entered')
      await expect.poll(() => fullscreenState(electronApp)).toEqual(inCard)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await windowChanges()).toEqual({ windowFullScreen: false, changes: [] })
    } finally {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!
        const record = globalThis as { noteFullScreen?: () => void }
        window.removeListener('enter-full-screen', record.noteFullScreen!)
        window.removeListener('leave-full-screen', record.noteFullScreen!)
      })
    }

    // The page the window shows takes the window's full screen as before.
    expect(await requestFullscreen(electronApp)).toBe('entered')
    await expect.poll(async () => (await fullscreenState(electronApp)).windowFullScreen).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
