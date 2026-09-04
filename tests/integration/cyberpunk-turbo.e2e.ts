import { writeFile } from 'node:fs/promises'
import axe from 'axe-core'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('selects Cyberpunk Turbo and applies it to chrome, Home and address suggestions', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
  const turbo = settings.getByRole('radio', { name: /^Cyberpunk Turbo/ })
  await turbo.click()
  await expect(turbo).toHaveAttribute('aria-checked', 'true')
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'cyberpunk-turbo')
  expect(await appWindow.evaluate('window.hronautSettings.get().then(settings => settings.theme)')).toBe('cyberpunk-turbo')
  await expect.poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true)
  await appWindow.evaluate(axe.source)
  const contrast = await appWindow.evaluate(`globalThis.axe.run({ include: ['.theme-cyberpunk-turbo', '.settings-footer', '.settings-header', '.settings-nav-item'] }, { runOnly: { type: 'rule', values: ['color-contrast'] } }).then(result => result.violations)`)
  expect(contrast).toEqual([])
  await expect(appWindow.locator('.settings-dialog')).toHaveCSS('border-radius', '4px')
  await settings.screenshot({ path: testInfo.outputPath('cyberpunk-turbo-settings.png') })
  await settings.locator('.settings-footer').getByRole('button', { name: 'Close', exact: true }).click()

  await expect.poll(() => electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    return home.executeJavaScript('document.documentElement.dataset.theme')
  })).toBe('cyberpunk-turbo')
  const homeContrast = await electronApp.evaluate(async ({ webContents }, source) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    await home.executeJavaScript(source)
    await home.executeJavaScript(`document.querySelector('[data-guide=\"vscode\"]').click()`)
    return home.executeJavaScript(`axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } }).then(result => result.violations)`)
  }, axe.source)
  expect(homeContrast).toEqual([])
  const homeImage = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    return (await home.capturePage()).toPNG().toString('base64')
  })
  await writeFile(testInfo.outputPath('cyberpunk-turbo-home.png'), Buffer.from(homeImage, 'base64'))

  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Signal research</title><main>Fixture</main>', active: true })`)
  for (const width of [1200, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 800), width)
    await expect.poll(() => appWindow.evaluate('innerWidth')).toBe(width)
    await appWindow.locator('.shell').screenshot({ path: testInfo.outputPath(`cyberpunk-turbo-chrome-${width}.png`) })
    expect(await appWindow.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true)
  }
  expect(await appWindow.evaluate("globalThis.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } }).then(result => result.violations)")).toEqual([])
  await appWindow.evaluate("window.hronautBookmarks.add('https://example.com/signal', 'Signal diagnostics')")
  await appWindow.locator('input.address').fill('signal')
  await expect.poll(() => electronApp.evaluate(({ webContents }) => {
    const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
    return overlay?.executeJavaScript(`({ theme: document.documentElement.dataset.theme, scheme: getComputedStyle(document.documentElement).colorScheme, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() })`)
  })).toEqual({ theme: 'cyberpunk-turbo', scheme: 'dark', accent: '#ff4de3' })
  await appWindow.keyboard.press('Escape')
  await appWindow.evaluate("window.hronautSettings.setTheme('light')")
  await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!.executeJavaScript('document.documentElement.dataset.theme'))).toBe('')
})

test('restores the Cyberpunk Turbo preference after restarting the application', async ({ profileDirectory, mcpPort }) => {
  const first = await launchHronaut(profileDirectory, mcpPort)
  try {
    await first.window.evaluate("window.hronautSettings.setTheme('cyberpunk-turbo')")
  } finally {
    await closeHronaut(first.app)
  }
  const second = await launchHronaut(profileDirectory, mcpPort)
  try {
    await expect(second.window.locator('html')).toHaveAttribute('data-theme', 'cyberpunk-turbo')
    expect(await second.window.evaluate('window.hronautSettings.get().then(settings => settings.theme)')).toBe('cyberpunk-turbo')
  } finally {
    await closeHronaut(second.app)
  }
})
