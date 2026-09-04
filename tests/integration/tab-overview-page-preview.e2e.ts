import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const fixtureUrl = (name: string) => `data:text/html,${encodeURIComponent(`<!doctype html><title>${name}</title><style>body{margin:0}main{height:2400px;background:linear-gradient(#15803d,#4338ca)}</style><main>${name}</main>`)}`

async function openFixture(window: Page, name = 'Full-page preview target', url = fixtureUrl(name)) {
  const state = await window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
  const id = state.tabs.find(tab => tab.url === url)!.id
  await expect.poll(() => window.evaluate(`window.hronaut.getState().then(state => { const tab = state.tabs.find(tab => tab.id === ${JSON.stringify(id)}); return { title: tab?.title, loading: tab?.loading }; })`)).toEqual({ title: name, loading: false })
  return { id, url }
}

async function holdCapture(app: ElectronApplication, url: string) {
  await app.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const original = contents.debugger.sendCommand.bind(contents.debugger)
    const gate = { started: false, calls: 0, release: undefined as (() => void) | undefined }
    ;(globalThis as typeof globalThis & { __pagePreviewGate?: typeof gate }).__pagePreviewGate = gate
    contents.debugger.sendCommand = async (...args: Parameters<typeof contents.debugger.sendCommand>) => {
      const result = await original(...args)
      if (args[0] === 'Page.captureScreenshot') {
        gate.calls += 1
        if (!gate.started) {
          gate.started = true
          await new Promise<void>(resolve => { gate.release = resolve })
        }
      }
      return result
    }
  }, url)
}

async function releaseCapture(app: ElectronApplication) {
  await app.evaluate(() => {
    ;(globalThis as typeof globalThis & { __pagePreviewGate?: { release?: () => void } }).__pagePreviewGate?.release?.()
  })
}

async function startCapture(window: Page, id: string) {
  await window.evaluate(`void (globalThis.__pagePreviewResult = window.hronaut.getTabOverviewPagePreview(${JSON.stringify(id)}).then(preview => ({ preview }), error => ({ error: error.message })))`)
}

async function waitForCapture(app: ElectronApplication) {
  await expect.poll(() => app.evaluate(() => (
    globalThis as typeof globalThis & { __pagePreviewGate?: { started: boolean } }
  ).__pagePreviewGate?.started)).toBe(true)
}

for (const change of ['navigation', 'close'] as const) {
  test(`rejects a full-page preview completed after tab ${change}`, async ({ appWindow, electronApp }) => {
    const initial = await openFixture(appWindow)
    const target = change === 'close' ? await openColdTarget(appWindow) : initial
    await holdCapture(electronApp, target.url)
    try {
      await startCapture(appWindow, target.id)
      await waitForCapture(electronApp)
      if (change === 'close') expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
      if (change === 'navigation') {
        await appWindow.evaluate(`window.hronaut.navigate({tabId:${JSON.stringify(target.id)},url:${JSON.stringify(fixtureUrl('Navigated page'))}})`)
        await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(target.id)})?.title)`)).toBe('Navigated page')
      } else {
        await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(target.id)})`)
      }
      await releaseCapture(electronApp)
      const result = await appWindow.evaluate('globalThis.__pagePreviewResult') as { error?: string }
      expect(result.error).toMatch(change === 'navigation' ? /page changed/i : /tab closed/i)
      if (change === 'close') expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    } finally { await releaseCapture(electronApp) }
  })
}

