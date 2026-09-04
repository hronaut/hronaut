import { writeFile } from 'node:fs/promises'
import { expect, test } from './fixtures.js'

test('Home gives client setup priority in a compact operational layout across themes and languages', async ({ electronApp, appWindow }, testInfo) => {
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
        expect.soft(layout.setupTop, `${locale}/${theme}/${width}: setup starts near the status header`).toBeLessThan(230)
        expect.soft(layout.copyTop, `${locale}/${theme}/${width}: primary setup action is immediately reachable`).toBeLessThan(520)
        expect.soft(layout.guideBottom, `${locale}/${theme}/${width}: setup guide is above the fold`).toBeLessThan(660)
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
