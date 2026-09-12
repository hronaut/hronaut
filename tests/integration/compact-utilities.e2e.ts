import { writeFile } from 'node:fs/promises'
import type { AppUpdateState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('keeps all seven named utility icons and Settings after MCP at minimum rail width and large scale', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate("window.hronaut.newTab({url: 'data:text/html,<title>Utility fixture</title>', active: true})")
  const selectors = ['.command-palette-button', '.tab-search-button', '.downloads-button', '.history-button', '.all-lock-button', '.all-tabs-audio-button', '.follow-agent-button']
  for (const [width, height, scale] of [[1200, 800, 1], [760, 520, 1.25]]) {
    await electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size[0]!, size[1]!), [width!, height!])
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
    const resize = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    await resize.focus()
    await resize.press('Home')
    for (const language of ['en-US', 'de-DE']) {
      await appWindow.evaluate(`window.hronautSettings.setLanguagePreference('${language}')`)
      await electronApp.evaluate(({ BrowserWindow, app }) => BrowserWindow.getAllWindows()[0]!.webContents.send('updates:changed', {
        status: 'available', currentVersion: app.getVersion(), availableVersion: '99.0.0'
      } satisfies AppUpdateState))
      await expect(appWindow.locator('.update-status-pill')).toBeVisible()
      const capture = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath(`utilities-${width}-${language}.png`), Buffer.from(capture, 'base64'))
      let rowY: number | undefined
      let previousRight = 0
      for (const selector of selectors) {
        const button = appWindow.locator(selector)
        await expect(button).toHaveAttribute('aria-label', /.+/)
        await expect(button).toHaveAttribute('title', /.+/)
        await expect(button).toBeInViewport({ ratio: 1 })
        await expect(button).toHaveText('')
        await expect(button.locator('svg').first()).toBeVisible()
        const rect = (await button.boundingBox())!
        rowY ??= rect.y
        expect(rect.y).toBeCloseTo(rowY, 0)
        expect(rect.x).toBeGreaterThanOrEqual(previousRight)
        expect(rect.width).toBeGreaterThanOrEqual(24)
        expect(rect.height).toBeGreaterThanOrEqual(32)
        previousRight = rect.x + rect.width
        expect(await button.evaluate(element => {
          const r = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        })).toBe(true)
      }
      const mcp = (await appWindow.locator('.mcp-controls').boundingBox())!
      const settings = (await appWindow.locator('.settings-button').boundingBox())!
      expect(settings.y).toBeCloseTo(mcp.y, 0)
      expect(settings.x).toBeGreaterThanOrEqual(mcp.x + mcp.width)
      expect(settings.y).toBeGreaterThan(rowY!)
      expect((await appWindow.locator('.topbar-actions').boundingBox())!.height).toBeLessThanOrEqual(90)
      await appWindow.locator('.mcp-pause-button').focus()
      await appWindow.keyboard.press('Tab')
      await expect(appWindow.locator('.settings-button')).toBeFocused()
    }
  }
})

test('Settings actions have visible button surfaces, comfortable targets, and keyboard focus', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
  for (const theme of ['light', 'dark']) {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    for (const [section, selector] of [[0, '.test-sound-button'], [5, '.workspace-data-actions button'], [4, '.mcp-capability-form > button'], [9, '.update-status-card-actions button'] ] as const) {
      await dialog.locator('.settings-nav-item').nth(section).click()
      const buttons = dialog.locator(selector)
      await buttons.first().scrollIntoViewIfNeeded()
      await appWindow.screenshot({ path: testInfo.outputPath(`actions-${theme}-${section}.png`) })
      for (const button of await buttons.all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(36)
        expect(await button.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('solid')
        if (await button.isEnabled()) {
          await appWindow.keyboard.press('Tab')
          await button.focus()
          await expect(button).toBeFocused()
          expect(await button.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
        }
      }
      if (section === 4) {
        const form = (await dialog.locator('.mcp-capability-form').boundingBox())!
        const submit = (await buttons.first().boundingBox())!
        expect(submit.x + submit.width).toBeCloseTo(form.x + form.width, 0)
        const checkbox = dialog.locator('.mcp-capability-check input')
        const check = (await checkbox.boundingBox())!
        const label = (await dialog.locator('.mcp-capability-check span').boundingBox())!
        expect(check.x + check.width).toBeLessThanOrEqual(label.x)
        expect(check.y + check.height / 2).toBeCloseTo(label.y + label.height / 2, 0)
        await checkbox.check()
        await expect(checkbox).toBeChecked()
      }
      if (section === 5) {
        const transfer = buttons.nth(1)
        expect(await transfer.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
        await buttons.first().click()
        await expect(appWindow.locator('.workspace-editor')).toBeVisible()
        await appWindow.locator('.workspace-editor .panel-close').click()
        await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      }
    }
  }
})