test('times out full-page preview without piling up retries or detaching the tab debugger', async ({ appWindow, electronApp }) => {
  const target = await openFixture(appWindow)
  await holdCapture(electronApp, target.url)
  try {
    await startCapture(appWindow, target.id)
    await waitForCapture(electronApp)
    const result = await appWindow.evaluate('globalThis.__pagePreviewResult') as { error?: string }
    expect(result.error).toMatch(/timed out/i)
    await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/timed out/i)
    expect(await electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __pagePreviewGate?: { calls: number } }
    ).__pagePreviewGate?.calls)).toBe(1)
    expect(await electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().find(contents => contents.getURL() === url)?.debugger.isAttached()
    ), target.url)).toBe(true)
    await releaseCapture(electronApp)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)}).then(preview => preview.height, () => 0)`)).toBeGreaterThan(1000)
  } finally { await releaseCapture(electronApp) }
})

test('rejects sleeping and closed full-page preview targets without waking or selecting them', async ({ appWindow }) => {
  const server = createServer((_request, response) => response.end('<!doctype html><title>Sleep preview target</title><p>Page preview</p>'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Sleep fixture did not expose its port')
  try {
    const target = await openFixture(appWindow, 'Sleep preview target', `http://127.0.0.1:${address.port}/sleep`)
    const selected = await openFixture(appWindow, 'Keep selected')
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(target.id)}, true)`)
    await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/wake this tab/i)
    expect(await appWindow.evaluate(`window.hronaut.getState().then(state => ({ active: state.activeTabId, sleeping: state.tabs.find(tab => tab.id === ${JSON.stringify(target.id)})?.sleeping }))`)).toEqual({ active: selected.id, sleeping: true })
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(target.id)})`)
    await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/tab not found/i)
  } finally { await closeFixtureServer(server) }
})

test('leaves Developer Tools ownership intact when full-page preview is unavailable', async ({ appWindow, electronApp }) => {
  const target = await openFixture(appWindow)
  await electronApp.evaluate(({ webContents }, url) => {
    webContents.getAllWebContents().find(contents => contents.getURL() === url)!.openDevTools({ mode: 'detach', activate: false })
  }, target.url)
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().find(contents => contents.getURL() === url)?.isDevToolsOpened()
  ), target.url)).toBe(true)
  await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/close developer tools/i)
  expect(await electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().find(contents => contents.getURL() === url)?.isDevToolsOpened()
  ), target.url)).toBe(true)
})

