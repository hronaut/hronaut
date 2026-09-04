import { writeFile } from 'node:fs/promises'
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './fixtures.js'

async function homeScript<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(source)
  }, script) as Promise<T>
}

async function ready(app: ElectronApplication) {
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home')))).toBe(true)
  await expect.poll(() => homeScript(app, `Boolean(document.getElementById('guide-name')?.textContent)`)).toBe(true)
}

for (const [selector, status] of [
  ['[data-agent-guide]', '#guide-open-status'],
  ['[data-setup-help]', '#support-help-status'],
  ['[data-setup-feedback]', '#support-feedback-status']
] as const) {
  test(`Home shows accessible launch failure and retry for ${selector}`, async ({ electronApp }) => {
    await ready(electronApp)
    await electronApp.evaluate(({ shell }) => {
      shell.openExternal = async () => { throw new Error('External browser unavailable') }
    })
    await homeScript(electronApp, `document.querySelector(${JSON.stringify(selector)}).click()`)
    await expect.poll(() => homeScript(electronApp, `document.querySelector(${JSON.stringify(status)}).textContent`)).toContain('External browser unavailable')
    expect(await homeScript(electronApp, `document.querySelector(${JSON.stringify(status)}).getAttribute('role')`)).toBe('status')
    expect(await homeScript(electronApp, `document.querySelector(${JSON.stringify(selector)}).textContent`)).toContain('Retry')
    await electronApp.evaluate(({ shell }) => { shell.openExternal = async () => {} })
    await homeScript(electronApp, `document.querySelector(${JSON.stringify(selector)}).click()`)
    await expect.poll(() => homeScript(electronApp, `document.querySelector(${JSON.stringify(status)}).textContent`)).toBe('')
    await expect.poll(() => homeScript(electronApp, `document.querySelector(${JSON.stringify(selector)}).disabled`)).toBe(false)
  })
}

test('Home remembers client choice and explicit setup collapse through reload', async ({ electronApp }) => {
  await ready(electronApp)
  await homeScript(electronApp, `(() => {
    document.querySelector('[data-guide="qwen-code"]').click();
    const setup = document.getElementById('setup');
    setup.open = false;
  })()`)
  await expect.poll(() => homeScript(electronApp, `localStorage.getItem('hronaut.home.setup')`)).toBe('collapsed')
  await electronApp.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))?.reload()
  })
  await expect.poll(() => homeScript(electronApp, `document.getElementById('guide-name')?.textContent`)).toBe('Qwen Code')
  expect(await homeScript(electronApp, `document.getElementById('setup').open`)).toBe(false)
  await homeScript(electronApp, `document.querySelector('[data-open-setup]').click()`)
  expect(await homeScript(electronApp, `document.getElementById('setup').open`)).toBe(true)
  await expect.poll(() => homeScript(electronApp, `(() => { const selected = document.querySelector('[data-guide="qwen-code"]').getBoundingClientRect(); const list = document.getElementById('agent-list').getBoundingClientRect(); return selected.top >= list.top && selected.bottom <= list.bottom; })()`)).toBe(true)
})

test('Home keeps search focus and selected client while filtering and polling', async ({ electronApp }) => {
  await ready(electronApp)
  await homeScript(electronApp, `(() => {
    document.querySelector('[data-guide="opencode"]').click();
    const search = document.getElementById('agent-search');
    search.focus(); search.value = 'nonexistent-agent'; search.dispatchEvent(new Event('input'));
  })()`)
  expect(await homeScript(electronApp, `document.getElementById('agent-empty').hidden`)).toBe(false)
  expect(await homeScript(electronApp, `document.getElementById('guide-name').textContent`)).toBe('OpenCode')
  await homeScript(electronApp, `refreshDashboard()`)
  expect(await homeScript(electronApp, `document.activeElement.id`)).toBe('agent-search')
  await electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    home.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    home.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  })
  await expect.poll(() => homeScript(electronApp, `document.getElementById('agent-search').value`)).toBe('')
  expect(await homeScript(electronApp, `document.querySelector('[data-guide="qwen-code"]').hidden`)).toBe(false)
  expect(await homeScript(electronApp, `document.querySelector('[data-guide="opencode"]').getAttribute('aria-pressed')`)).toBe('true')
})

test('Home stays usable in light and dark English and Ukrainian at narrow and wide widths', async ({ electronApp, appWindow }, testInfo) => {
  await ready(electronApp)
  for (const locale of ['en-US', 'uk-UA']) {
    await appWindow.evaluate(`window.hronautSettings.setLanguagePreference(${JSON.stringify(locale)})`)
    await expect.poll(() => homeScript(electronApp, `document.documentElement.lang`)).toBe(locale)
    await ready(electronApp)
    for (const theme of ['light', 'dark'] as const) {
      await appWindow.evaluate(`window.hronautSettings.setTheme(${JSON.stringify(theme)})`)
      const homePage = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))
      if (!homePage) throw new Error('Home Playwright page was not found')
      // Playwright defaults every page to emulated light; let the real app theme apply.
      await homePage.emulateMedia({ colorScheme: null })
      await expect.poll(() => homeScript(electronApp, `matchMedia('(prefers-color-scheme: dark)').matches`)).toBe(theme === 'dark')
      await expect.poll(() => homeScript(electronApp, `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)).toBe(theme === 'dark' ? '#12131a' : '#f5f5fa')
      for (const width of [1200, 760]) {
        await electronApp.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]!
          window.setSize(width, 960)
        }, width)
        await homeScript(electronApp, `window.scrollTo(0, 0)`)
        const layout = await homeScript<{ overflow: number; listHeight: number; listScroll: number; copyTop: number; controlsWithinPage: boolean }>(electronApp, `(() => {
          const list = document.getElementById('agent-list');
          return {
            overflow: document.documentElement.scrollWidth - innerWidth,
            listHeight: list.clientHeight, listScroll: list.scrollHeight,
            copyTop: document.querySelector('[data-copy-target="guide-code"]').getBoundingClientRect().top,
            controlsWithinPage: [...document.querySelectorAll('.journey a, #agent-search, [data-agent-guide]')].every(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })
          };
        })()`)
        expect(layout.overflow).toBeLessThanOrEqual(1)
        expect(layout.listHeight).toBeLessThanOrEqual(290)
        expect(layout.listScroll).toBeGreaterThan(layout.listHeight)
        expect(layout.copyTop).toBeLessThan(850)
        expect(layout.controlsWithinPage).toBe(true)
        await homeScript(electronApp, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
        const png = await electronApp.evaluate(async ({ webContents }) => {
          const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
          return (await home.capturePage()).toPNG().toString('base64')
        })
        await writeFile(testInfo.outputPath(`home-${locale}-${theme}-${width}.png`), Buffer.from(png, 'base64'))
      }
    }
  }
})
