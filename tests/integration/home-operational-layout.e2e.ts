import { writeFile } from 'node:fs/promises'
import { expect, test } from './fixtures.js'

test('Home keeps its content width and position when switching between short and scrollable tabs', async ({ electronApp }) => {
  await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
  await expect(home.locator('#home-tab-workspaces')).toBeVisible()
  for (const width of [1200, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 900), width)
    await expect.poll(() => home.evaluate(() => innerWidth)).toBe(width)
    await home.locator('#home-tab-workspaces').click()
    const measure = () => home.evaluate(() => {
      const page = document.querySelector('.page')!.getBoundingClientRect()
      return { x: page.x, width: page.width, scrollable: document.documentElement.scrollHeight > innerHeight }
    })
    const initial = await measure()
    const scrollStates = new Set([initial.scrollable])
    for (const tab of ['connect', 'tools', 'overview', 'workspaces']) {
      await home.locator(`#home-tab-${tab}`).click()
      const current = await measure()
      scrollStates.add(current.scrollable)
      expect.soft(current.width, `${width}/${tab}: content width`).toBe(initial.width)
      expect.soft(current.x, `${width}/${tab}: content position`).toBe(initial.x)
    }
    expect(scrollStates.size, `${width}: exercised both short and scrollable Home tabs`).toBe(2)
  }
})

test('Home keeps client setup accessible in a compact layout across themes and languages', async ({ electronApp, appWindow }, testInfo) => {
  const home = async <T>(source: string): Promise<T> => electronApp.evaluate(async ({ webContents }, script) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!page) throw new Error('Home contents unavailable')
    return page.executeJavaScript(script)
  }, source) as Promise<T>
  await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home')))).toBe(true)
  await expect.poll(() => home('Boolean(document.getElementById("guide-name")?.textContent)')).toBe(true)
  for (const locale of ['en-US', 'uk-UA']) {
    await appWindow.evaluate(`window.hronautSettings.setLanguagePreference(${JSON.stringify(locale)})`)
    await expect.poll(() => home('document.documentElement.lang')).toBe(locale)
    for (const theme of ['light', 'dark']) {
      await appWindow.evaluate(`window.hronautSettings.setTheme(${JSON.stringify(theme)})`)
      const page = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))
      if (!page) throw new Error('Home page unavailable')
      await page.emulateMedia({ colorScheme: null })
      await home("document.querySelector('[data-home-view=connect]').click()")
      await expect.poll(() => home('matchMedia("(prefers-color-scheme: dark)").matches')).toBe(theme === 'dark')
      for (const width of [1200, 760]) {
        await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 900), width)
        await expect.poll(() => home('innerWidth')).toBe(width)
        await home('scrollTo(0, 0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const layout = await home<{ setupTop: number; copyTop: number; guideBottom: number; titleSize: number; background: string; overflow: number; listHeight: number }>(`(() => ({
          setupTop: document.getElementById('setup').getBoundingClientRect().top,
          copyTop: document.querySelector('[data-copy-target="guide-code"]').getBoundingClientRect().top,
          guideBottom: document.querySelector('[data-agent-guide]').getBoundingClientRect().bottom,
          titleSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
          background: getComputedStyle(document.body).backgroundImage,
          overflow: document.documentElement.scrollWidth - innerWidth,
          listHeight: document.getElementById('agent-list').getBoundingClientRect().height
        }))()`)
        expect.soft(layout.setupTop, `${locale}/${theme}/${width}: setup starts near the navigation`).toBeLessThan(300)
        expect.soft(layout.copyTop, `${locale}/${theme}/${width}: primary setup action is immediately reachable`).toBeLessThan(600)
        expect.soft(layout.guideBottom, `${locale}/${theme}/${width}: setup guide is above the fold`).toBeLessThan(740)
        expect.soft(layout.titleSize).toBeLessThanOrEqual(28)
        expect.soft(layout.background).toBe('none')
        expect.soft(layout.overflow).toBeLessThanOrEqual(1)
        expect.soft(layout.listHeight).toBeLessThanOrEqual(290)
        const png = await electronApp.evaluate(async ({ webContents }) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
          return (await page.capturePage()).toPNG().toString('base64')
        })
        await writeFile(testInfo.outputPath(`home-${locale}-${theme}-${width}.png`), Buffer.from(png, 'base64'))
      }
    }
  }
})

test('Home keeps MCP readiness diagnostics readable at desktop and compact widths', async ({ electronApp }, testInfo) => {
  await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
  await home.locator('#home-tab-overview').click()

  for (const width of [1200, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, nextWidth) => BrowserWindow.getAllWindows()[0]!.setSize(nextWidth, 900), width)
    await expect.poll(() => home.evaluate(() => innerWidth)).toBe(width)
    await expect(home.getByRole('heading', { name: 'MCP readiness' })).toBeVisible()
    await expect(home.locator('#readiness-tool-inventory')).toBeVisible()
    await expect(home.locator('#readiness-verify')).toBeVisible()
    const layout = await home.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      panelWidth: document.querySelector('.readiness')!.getBoundingClientRect().width,
      reportWidth: document.querySelector('.readiness-report')!.getBoundingClientRect().width
    }))
    expect.soft(layout.overflow).toBeLessThanOrEqual(1)
    expect.soft(layout.panelWidth).toBeGreaterThan(260)
    expect.soft(layout.reportWidth).toBeLessThanOrEqual(layout.panelWidth)
    await home.screenshot({ path: testInfo.outputPath(`home-readiness-${width}.png`) })
  }
})
