import type { Locator } from '@playwright/test'
import type { HronautApi, HronautSettingsApi, ThemeName } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type ShellWindow = Window & { hronaut: HronautApi; hronautSettings: HronautSettingsApi }

async function colorToken(button: Locator, token: string): Promise<string> {
  return button.evaluate((element, token) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${token})`
    element.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

for (const theme of ['cyberpunk-turbo', 'light', 'dark']) {
  test(`${theme} distinguishes inactive page actions from enabled tools`, async ({ appWindow, electronApp }, testInfo) => {
    await appWindow.evaluate(theme => (window as unknown as ShellWindow).hronautSettings.setTheme(theme as ThemeName), theme)
    await appWindow.evaluate(() => (window as unknown as ShellWindow).hronaut.newTab({
      url: 'data:text/html,<title>Action Alpha</title><h1>Page action color fixture</h1>', active: true
    }))
    await appWindow.evaluate(() => (window as unknown as ShellWindow).hronaut.newTab({
      url: 'data:text/html,<title>Action Beta</title><h1>Second pane</h1>', active: false
    }))
    await expect(appWindow.getByRole('tab', { name: /^Action Beta/ })).toBeVisible()
    const capture = appWindow.locator('.area-capture-button')
    const picker = appWindow.locator('.element-picker-button')
    const split = appWindow.getByRole('button', { name: 'Split view', exact: true })
    const tools = appWindow.getByRole('button', { name: 'Page tools', exact: true })
    const neutral = await colorToken(tools, '--text')
    const accent = await colorToken(tools, '--accent')
    const accentCopy = await colorToken(tools, '--accent-text')
    await appWindow.getByRole('combobox', { name: 'Address', exact: true }).hover()
    await appWindow.locator('.toolbar').screenshot({ path: testInfo.outputPath(`${theme}-inactive.png`) })
    for (const button of [split, capture, picker, tools]) {
      await expect(button).toBeEnabled()
      await expect(button).not.toHaveClass(/\bactive\b/)
      await expect(button).toHaveCSS('color', neutral)
      expect(neutral).not.toBe(accentCopy)
      await button.hover()
      await expect(button).toHaveCSS('color', neutral)
      await expect(button).toHaveCSS('background-color', await colorToken(button, '--hover'))
      await expect(button).toHaveCSS('cursor', 'pointer')
    }

    for (const [button, overlay] of [
      [capture, '[data-hronaut-screenshot-area="shade"]'],
      [picker, '[data-hronaut-element-picker="overlay"]']
    ] as const) {
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await appWindow.getByRole('combobox', { name: 'Address', exact: true }).hover()
      await expect(button).toHaveCSS('background-color', accent)
      await expect(button).not.toHaveCSS('color', neutral)
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, overlay) => {
        const page = webContents.getAllWebContents().find(page => page.getTitle() === 'Action Alpha')
        return page?.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(overlay)}))`)
      }, overlay)).toBe(true)
      await appWindow.locator('.toolbar').screenshot({ path: testInfo.outputPath(`${theme}-${button === capture ? 'capture' : 'picker'}-active.png`) })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'false')
      await expect(button).toHaveCSS('color', neutral)
    }

    await split.click()
    // Opening the chooser does not enable split view yet.
    await expect(split).toHaveAttribute('aria-expanded', 'true')
    await expect(split).toHaveCSS('color', neutral)
    await appWindow.locator('.split-candidate-list').getByRole('button', { name: /Action Beta/ }).click()
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as ShellWindow).hronaut.getState().then(state => Boolean(state.splitView)))).toBe(true)
    await expect(split).toHaveClass(/\bactive\b/)
    await appWindow.getByRole('combobox', { name: 'Address', exact: true }).hover()
    await expect(split).toHaveCSS('background-color', accent)
    await split.click()
    await appWindow.getByRole('button', { name: 'Exit split view', exact: true }).click()
    await expect(split).not.toHaveClass(/\bactive\b/)
    await expect(split).toHaveCSS('color', neutral)

    await tools.click()
    await expect(appWindow.getByRole('dialog', { name: 'Page tools', exact: true })).toBeVisible()
    await expect(tools).toHaveAttribute('aria-expanded', 'true')
    await expect(tools).toHaveCSS('color', accentCopy)
    await appWindow.locator('.toolbar').screenshot({ path: testInfo.outputPath(`${theme}-tools-active.png`) })
    await tools.click()
    await expect(tools).toHaveAttribute('aria-expanded', 'false')
    await expect(tools).toHaveCSS('color', neutral)

    // Hold a real native capture result to inspect the otherwise brief busy state.
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find(page => page.getTitle() === 'Action Alpha')!
      const original = page.capturePage.bind(page)
      const scope = globalThis as typeof globalThis & { releaseActionCapture?: () => void; restoreActionCapture?: () => void }
      scope.restoreActionCapture = () => { page.capturePage = original }
      const released = new Promise<void>(resolve => { scope.releaseActionCapture = resolve })
      page.capturePage = async (...args) => {
        const image = await original(...args)
        await released
        return image
      }
    })
    try {
      await appWindow.getByRole('button', { name: 'Open command palette', exact: true }).click()
      const palette = appWindow.getByRole('dialog', { name: 'Commands' })
      await palette.getByRole('combobox').fill('Capture viewport screenshot')
      await palette.getByRole('option', { name: /Capture viewport screenshot/ }).click()
      await expect(capture).toBeDisabled()
      await expect(picker).toBeDisabled()
      await expect(capture.locator('.state-spinner')).toBeVisible()
      await expect(picker).toHaveCSS('color', neutral)
      await picker.hover()
      await expect(picker).toHaveCSS('cursor', 'default')
      await expect(picker).toHaveCSS('opacity', '0.3')
      await expect(picker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await appWindow.locator('.toolbar').screenshot({ path: testInfo.outputPath(`${theme}-capture-busy.png`) })
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { releaseActionCapture?: () => void }).releaseActionCapture?.())
      await expect(capture).toHaveClass(/\bcopied\b/)
      await expect(capture).toHaveCSS('color', await colorToken(capture, '--success'))
      await expect(capture).toBeEnabled()
      await expect(picker).toBeEnabled()
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readImage().isEmpty())).toBe(false)
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { releaseActionCapture?: () => void; restoreActionCapture?: () => void }
        scope.releaseActionCapture?.()
        scope.restoreActionCapture?.()
        delete scope.releaseActionCapture
        delete scope.restoreActionCapture
      })
    }
  })
}
