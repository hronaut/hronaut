import { writeFile } from 'node:fs/promises'
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './fixtures.js'

const HOME_READY_TIMEOUT_MS = 20_000

async function homeScript<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(source)
  }, script) as Promise<T>
}

async function readyHome(app: ElectronApplication): Promise<void> {
  await expect.poll(
    () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home'))),
    { timeout: HOME_READY_TIMEOUT_MS }
  ).toBe(true)
  await expect.poll(
    () => homeScript(app, 'document.readyState !== "loading"'),
    { timeout: HOME_READY_TIMEOUT_MS }
  ).toBe(true)
}

async function captureHome(app: ElectronApplication): Promise<Buffer> {
  const png = await app.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return (await home.capturePage()).toPNG().toString('base64')
  })
  return Buffer.from(png, 'base64')
}

test('Home keeps its content width and position when switching between short and scrollable tabs', async ({ electronApp }) => {
  await readyHome(electronApp)
  await expect.poll(() => homeScript(electronApp, 'Boolean(document.getElementById("home-tab-workspaces")?.offsetParent)')).toBe(true)
  // Exercise the returning-profile short view as well as long diagnostics.
  await homeScript(electronApp, `localStorage.setItem('hronaut.home.onboarded', 'true'); import(document.querySelector('script[type="module"]').src).then(module => module.homeController.refresh())`)
  for (const width of [1200, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 900), width)
    await expect.poll(() => homeScript(electronApp, 'innerWidth')).toBe(width)
    await homeScript(electronApp, 'document.getElementById("home-tab-workspaces").click()')
    const measure = () => homeScript<{ x: number; width: number; scrollable: boolean }>(electronApp, `(() => {
      const page = document.querySelector('.page');
      if (!page) throw new Error('Home page container was not found');
      const bounds = page.getBoundingClientRect();
      return { x: bounds.x, width: bounds.width, scrollable: document.documentElement.scrollHeight > innerHeight };
    })()`)
    const initial = await measure()
    const scrollStates = new Set([initial.scrollable])
    for (const tab of ['connect', 'tools', 'overview', 'workspaces']) {
      await homeScript(electronApp, `document.getElementById(${JSON.stringify(`home-tab-${tab}`)}).click()`)
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
  await readyHome(electronApp)
  await homeScript(electronApp, 'document.getElementById("home-tab-overview").click()')

  for (const width of [1200, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, nextWidth) => BrowserWindow.getAllWindows()[0]!.setSize(nextWidth, 900), width)
    await expect.poll(() => homeScript(electronApp, 'innerWidth')).toBe(width)
    await expect.poll(() => homeScript(electronApp, `(() => {
      const overview = document.getElementById('home-overview');
      const heading = [...document.querySelectorAll('h1, h2, h3')].find(node => node.textContent?.trim() === 'MCP readiness');
      return !overview?.hidden && Boolean(heading?.getBoundingClientRect().height)
        && Boolean(document.getElementById('readiness-tool-inventory')?.getBoundingClientRect().height)
        && Boolean(document.getElementById('readiness-verify')?.getBoundingClientRect().height);
    })()`)).toBe(true)
    const layout = await homeScript<{ overflow: number; panelWidth: number; reportWidth: number }>(electronApp, `(() => {
      const panel = document.querySelector('.readiness');
      const report = document.querySelector('.readiness-report');
      if (!panel || !report) throw new Error('MCP readiness layout was not found');
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        panelWidth: panel.getBoundingClientRect().width,
        reportWidth: report.getBoundingClientRect().width
      };
    })()`)
    expect.soft(layout.overflow).toBeLessThanOrEqual(1)
    expect.soft(layout.panelWidth).toBeGreaterThan(260)
    expect.soft(layout.reportWidth).toBeLessThanOrEqual(layout.panelWidth)
    await writeFile(testInfo.outputPath(`home-readiness-${width}.png`), await captureHome(electronApp))
  }
})