test('validates full-page preview IDs before touching a tab', async ({ appWindow }) => {
  for (const invalid of [null, '', ' tab-1', 1, ['tab-1'], 'x'.repeat(129)]) {
    await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(invalid)})`)).rejects.toThrow(/invalid tab overview preview id/i)
  }
})

test('bounds full-page allocation before capture even when a page forges a tiny device pixel ratio', async ({ appWindow, electronApp }) => {
  const target = await openFixture(appWindow)
  await electronApp.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    await contents.executeJavaScript(`void Object.defineProperty(window, 'devicePixelRatio', {value:0.000001})`)
    const original = contents.debugger.sendCommand.bind(contents.debugger)
    contents.debugger.sendCommand = async (...args: Parameters<typeof contents.debugger.sendCommand>) => {
      if (args[0] === 'Page.getLayoutMetrics') return { cssContentSize: { x: 0, y: 0, width: 3000, height: 40000 } }
      if (args[0] === 'Page.captureScreenshot') {
        ;(globalThis as typeof globalThis & { __boundedPagePreviewClip?: unknown }).__boundedPagePreviewClip = args[1]?.clip
        throw new Error('Bounded capture inspected')
      }
      return original(...args)
    }
  }, target.url)
  await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/bounded capture inspected/i)
  const clip = await electronApp.evaluate(() => (
    globalThis as typeof globalThis & { __boundedPagePreviewClip?: { width: number; height: number; scale: number } }
  ).__boundedPagePreviewClip)
  expect(clip).toBeDefined()
  expect(clip!.width).toBe(3000)
  expect(clip!.height).toBe(40000)
  expect(clip!.scale).toBeLessThanOrEqual(0.3)
  expect(clip!.width * clip!.height * clip!.scale ** 2).toBeLessThanOrEqual(12_000_000)
})

test('rejects unsupported document sizes before allocating a full-page image', async ({ appWindow, electronApp }) => {
  const target = await openFixture(appWindow)
  await electronApp.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const original = contents.debugger.sendCommand.bind(contents.debugger)
    contents.debugger.sendCommand = async (...args: Parameters<typeof contents.debugger.sendCommand>) => {
      if (args[0] === 'Page.getLayoutMetrics') return { cssContentSize: { x: 0, y: 0, width: 1e12, height: 1e12 } }
      if (args[0] === 'Page.captureScreenshot') throw new Error('Unsafe screenshot allocation was attempted')
      return original(...args)
    }
  }, target.url)
  await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/supported full-page preview size/i)
})

test('captures a complete awake background page that was never selected without changing visible views', async ({ appWindow, electronApp }) => {
  const selected = await openFixture(appWindow, 'Keep this page selected')
  const html = '<!doctype html><title>Never selected preview</title><style>html,body{margin:0}main{width:1100px;height:2600px;background:#334155}header,footer{height:100px;background:#ef00ff}footer{background:#00eaff}section{height:2400px}</style><main><header>Top marker</header><section>Complete background page</section><footer>Bottom marker</footer></main>'
  const url = `data:text/html,${encodeURIComponent(html)}`
  const state = await appWindow.evaluate(`window.hronaut.newTab({url:${JSON.stringify(url)},active:false})`) as BrowserState
  const target = state.tabs.find(tab => tab.url === url)!
  expect(state.activeTabId).toBe(selected.id)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => { const tab = state.tabs.find(tab => tab.id === ${JSON.stringify(target.id)}); return { title: tab?.title, loading: tab?.loading }; })`)).toEqual({ title: 'Never selected preview', loading: false })
  const readState = async () => ({
    active: await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)'),
    native: await electronApp.evaluate(async ({ BrowserWindow, webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return {
        windows: BrowserWindow.getAllWindows().map(window => ({
          id: window.id, visible: window.isVisible(), focused: window.isFocused(),
          children: window.contentView.children.map(child => ({ bounds: child.getBounds(), visible: child.getVisible() }))
        })),
        focused: webContents.getFocusedWebContents()?.id,
        page: await page.executeJavaScript('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY,visibility:document.visibilityState,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight})')
      }
    }, url)
  })
  const before = await readState()
  const preview = await appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`) as {
    width: number; height: number; dataUrl: string; navigationGeneration: number
  }
  expect(before.native.page.width).toBeGreaterThan(0)
  expect(before.native.page.height).toBeGreaterThan(0)
  expect(preview.height / preview.width).toBeCloseTo(before.native.page.documentHeight / before.native.page.documentWidth, 1)
  const pixels = await appWindow.evaluate(async dataUrl => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const sample = (y: number) => Array.from(context.getImageData(Math.floor(canvas.width / 2), y, 1, 1).data).slice(0, 3)
    return { top: sample(8), bottom: sample(canvas.height - 8) }
  }, preview.dataUrl)
  expect(pixels.top[0]).toBeGreaterThan(200)
  expect(pixels.top[1]).toBeLessThan(40)
  expect(pixels.top[2]).toBeGreaterThan(200)
  expect(pixels.bottom[0]).toBeLessThan(40)
  expect(pixels.bottom[1]).toBeGreaterThan(180)
  expect(pixels.bottom[2]).toBeGreaterThan(200)
  expect(await readState()).toEqual(before)
})

async function openColdTarget(window: Page) {
  const url = fixtureUrl('Cold capture race target')
  const state = await window.evaluate(`window.hronaut.newTab({url:${JSON.stringify(url)},active:false})`) as BrowserState
  const id = state.tabs.find(tab => tab.url === url)!.id
  await expect.poll(() => window.evaluate(`window.hronaut.getState().then(state => { const tab = state.tabs.find(tab => tab.id === ${JSON.stringify(id)}); return {title:tab?.title,loading:tab?.loading}; })`)).toEqual({ title: 'Cold capture race target', loading: false })
  return { id, url }
}

for (const resize of [false, true]) {
  test(`preserves cold preview selection and ${resize ? 'rejects a changed viewport' : 'finishes without a resize'} during capture`, async ({ appWindow, electronApp }) => {
    await openFixture(appWindow, 'Original selected page')
    const mainWindowId = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id)
    const target = await openColdTarget(appWindow)
    await holdCapture(electronApp, target.url)
    try {
      await startCapture(appWindow, target.id)
      await waitForCapture(electronApp)
      expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
      await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(target.id)})`)
      if (resize) await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.setSize(1040, 780), mainWindowId)
      const targetState = () => electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        return { focused: webContents.getFocusedWebContents()?.id, viewport: await page.executeJavaScript('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})') }
      }, target.url)
      if (resize) await expect.poll(async () => (await targetState()).viewport.width).toBe(1040)
      const selectedState = await targetState()
      await releaseCapture(electronApp)
      const result = await appWindow.evaluate('globalThis.__pagePreviewResult') as { error?: string }
      if (resize) expect(result.error).toMatch(/viewport changed.*try again/i)
      else expect(result.error).toBeUndefined()
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
      expect(await targetState()).toEqual(selectedState)
      expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(target.id)
      expect(await electronApp.evaluate(({ BrowserWindow, WebContentsView }, { id, url }) => {
        return BrowserWindow.fromId(id)!.contentView.children.some(child => child instanceof WebContentsView && child.webContents.getURL() === url && child.getVisible())
      }, { id: mainWindowId, url: target.url })).toBe(true)
    } finally { await releaseCapture(electronApp) }
  })
}

