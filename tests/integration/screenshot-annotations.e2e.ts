import { writeFile } from 'node:fs/promises'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import type { ScreenshotAnnotationReport } from '../../src/shared/screenshot-annotations.js'
import { test as base, expect, text } from './capability-fixtures.js'
import { closeHronaut, launchHronaut } from './fixtures.js'

const test = base.extend<{ displayScale: number }>({
  displayScale: [1, { option: true }],
  electronApp: async ({ profileDirectory, mcpPort, displayScale }, use) => {
    const instance = await launchHronaut(profileDirectory, mcpPort, 1, [], [`--force-device-scale-factor=${displayScale}`])
    try { await use(instance.app) } finally { await closeHronaut(instance.app) }
  }
})

for (const displayScale of [1, 2]) test.describe(`annotated viewport at native scale ${displayScale}`, () => {
  test.use({ displayScale })
  test('labels selected refs at zoom, DPR, scroll and output scale without changing page state', async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return result
    }
    const page = electronApp.context().pages().find(page => page.url() === fixtureUrl)!
    await page.setContent('<style>body{margin:0;height:2200px}button{position:absolute;width:120px;height:60px;background:blue;border:0;color:blue}#target{left:80px;top:160px}#other{left:260px;top:160px}#offscreen{top:2000px}#partial{left:-20px;top:250px}#hidden{top:340px}</style><div role="dialog"><button id="target">Repeated private-canary</button><button id="other">Repeated private-canary</button></div><button id="offscreen">Offscreen</button><button id="partial">Partial</button><button id="hidden">Hidden later</button><div contenteditable="true">private-editor-canary</div><input value="private-form-canary">')
    for (const dpr of [1, 2]) for (const zoom of [100, 125]) {
      await call('browser_emulate', { viewport: { width: 800, height: 600, deviceScaleFactor: dpr, mobile: false, touch: false, orientation: 'portrait' } })
      await call('browser_zoom', { action: 'set', percent: zoom })
      await page.evaluate(() => scrollTo(0, 40))
      await call('browser_snapshot')
      const refs = await page.locator('#target,#other,#offscreen,#partial,#hidden,[contenteditable]').evaluateAll(elements => elements.map(element => element.getAttribute('data-hronaut-ref')!))
      expect(refs.every(ref => /^e\d+$/.test(ref))).toBe(true)
      await page.locator('#hidden').evaluate(element => (element as HTMLElement).style.display = 'none')
      const state = () => page.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.tagName, x: scrollX, y: scrollY }))
      const before = await state()
      const selected = await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')
      const ordinary = await call('browser_screenshot', { maxWidth: 400 })
      expect(ordinary.content.every(item => item.type === 'image')).toBe(true)
      const result = await call('browser_screenshot', { annotateRefs: [refs[0], refs[2], refs[3], refs[4], refs[5], 'e999999'], maxWidth: 400 })
      expect(text(result)).not.toBe('')
      const report = JSON.parse(text(result)) as ScreenshotAnnotationReport
      expect(report).toMatchObject({ scope: 'viewport', width: 400, height: 300 })
      const target = report.annotations[0]!
      expect(target.status).toBe('labeled')
      expect(target.bounds).toEqual({ x: 40 * zoom / 100, y: 60 * zoom / 100, width: 60 * zoom / 100, height: Math.ceil(30 * zoom / 100) })
      expect(report.annotations.map(row => row.status)).toEqual(['labeled', 'offscreen', 'labeled', 'hidden', 'unsupported', 'missing'])
      expect(report.annotations[2]!.clipped).toBe(true)
      expect(report.annotations.some(row => row.ref === refs[1])).toBe(false)
      expect(text(result)).not.toMatch(/private-canary|private-editor-canary|private-form-canary/)
      expect(await state()).toEqual(before)
      expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(selected)
      const image = result.content.find(item => item.type === 'image')!
      if (image.type !== 'image') throw new Error('Missing image')
      expect(await electronApp.evaluate(({ nativeImage }, { data, x, y, centerX, centerY }) => {
        const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
        return { center: image.crop({ x: centerX, y: centerY, width: 1, height: 1 }).toBitmap({ scaleFactor: 1 }).toString('hex'), size: image.getSize(), outline: image.crop({ x, y, width: 1, height: 1 }).toBitmap({ scaleFactor: 1 }).toString('hex') }
      }, { data: image.data, x: target.bounds!.x, y: target.bounds!.y, centerX: Math.floor(target.bounds!.x + target.bounds!.width / 2), centerY: Math.floor(target.bounds!.y + target.bounds!.height / 2) })).toEqual({ size: { width: 400, height: 300 }, outline: '00dcffff', center: 'ff0000ff' })
      await writeFile(testInfo.outputPath(`labels-${dpr}-${zoom}.png`), Buffer.from(image.data, 'base64'))
      await page.locator('#hidden').evaluate(element => (element as HTMLElement).style.display = '')
    }
    const ref = await page.locator('#target').getAttribute('data-hronaut-ref')
    const foreground = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
    expect(JSON.parse(text(await call('browser_screenshot', { annotateRefs: [ref] }))).annotations[0].status).toBe('labeled')
    expect(await appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(foreground.activeTabId)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
    await call('browser_code_coverage', { action: 'start', reload: false })
    expect(JSON.parse(text(await call('browser_screenshot', { annotateRefs: [ref] }))).annotations[0].status).toBe('labeled')
    await call('browser_code_coverage', { action: 'stop' })
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.openDevTools({ mode: 'detach' }), fixtureUrl)
    try {
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.isDevToolsOpened(), fixtureUrl)).toBe(true)
      expect(JSON.parse(text(await call('browser_screenshot', { annotateRefs: [ref] }))).annotations[0].status).toBe('labeled')
      expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.isDevToolsOpened(), fixtureUrl)).toBe(true)
    } finally {
      await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)?.closeDevTools(), fixtureUrl)
    }
    await page.locator('#target').evaluate(node => { const clone = node.cloneNode(true) as Element; clone.id = 'duplicate'; node.after(clone) })
    expect(JSON.parse(text(await call('browser_screenshot', { annotateRefs: [ref] }))).annotations[0].status).toBe('ambiguous')
    await page.locator('#duplicate').evaluate(node => node.remove())
    const jpeg = await call('browser_screenshot', { annotateRefs: [ref], format: 'jpeg', quality: 70 })
    expect(jpeg.content.some(item => item.type === 'image' && item.mimeType === 'image/jpeg')).toBe(true)
    for (const extra of [{ fullPage: true }, { clip: { x: 0, y: 0, width: 50, height: 50 } }, { selector: '#target' }]) {
      const rejected = await client.callTool({ name: 'browser_screenshot', arguments: { tabId, annotateRefs: [ref], ...extra } }) as CallToolResult
      expect(rejected.isError).toBe(true)
    }
    const other = JSON.parse(text(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Other label workspace' })))
    const denied = await client.request({ method: 'tools/call', params: { name: 'browser_screenshot', arguments: { workspaceId: other.id, tabId, annotateRefs: [ref] } } }, CallToolResultSchema)
    expect(denied.isError).toBe(true)
    expect(denied.content.some(item => item.type === 'image')).toBe(false)
  })
})
