import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A 128x72 VP9 video, shown at 320x180.
const CLIP = readFileSync(fileURLToPath(new URL('../fixtures/first-frame/red-green.webm', import.meta.url)))

test('keeps a tab showing a video in picture-in-picture awake, as Chrome does, and lets it sleep once the video comes back', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    if (request.url === '/clip.webm') {
      response.writeHead(200, { 'content-type': 'video/webm', 'content-length': CLIP.length }).end(CLIP)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>Picture in picture fixture</title><video id="video" muted preload="auto" src="/clip.webm" style="width:320px;height:180px"></video>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/watch`
  // Runs a script in the fixture's page, with the person's click when asked.
  const inPage = (code: string, userGesture = false) => electronApp.evaluate(({ webContents }, { url, code, userGesture }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    return page ? page.executeJavaScript(code, userGesture) as Promise<unknown> : null
  }, { url, code, userGesture })
  const sleep = (tabId: string) => appWindow.evaluate(async (tabId) => {
    try {
      await (window as unknown as { hronaut: { setTabSleeping(tabId: string, sleeping: boolean): Promise<unknown> } }).hronaut.setTabSleeping(tabId, true)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, tabId)
  const sleeping = (tabId: string) => appWindow.evaluate(async (tabId) => (await (window as unknown as { hronaut: { getState(): Promise<{ tabs: Array<{ id: string; sleeping?: boolean }> }> } }).hronaut.getState())
    .tabs.find(tab => tab.id === tabId)?.sleeping, tabId)
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Picture in picture fixture/ })).toBeVisible()
    const tabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.id)') as string
    await expect.poll(() => inPage('document.querySelector("#video").readyState')).toBeGreaterThanOrEqual(1)
    expect(await inPage('document.querySelector("#video").requestPictureInPicture().then(() => true)', true)).toBe(true)

    await appWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).not.toBe(tabId)
    // Sleeping replaced the page, which closed the video's picture-in-picture window.
    expect(await sleep(tabId)).toContain('picture-in-picture')
    expect(await sleeping(tabId)).toBe(false)
    expect(await inPage('document.pictureInPictureElement === document.querySelector("#video")')).toBe(true)

    await inPage('document.exitPictureInPicture().then(() => true)')
    await expect.poll(() => inPage('document.pictureInPictureElement === null')).toBe(true)
    expect(await sleep(tabId)).toBeNull()
    await expect.poll(() => sleeping(tabId)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})

test('keeps a tab awake while a player embedded from another site shows its video in picture-in-picture', async ({ appWindow, electronApp }) => {
  // The page and its player come from different sites, as an embedded video does, so the player runs in a frame of its own.
  const server = createServer((request, response) => {
    if (request.url === '/clip.webm') {
      response.writeHead(200, { 'content-type': 'video/webm', 'content-length': CLIP.length }).end(CLIP)
      return
    }
    if (request.url === '/player') {
      response.writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><video id="video" muted preload="auto" src="/clip.webm" style="width:320px;height:180px"></video>')
      return
    }
    const port = (server.address() as { port: number }).port
    response.writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><title>Embedded player fixture</title><iframe src="http://localhost:${port}/player" width="360" height="220"></iframe>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/watch`
  // Runs a script in the embedded player's frame, with the person's click when asked.
  const inPlayer = (code: string, userGesture = false) => electronApp.evaluate(({ webContents }, { url, code, userGesture }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    const player = page?.mainFrame.frames.find(frame => frame.url.endsWith('/player'))
    return player ? player.executeJavaScript(code, userGesture) as Promise<unknown> : null
  }, { url, code, userGesture })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Embedded player fixture/ })).toBeVisible()
    const tabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.id)') as string
    await expect.poll(() => inPlayer('document.querySelector("#video").readyState')).toBeGreaterThanOrEqual(1)
    expect(await inPlayer('document.querySelector("#video").requestPictureInPicture().then(() => true)', true)).toBe(true)

    await appWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).not.toBe(tabId)
    const error = await appWindow.evaluate(async (tabId) => {
      try {
        await (window as unknown as { hronaut: { setTabSleeping(tabId: string, sleeping: boolean): Promise<unknown> } }).hronaut.setTabSleeping(tabId, true)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, tabId)
    expect(error).toContain('picture-in-picture')
    expect(await inPlayer('document.pictureInPictureElement === document.querySelector("#video")')).toBe(true)
    await inPlayer('document.exitPictureInPicture().then(() => true)')
  } finally {
    await closeFixtureServer(server)
  }
})
