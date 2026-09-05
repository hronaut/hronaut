import { writeFile } from 'node:fs/promises'
import type { Locator } from '@playwright/test'
import type { AppUpdateState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

async function uncovered(control: Locator): Promise<void> {
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const strip = element.closest('.tabs-strip')!.getBoundingClientRect()
    return rect.top >= strip.top - 1 && rect.bottom <= strip.bottom + 1
      && [0.15, 0.5, 0.85].every(f => element.contains(document.elementFromPoint(rect.x + rect.width * f, rect.y + rect.height / 2)))
  })).toBe(true)
}

for (const theme of ['light', 'cyberpunk-turbo']) {
  for (const scale of [1, 1.25]) {
    test(`keeps vertical workspace identity and three tab rows visible in ${theme} at ${scale} scale`, async ({ appWindow, electronApp }, testInfo) => {
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 520))
      await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
      const id = await appWindow.evaluate(async () => {
        const bridge = (window as unknown as { hronaut: HronautApi }).hronaut
        const state = await bridge.createWorkspace({ name: 'Research workspace', color: 'purple', storage: 'scratch' })
        const id = state.mcpTabGroups.find(group => group.name === 'Research workspace')!.id
        for (let i = 1; i <= 7; i++) await bridge.newTab({ mcpGroupId: id, url: `data:text/html,<title>Research document ${i}</title><h1>Document ${i}</h1>`, active: true })
        await bridge.createWorkspace({ name: 'Next workspace', color: 'cyan', storage: 'scratch' })
        return id
      })
      const research = appWindow.locator('.workspace-tab-section', { has: appWindow.locator('.tab-group-label', { hasText: 'Research workspace' }) })
      const tabs = research.getByRole('tab')
      const header = research.locator('.tab-group-label')
      await tabs.nth(2).focus()
      await tabs.nth(2).press('ArrowDown')
      await expect(tabs.nth(3)).toBeFocused()
      await uncovered(tabs.nth(3))
      await electronApp.evaluate(({ BrowserWindow, app }) => BrowserWindow.getAllWindows()[0]!.webContents.send('updates:changed', {
        status: 'available', currentVersion: app.getVersion(), availableVersion: '99.0.0'
      } satisfies AppUpdateState))
      await expect(appWindow.locator('.update-status-pill')).toBeVisible()
      const capture = async (name: string): Promise<void> => {
        await appWindow.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))))
        const image = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
        await writeFile(testInfo.outputPath(name), Buffer.from(image, 'base64'))
      }
      await capture('vertical-focused.png')
      await uncovered(header)
      await expect.poll(() => tabs.evaluateAll(elements => {
        const strip = elements[0]!.closest('.tabs-strip')!.getBoundingClientRect()
        const header = elements[0]!.closest('.workspace-tab-section')!.querySelector('.tab-group-label')!.getBoundingClientRect()
        return elements.filter(element => {
          const rect = element.getBoundingClientRect()
          return rect.top >= Math.max(strip.top, header.bottom) - 1 && rect.bottom <= strip.bottom + 1
        }).length
      }), 'The compact rail should show at least three complete tab rows below the workspace name').toBeGreaterThanOrEqual(3)
      // Wheel scrolling keeps the owner visible independently of keyboard focus.
      await appWindow.locator('.tabs-strip').hover()
      await appWindow.mouse.wheel(0, 50)
      await uncovered(header)
      await tabs.nth(4).focus()
      await tabs.nth(4).press('ArrowUp')
      await uncovered(tabs.nth(3))
      await tabs.nth(3).press('Enter')
      await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true')
      const nextHeader = appWindow.locator('.tab-group-label', { hasText: 'Next workspace' })
      await nextHeader.focus()
      await nextHeader.press('Shift+Tab')
      const add = research.locator('.workspace-new-tab')
      await expect(add).toBeFocused()
      await uncovered(add)
      await uncovered(header)
      await add.press('Enter')
      await expect.poll(() => appWindow.evaluate(async () => {
        const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
        return state.tabs.find(tab => tab.active)?.mcpGroupId
      })).toBe(id)
      // The pin remains a named keyboard-operable control beside Home.
      const pin = appWindow.locator('.tab-rail-pin')
      await expect(pin).toHaveAttribute('aria-label', /.+/)
      await pin.focus()
      await pin.press('Space')
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      await pin.press('Space')
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
      await capture('vertical-created.png')
      await appWindow.locator('.settings-button').click()
      const settings = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(settings).toBeVisible()
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
      // Secondary tools remain discoverable through the named command palette.
      for (const command of ['Search tabs', 'Show downloads', 'Show browsing history']) {
        await appWindow.locator('.app-home-button').focus()
        const launcher = appWindow.getByRole('button', { name: 'Open command palette', exact: true })
        await expect(launcher).toHaveText('Commands')
        await launcher.focus()
        await launcher.press('Enter')
        const palette = appWindow.getByRole('dialog', { name: 'Commands', exact: true })
        const search = palette.getByRole('combobox', { name: 'Search commands' })
        await search.fill(command)
        await expect(palette.getByRole('option', { name: new RegExp(command, 'i') })).toBeVisible()
        await search.press('Enter')
        await expect(palette).toBeHidden()
        await appWindow.keyboard.press('Escape')
      }
      // Long translated labels and the available-update indicator share the
      // same two action rows; none may collide with another control or tabs.
      for (const selector of ['.all-lock-button', '.follow-agent-button', '.mcp-pause-button']) {
        await appWindow.locator('.app-home-button').focus()
        const control = appWindow.locator(selector)
        await control.focus()
        await control.press('Space')
        await expect(control).toHaveAttribute('aria-pressed', 'true')
        await expect(control).toBeEnabled()
        await appWindow.locator('.app-home-button').focus()
        await control.focus()
        await control.press('Space')
        await expect(control).toHaveAttribute('aria-pressed', 'false')
      }
      await appWindow.evaluate("window.hronautSettings.setLanguagePreference('de-DE')")
      await tabs.nth(2).focus()
      await tabs.nth(2).press('ArrowDown')
      await uncovered(tabs.nth(3))
      await uncovered(header)
      await electronApp.evaluate(({ BrowserWindow, app }) => BrowserWindow.getAllWindows()[0]!.webContents.send('updates:changed', {
        status: 'available', currentVersion: app.getVersion(), availableVersion: '99.0.0'
      } satisfies AppUpdateState))
      await expect(appWindow.locator('.update-status-pill')).toHaveClass(/available/)
      await expect(appWindow.locator('.update-status-pill')).toHaveAttribute('title', /99\.0\.0/)
      const layout = await appWindow.locator('.topbar-actions').evaluate(element => {
        const strip = document.querySelector('.tabs-strip')!.getBoundingClientRect()
        const controls = [...element.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0)
        return {
          stripHeight: strip.height,
          controls: controls.map(button => {
            const rect = button.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(button)
            const text = range.getBoundingClientRect()
            return { name: button.getAttribute('aria-label') || button.textContent, visible: rect.top >= strip.bottom && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
              uncovered: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), textFits: text.top >= rect.top - 1 && text.bottom <= rect.bottom + 1 }
          })
        }
      })
      expect(layout.controls.every(control => control.visible && control.uncovered && control.textFits)).toBe(true)
      await writeFile(testInfo.outputPath('rail-layout.json'), JSON.stringify(layout, null, 2))
      await capture('vertical-german-update.png')
      await appWindow.locator('.update-status-pill').focus()
      await appWindow.keyboard.press('Enter')
      await expect(appWindow.locator('.settings-dialog')).toBeVisible()
    })
  }
}