test('removes the cold offscreen host at the response deadline while retaining the in-flight capture slot', async ({ appWindow, electronApp }) => {
  const selected = await openFixture(appWindow, 'Original selected page')
  const target = await openColdTarget(appWindow)
  await holdCapture(electronApp, target.url)
  try {
    await startCapture(appWindow, target.id)
    await waitForCapture(electronApp)
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    const result = await appWindow.evaluate('globalThis.__pagePreviewResult') as { error?: string }
    expect(result.error).toMatch(/timed out/i)
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(selected.id)
    await expect(appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)})`)).rejects.toThrow(/timed out/i)
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally { await releaseCapture(electronApp) }
})


test('captures every edge of a real document at the twelve megapixel bound', async ({ appWindow, electronApp }) => {
  const name = 'Twelve megapixel page'
  const url = `data:text/html,${encodeURIComponent(`<!doctype html><title>${name}</title><style>html,body{margin:0}main{position:relative;width:1440px;height:9000px;background:#fff}i{position:absolute;width:80px;height:80px}i:nth-child(1){top:0;left:0;background:#f00}i:nth-child(2){top:0;right:0;background:#0f0}i:nth-child(3){bottom:0;left:0;background:#00f}i:nth-child(4){bottom:0;right:0;background:#ff0}</style><main><i></i><i></i><i></i><i></i></main>` )}`
  const target = await openFixture(appWindow, name, url)
  await electronApp.evaluate(({ webContents, nativeImage }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const original = page.debugger.sendCommand.bind(page.debugger)
    page.debugger.sendCommand = async (...args: Parameters<typeof page.debugger.sendCommand>) => {
      const result = await original(...args)
      if (args[0] === 'Page.captureScreenshot') {
        const actual = nativeImage.createFromBuffer(Buffer.from(result.data, 'base64')).getSize()
        ;(globalThis as typeof globalThis & { __captureDimensions?: typeof actual }).__captureDimensions = actual
      }
      return result
    }
  }, url)
  const outcome = await appWindow.evaluate(`window.hronaut.getTabOverviewPagePreview(${JSON.stringify(target.id)}).then(preview => ({preview}), error => ({error: error.message}))`) as { preview?: { width: number; height: number; dataUrl: string }; error?: string }
  const dimensions = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __captureDimensions?: {width:number;height:number} }).__captureDimensions)
  expect(outcome.error, JSON.stringify(dimensions)).toBeUndefined()
  const preview = outcome.preview!
  expect(preview.width * preview.height).toBeLessThanOrEqual(12_000_000)
  expect(preview.width * preview.height).toBeGreaterThan(11_900_000)
  const corners = await appWindow.evaluate(async dataUrl => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [[8, 8], [canvas.width - 8, 8], [8, canvas.height - 8], [canvas.width - 8, canvas.height - 8]].map(([x, y]) => Array.from(context.getImageData(x!, y!, 1, 1).data).slice(0, 3).map(channel => channel > 128 ? 255 : 0))
  }, preview.dataUrl)
  expect(corners).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]])
})
