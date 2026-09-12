import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import axe from 'axe-core'
import type { HronautApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// BrowserWindow.capturePage captures only the shell renderer. Capture the native
// composition so the evidence includes the real child WebContentsViews as well.
async function captureWindow(app: ElectronApplication): Promise<string> {
  return app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0]!.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
      width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor
    } })
    const source = sources.find(source => source.display_id === String(display.id)) ?? sources[0]!
    const scale = source.thumbnail.getSize().width / display.size.width
    return source.thumbnail.crop({
      x: Math.round((bounds.x - display.bounds.x) * scale), y: Math.round((bounds.y - display.bounds.y) * scale),
      width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale)
    }).toPNG().toString('base64')
  })
}

test('fresh profiles provide a workspace rail with reachable named actions across desktop layouts', async ({ profileDirectory, mcpPort }, testInfo) => {
  // This gallery captures native composition and five overlays in both themes.
  test.slow()
  await writeFile(join(profileDirectory, 'settings.json'), JSON.stringify({ theme: 'light', mcpToolSet: 'complete' }))
  const { app, window } = await launchHronaut(profileDirectory, mcpPort)
  try {
    await expect(window.locator('.shell')).toHaveClass(/vertical-tabs-shell/)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setPosition(0, 0); window.setSize(1440, 960) })
    await window.evaluate(async () => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.createWorkspace({ name: 'Product review', color: 'purple', storage: 'scratch' })
      const id = state.mcpTabGroups.find(group => group.name === 'Product review')!.id
      await api.newTab({ mcpGroupId: id, url: 'data:text/html,<title>Review notes</title><main style="font:16px system-ui;padding:48px;max-width:640px"><h1>Review notes</h1><p>Use this workspace to inspect a website with your coding agent.</p></main>', active: true })
      await api.newTab({ mcpGroupId: id, url: 'about:blank', active: false })
      await api.createWorkspace({ name: 'Documentation', color: 'cyan', storage: 'scratch' })
    })
    for (const theme of ['light', 'dark']) {
      await window.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await expect(window.locator('html')).toHaveAttribute('data-theme', theme)
      await window.getByRole('button', { name: 'Open Hronaut Home', exact: true }).click()
      const home = app.context().pages().find(page => page.url().startsWith('hronaut://home'))!
      await home.emulateMedia({ colorScheme: null })
      await expect.poll(() => home.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
      await expect(home.locator('#guide-name')).not.toBeEmpty()
      for (const view of ['overview', 'tools', 'connect']) {
        await home.locator('[data-home-view="' + view + '"]').click()
        await expect(home.locator('#home-' + view)).toBeVisible()
        const capture = await captureWindow(app)
        await writeFile(testInfo.outputPath('desktop-home-' + view + '-' + theme + '.png'), Buffer.from(capture, 'base64'))
      }
      const screenshot = await captureWindow(app)
      await writeFile(testInfo.outputPath(`desktop-home-${theme}.png`), Buffer.from(screenshot, 'base64'))
      for (const name of ['.command-palette-button', '.tab-search-button', '.downloads-button', '.history-button', '.settings-button']) {
        const control = window.locator(name)
        await expect(control).toBeInViewport({ ratio: 1 })
        await expect(control.locator('span').first()).toBeVisible()
        expect(await control.evaluate(element => {
          const rect = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        })).toBe(true)
      }
      await window.getByRole('tab', { name: /Review notes/ }).click()
      for (const position of ['left', 'top']) {
        await window.evaluate(`window.hronautSettings.setTabPosition('${position}')`)
        await expect(window.locator('.browser-tabs-bar')).toHaveClass(new RegExp(position === 'left' ? 'vertical' : 'horizontal'))
        const png = await captureWindow(app)
        await writeFile(testInfo.outputPath(`desktop-browser-${position}-${theme}.png`), Buffer.from(png, 'base64'))
      }
      await window.evaluate("window.hronautSettings.setTabPosition('left')")
      for (const [trigger, panel, name] of [
        ['.page-tools-button', '.page-tools-panel', 'page-tools'],
        ['.tab-search-button', '.tab-search-panel', 'tab-overview'],
        ['.command-palette-button', '.command-palette', 'commands'],
        ['.new-workspace', '.workspace-editor', 'workspace-editor'],
        ['.settings-button', '.settings-dialog', 'settings']
      ]) {
        await window.locator(trigger!).click()
        const surface = window.locator(panel!)
        await expect(surface).toBeVisible()
        expect(await surface.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await window.screenshot({ path: testInfo.outputPath(`desktop-${name}-${theme}.png`) })
        await surface.locator('.panel-close').first().click()
        await expect(surface).not.toBeVisible()
      }
    }
  } finally {
    await closeHronaut(app)
  }
})

