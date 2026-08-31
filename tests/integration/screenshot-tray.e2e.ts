import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('keeps a tab visible when it is selected during an offscreen capture', async ({
  appWindow,
  electronApp
}) => {
  const targetUrl = 'data:text/html,<title>Offscreen capture target</title><main>Target</main>'
  const otherUrl = 'data:text/html,<title>Offscreen capture current</title><main>Current</main>'
  const targetState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(targetUrl)}, active: true })`) as {
    activeTabId: string
  }
  const targetTabId = targetState.activeTabId
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(otherUrl)}, active: true })`)
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().some((contents) => contents.getURL() === url)
  ), targetUrl)).toBe(true)
  const shellWindowId = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id)

  await electronApp.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
    if (!contents) throw new Error('Offscreen capture target was not found')
    const globals = globalThis as typeof globalThis & {
      __offscreenCaptureStarted?: boolean
      __releaseOffscreenCapture?: () => void
    }
    let releaseCapture = (): void => undefined
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve })
    const originalCapturePage = contents.capturePage.bind(contents)
    globals.__offscreenCaptureStarted = false
    globals.__releaseOffscreenCapture = releaseCapture
    contents.capturePage = async (...args: Parameters<Electron.WebContents['capturePage']>) => {
      contents.capturePage = originalCapturePage
      globals.__offscreenCaptureStarted = true
      await captureGate
      return originalCapturePage(...args)
    }
  }, targetUrl)

  const pendingCapture = appWindow.evaluate(`window.hronaut.capturePage({ tabId: ${JSON.stringify(targetTabId)} })`)
  try {
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __offscreenCaptureStarted?: boolean }).__offscreenCaptureStarted
    ))).toBe(true)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(targetTabId)})`)
  } finally {
    await electronApp.evaluate(() => {
      const globals = globalThis as typeof globalThis & { __releaseOffscreenCapture?: () => void }
      globals.__releaseOffscreenCapture?.()
      delete globals.__releaseOffscreenCapture
    })
  }
  await pendingCapture

  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(targetTabId)
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView, webContents }, input) => {
    const shellWindow = BrowserWindow.getAllWindows().find((window) => window.id === input.shellWindowId)
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === input.targetUrl)
    if (!shellWindow || !target) return false
    return shellWindow.contentView.children.some((child) => (
      child instanceof WebContentsView && child.webContents.id === target.id
    ))
  }, { shellWindowId, targetUrl })).toBe(true)
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length
  ))).toBe(1)
})

test('captures hidden pages and survives tab teardown during offscreen rendering', async ({
  electronApp,
  mcpToken,
  mcpPort,
  profileDirectory
}) => {
  const authorization = `Bearer ${mcpToken}`
  const client = new Client({ name: 'hronaut-tray-screenshot-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })

  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Screenshot tray tests')
    const status = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    const tabId = JSON.parse(text(status)).activeTabId as string

    await electronApp.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === 'about:blank')
      if (!contents) throw new Error('Hidden screenshot tab was not found')
      const originalBeginFrameSubscription = contents.beginFrameSubscription.bind(contents)
      const originalEndFrameSubscription = contents.endFrameSubscription.bind(contents)
      const originalCapturePage = contents.capturePage.bind(contents)
      let subscriptionActive = false
      contents.beginFrameSubscription = ((
        ...args: [boolean, (image: Electron.NativeImage, dirtyRect: Electron.Rectangle) => void]
          | [(image: Electron.NativeImage, dirtyRect: Electron.Rectangle) => void]
      ) => {
        contents.beginFrameSubscription = originalBeginFrameSubscription
        subscriptionActive = true
        // Chromium can present a valid offscreen surface without delivering the
        // first subscribed callback under renderer pressure. Keep the real
        // subscription active while deliberately dropping its notification.
        if (typeof args[0] === 'boolean') originalBeginFrameSubscription(args[0], () => undefined)
        else originalBeginFrameSubscription(() => undefined)
      }) as Electron.WebContents['beginFrameSubscription']
      contents.endFrameSubscription = (() => {
        contents.endFrameSubscription = originalEndFrameSubscription
        subscriptionActive = false
        originalEndFrameSubscription()
      }) as Electron.WebContents['endFrameSubscription']
      contents.capturePage = (async (...args: Parameters<Electron.WebContents['capturePage']>) => {
        if (subscriptionActive) return new Promise<Electron.NativeImage>(() => undefined)
        contents.capturePage = originalCapturePage
        return originalCapturePage(...args)
      }) as Electron.WebContents['capturePage']
    })

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false)

    for (const fullPage of [false, true]) {
      if (fullPage) {
        await electronApp.evaluate(({ webContents }) => {
          const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === 'about:blank')
          if (!contents) throw new Error('Hidden screenshot tab was not found')
          const globals = globalThis as typeof globalThis & {
            __fullPageBeganFrameSubscription?: boolean
            __restoreFullPageBeginFrameSubscription?: () => void
          }
          const originalBeginFrameSubscription = contents.beginFrameSubscription.bind(contents)
          globals.__fullPageBeganFrameSubscription = false
          globals.__restoreFullPageBeginFrameSubscription = () => {
            contents.beginFrameSubscription = originalBeginFrameSubscription
          }
          contents.beginFrameSubscription = ((...args: Parameters<Electron.WebContents['beginFrameSubscription']>) => {
            globals.__fullPageBeganFrameSubscription = true
            return originalBeginFrameSubscription(...args)
          }) as Electron.WebContents['beginFrameSubscription']
        })
      }
      const screenshot = await client.callTool({
        name: 'browser_screenshot',
        arguments: { tabId, fullPage }
      }) as CallToolResult
      if (fullPage) {
        const beganFrameSubscription = await electronApp.evaluate(() => {
          const globals = globalThis as typeof globalThis & {
            __fullPageBeganFrameSubscription?: boolean
            __restoreFullPageBeginFrameSubscription?: () => void
          }
          const began = globals.__fullPageBeganFrameSubscription === true
          globals.__restoreFullPageBeginFrameSubscription?.()
          delete globals.__fullPageBeganFrameSubscription
          delete globals.__restoreFullPageBeginFrameSubscription
          return began
        })
        expect(beganFrameSubscription).toBe(false)
      }
      expect(screenshot.isError, `${fullPage ? 'full page' : 'viewport'}: ${text(screenshot)}`).not.toBe(true)
      const image = screenshot.content.find((item) => item.type === 'image')
      expect(image?.type).toBe('image')
      if (image?.type === 'image') {
        const png = Buffer.from(image.data, 'base64')
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        expect(png.readUInt32BE(16)).toBeGreaterThan(0)
        expect(png.readUInt32BE(20)).toBeGreaterThan(0)
      }
    }
    for (const fullPage of [false, true]) {
      const screenshot = await client.callTool({
        name: 'browser_screenshot',
        arguments: { tabId, fullPage, format: 'jpeg', quality: 65, maxWidth: 480, maxHeight: 320 }
      }) as CallToolResult
      expect(screenshot.isError, `${fullPage ? 'full page' : 'viewport'} JPEG: ${text(screenshot)}`).not.toBe(true)
      const image = screenshot.content.find((item) => item.type === 'image')
      expect(image).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
      if (image?.type === 'image') {
        const jpeg = Buffer.from(image.data, 'base64')
        expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
        const size = await electronApp.evaluate(({ nativeImage }, data) => (
          nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize()
        ), image.data)
        expect(size.width).toBeGreaterThan(0)
        expect(size.height).toBeGreaterThan(0)
        expect(size.width).toBeLessThanOrEqual(480)
        expect(size.height).toBeLessThanOrEqual(320)
      }
    }
    const cropped = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, clip: { x: 0, y: 0, width: 128, height: 64 } }
    }) as CallToolResult
    expect(cropped.isError, `hidden cropped PNG: ${text(cropped)}`).not.toBe(true)
    const croppedImage = cropped.content.find((item) => item.type === 'image')
    expect(croppedImage).toMatchObject({ type: 'image', mimeType: 'image/png' })
    if (croppedImage?.type === 'image') {
      const png = Buffer.from(croppedImage.data, 'base64')
      expect(png.readUInt32BE(16)).toBe(128)
      expect(png.readUInt32BE(20)).toBe(64)
    }
    const invalidQuality = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, format: 'png', quality: 50 }
    }) as CallToolResult
    expect(invalidQuality.isError).toBe(true)
    expect(text(invalidQuality)).toContain('supported only for JPEG')
    const pdf = await client.callTool({
      name: 'browser_pdf_save',
      arguments: { tabId, filename: 'tray-hidden.pdf' }
    }) as CallToolResult
    expect(pdf.isError, text(pdf)).not.toBe(true)
    expect(JSON.parse(text(pdf))).toMatchObject({
      filename: 'tray-hidden.pdf',
      path: join(profileDirectory, 'tray-hidden.pdf')
    })
    expect((await readFile(join(profileDirectory, 'tray-hidden.pdf'))).subarray(0, 5).toString()).toBe('%PDF-')
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false)

    const comparison = client.callTool({
      name: 'browser_visual_compare',
      arguments: { tabId, action: 'set-baseline', settleMs: 2_000 }
    }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length
    ))).toBe(2)
    const shellWindow = await electronApp.firstWindow()
    await shellWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
    const closedDuringCapture = await comparison
    expect(closedDuringCapture.isError).toBe(true)
    expect(text(closedDuringCapture)).toContain('tab closed while rendering its page')
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length
    ))).toBe(1)

    const recoveryTabId = await shellWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: true }).then((state) => state.activeTabId)`)
    await shellWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(recoveryTabId)})`)
    await expect.poll(() => shellWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.some((tab) => tab.id === ' + JSON.stringify(recoveryTabId) + '))')).toBe(false)
  } finally {
    await client.close().catch(() => undefined)
  }
})
