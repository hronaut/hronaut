import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test as base, expect, text } from './capability-fixtures.js'
import { launchHronaut, closeHronaut } from './fixtures.js'

const test = base.extend<{ displayScale: number }>({
  displayScale: [1, { option: true }],
  electronApp: async ({ profileDirectory, mcpPort, displayScale }, use) => {
    const instance = await launchHronaut(profileDirectory, mcpPort, 1, [], [`--force-device-scale-factor=${displayScale}`])
    try { await use(instance.app) } finally { await closeHronaut(instance.app) }
  }
})

for (const displayScale of [1, 2]) test.describe(`region edge pixels at native scale ${displayScale}`, () => {
  test.use({ displayScale })
  test('retains changes confined to complete right and bottom pixels at 400 percent zoom', async ({ capabilities, electronApp }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as { baseline?: { width: number; height: number }; changedPixels?: number }
    }
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === fixtureUrl)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === fixtureUrl)!
    await page.evaluate(() => { document.body.innerHTML = '<style>html,body{margin:0;background:white;overflow:hidden}#target{position:absolute;left:40px;top:40px;width:80px;height:60px;background:blue}</style><div id="target"></div>' })
    await call('browser_emulate', { viewport: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'portrait' } })
    await call('browser_zoom', { action: 'set', percent: 400 })
    const scale = 4 * displayScale
    const painted = async (edge: 'right' | 'bottom', green: boolean) => {
      const x = edge === 'right' ? 120 * scale - 1 : 50 * scale
      const y = edge === 'bottom' ? 100 * scale - 1 : 50 * scale
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, input) => {
        const image = await webContents.getAllWebContents().find(contents => contents.getURL() === input.url)!.capturePage()
        const size = image.getSize()
        if (size.width !== 800 * input.displayScale || size.height !== 600 * input.displayScale) return false
        const pixel = image.crop({ x: input.x, y: input.y, width: 1, height: 1 }).toBitmap({ scaleFactor: 1 })
        return input.green ? pixel[1]! > 240 && pixel[0]! < 15 : pixel[0]! > 240 && pixel[1]! < 15
      }, { url: fixtureUrl, displayScale, x, y, green })).toBe(true)
    }
    for (const edge of ['right', 'bottom'] as const) {
      await page.locator('#target').evaluate(element => { (element as HTMLElement).style.background = 'blue' })
      await painted(edge, false)
      const baseline = await call('browser_visual_compare', { action: 'set-baseline', settleMs: 0, clip: { x: 40, y: 40, width: 80, height: 60 } })
      expect(baseline.baseline).toMatchObject({ width: 80 * scale, height: 60 * scale })
      await page.locator('#target').evaluate((element, input) => {
        (element as HTMLElement).style.background = `linear-gradient(to ${input.edge === 'right' ? 'left' : 'top'},lime 0px,lime ${1 / input.scale}px,blue ${1 / input.scale}px)`
      }, { edge, scale })
      await painted(edge, true)
      const compared = await call('browser_visual_compare', { action: 'compare', settleMs: 0 })
      expect(compared.changedPixels).toBe((edge === 'right' ? 60 : 80) * scale)
    }
    await call('browser_visual_compare', { action: 'clear' })
  })
})
