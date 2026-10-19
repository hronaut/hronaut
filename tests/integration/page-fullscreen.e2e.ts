import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

const TITLE = 'Fullscreen video'

async function openVideoPage(appWindow: Page, electronApp: ElectronApplication): Promise<{ server: ReturnType<typeof createServer> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${TITLE}</title><video id="video" style="width:320px;height:180px;background:#000"></video>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
  await expect.poll(() => electronApp.evaluate(({ webContents }, title) => (
    webContents.getAllWebContents().some((contents) => contents.getTitle() === title && !contents.isLoading())
  ), TITLE)).toBe(true)
  // The person allows the site's full screen request.
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  return { server }
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

function requestFullscreen(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ webContents }, title) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!
    return page.executeJavaScript(
      'document.getElementById("video").requestFullscreen().then(() => "entered", (error) => error.name)',
      true
    ) as Promise<string>
  }, TITLE)
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