test('settings search supports keyboard selection, recovery, and a fresh search on reopening', async ({ appWindow }) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
  const search = dialog.getByRole('searchbox', { name: 'Find a section…' })
  await search.fill('authentication')
  await search.press('Enter')
  await expect(dialog.locator('.settings-nav-item.active')).toContainText('MCP security')
  await search.fill('no such section')
  await expect(dialog.getByRole('status', { name: '' }).filter({ hasText: 'No matching sections' })).toBeVisible()
  await search.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(search).toHaveValue('')
  await search.fill('downloads')
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(dialog.locator('.settings-nav-item')).toHaveCount(11)
})

test('Home view navigation supports keyboard selection, search, and recovery', async ({ electronApp }) => {
  await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
  const connect = home.getByRole('tab', { name: 'Connect an agent', exact: true })
  await connect.focus()
  await connect.press('End')
  const tools = home.getByRole('tab', { name: 'Tool library', exact: true })
  await expect(tools).toBeFocused()
  await expect(tools).toHaveAttribute('aria-selected', 'true')
  await expect(home.locator('#home-connect')).not.toBeVisible()
  await home.locator('#tool-search').fill('not-an-existing-tool')
  await expect(home.locator('#tool-empty')).toBeVisible()
  await home.locator('#tool-search').fill('')
  await expect(home.locator('#tool-empty')).not.toBeVisible()
  const entry = home.locator('#tool-grid details').first()
  const summary = entry.locator('summary')
  await summary.focus()
  await summary.press('Enter')
  await expect(entry).toHaveAttribute('open', '')
  await expect(entry.locator('p')).toBeVisible()
  await expect(summary).toBeFocused()
  await tools.focus()
  await tools.press('ArrowLeft')
  await expect(home.locator('#home-overview')).toBeVisible()
  await expect(home.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused()
})

test('the navigation mute button controls only the active tab and follows changes from other controls', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronaut.newTab({url: 'data:text/html,<title>First audio tab</title>', active: true})`)
  await appWindow.evaluate(`window.hronaut.newTab({url: 'data:text/html,<title>Second audio tab</title>', active: true})`)
  const mute = appWindow.locator('.tab-mute-button')
  await expect(mute).toHaveAttribute('aria-label', 'Mute Tab')
  await expect(mute).toHaveAttribute('title', 'Mute Second audio tab')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  expect((await mute.boundingBox())!.height).toBeGreaterThanOrEqual(32)
  await mute.click()
  const nativeMuteStates = () => electronApp.evaluate(({ webContents }) => Object.fromEntries(
    webContents.getAllWebContents().filter(page => page.getTitle().endsWith('audio tab')).map(page => [page.getTitle(), page.isAudioMuted()])
  ))
  await expect.poll(nativeMuteStates).toEqual({ 'First audio tab': false, 'Second audio tab': true })
  await appWindow.getByRole('tab', { name: /First audio tab/ }).click()
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  await appWindow.locator('.all-tabs-audio-button').click()
  await expect(mute).toHaveAttribute('aria-label', 'Unmute Tab')
  await expect(mute).toHaveAttribute('title', 'Unmute First audio tab')
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  await mute.focus()
  await mute.press('Space')
  await expect.poll(nativeMuteStates).toEqual({ 'First audio tab': false, 'Second audio tab': true })
  await appWindow.getByRole('button', { name: 'Open Hronaut Home', exact: true }).click()
  await expect(mute).not.toBeVisible()
})

test('every Home view remains accessible in light and dark', async ({ appWindow, electronApp }) => {
  test.slow()
  await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
  await home.emulateMedia({ colorScheme: null })
  for (const theme of ['light', 'dark']) {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await expect.poll(() => home.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    await home.evaluate(axe.source)
    for (const view of ['connect', 'overview', 'tools']) {
      await home.locator('[data-home-view="' + view + '"]').click()
      if (view === 'tools') await home.locator('#tool-grid summary').first().click()
      const violations = await home.evaluate(async () => {
        const results = await (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
        })
        return results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, message: node.failureSummary })) }))
      })
      expect(violations, `${theme}/${view}`).toEqual([])
    }
  }
})
