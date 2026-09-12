import { createServer } from 'node:http'
import type { Locator, Page } from '@playwright/test'
import axe from 'axe-core'
import type { AppReleaseHistoryPage } from '../../src/shared/types.js'
import type { WalletRequestSummary } from '../../src/shared/wallet.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

async function expectStyledButtons(surface: Locator): Promise<void> {
  const nativeButtons = await surface.locator('button').evaluateAll(elements => elements.filter(element => {
    if (!element.getClientRects().length) return false
    const style = getComputedStyle(element)
    return ['outset', 'inset', 'groove', 'ridge'].includes(style.borderTopStyle)
  }).map(element => element.getAttribute('aria-label') || element.textContent?.trim()))
  expect.soft(nativeButtons, 'Application controls must not fall back to native beveled borders').toEqual([])
}

async function expectReadableContrast(surface: Locator): Promise<void> {
  const violations = await surface.evaluate(async element => (await (window as unknown as { axe: typeof axe }).axe.run(element, { runOnly: ['color-contrast'] })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, issue: node.failureSummary })) })))
  expect.soft(violations, `Readable text in ${await surface.getAttribute('class')}`).toEqual([])
}

async function openHistory(window: Page): Promise<Locator> {
  await window.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = window.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: /Updates Automatic checks/ }).click()
  await settings.getByRole('button', { name: "View what's new" }).click()
  const history = window.getByRole('dialog', { name: "What's new", exact: true })
  await expect(history).toBeVisible()
  return history
}

for (const theme of ['light', 'dark', 'cyberpunk']) {
  test(`What's new keeps styled actions and readable content through loading, error, and long releases in ${theme}`, async ({ appWindow, electronApp }, testInfo) => {
    const longWord = 'long-release-reference-'.repeat(18)
    const release: AppReleaseHistoryPage = {
      page: 1, hasMore: true, releases: [{
        version: '2.1.1', title: 'Hronaut 2.1.1', publishedAt: '2026-09-12T12:00:00Z',
        url: 'https://github.com/hronaut/hronaut/releases/tag/v2.1.1',
        notes: `<h2>What's changed</h2><div class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title">Warning</p><p>Unsigned builds may show a platform confirmation.</p></div><h3>Fixed</h3><ul><li>Consistent actions across the application.</li><li>Readable release notes with <code>${longWord}</code>.</li></ul><p><a href="https://hronaut.dev/">${longWord}</a></p><pre><code>${longWord}</code></pre><table><thead><tr><th>Platform</th><th>Download</th></tr></thead><tbody><tr><td>Desktop</td><td>${longWord}</td></tr></tbody></table>`
      }]
    }
    await electronApp.evaluate(({ ipcMain }, fixture) => {
      const scope = globalThis as typeof globalThis & { __historyAudit?: { ready: boolean; reject: (error: Error) => void } }
      let reject!: (error: Error) => void
      const pending = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise })
      scope.__historyAudit = { ready: false, reject }
      ipcMain.removeHandler('updates:get-release-history')
      ipcMain.handle('updates:get-release-history', async () => {
        if (!scope.__historyAudit?.ready) await pending
        return fixture
      })
    }, release)
    try {
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
      const history = await openHistory(appWindow)
      await expect(history.getByRole('status')).toBeVisible()
      await expectStyledButtons(history)
      await appWindow.screenshot({ path: testInfo.outputPath(`history-${theme}-loading.png`) })
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __historyAudit: { ready: boolean; reject: (error: Error) => void } }
        scope.__historyAudit.ready = true
        scope.__historyAudit.reject(new Error('Release history could not be reached. Please try again.'))
      })
      const retry = history.getByRole('button', { name: 'Try again', exact: true })
      await expect(retry).toBeVisible()
      expect.soft((await retry.boundingBox())!.height, 'Retry needs a full-sized action target').toBeGreaterThanOrEqual(36)
      await expectStyledButtons(history)
      await appWindow.screenshot({ path: testInfo.outputPath(`history-${theme}-error.png`) })
      await retry.click()
      await expect(history.getByRole('article')).toHaveCount(1)
      await appWindow.evaluate(axe.source)
      for (const scale of [1, 1.25]) {
        await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
        await electronApp.evaluate(({ BrowserWindow }, compact) => BrowserWindow.getAllWindows()[0]!.setSize(compact ? 760 : 1320, compact ? 520 : 860), scale > 1)
        await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(scale > 1 ? 608 : 1320)
        const content = history.locator('.whats-new-content')
        expect.soft(await content.evaluate(element => element.scrollWidth - element.clientWidth), 'Long release content must not widen the reader').toBeLessThanOrEqual(1)
        expect.soft((await history.getByRole('columnheader', { name: 'Platform' }).boundingBox())!.width, 'Table labels must retain readable columns').toBeGreaterThan(100)
        const violations = await history.evaluate(async element => (await (window as unknown as { axe: typeof axe }).axe.run(element, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })))
        expect.soft(violations).toEqual([])
        const older = history.getByRole('button', { name: 'Load older releases', exact: true })
        expect.soft((await older.boundingBox())!.height, 'Pagination must use a full-sized button').toBeGreaterThanOrEqual(36)
        await expect(older).toBeInViewport({ ratio: 1 })
        await expectStyledButtons(history)
        await older.focus()
        await appWindow.keyboard.press('Shift+Tab')
        await appWindow.keyboard.press('Tab')
        await expect(older).toBeFocused()
        expect.soft(await older.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
        await appWindow.screenshot({ path: testInfo.outputPath(`history-${theme}-${scale}.png`) })
      }
      await appWindow.keyboard.press('Escape')
      await expect(history).toBeHidden()
    } finally {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('updates:get-release-history')
        delete (globalThis as typeof globalThis & { __historyAudit?: unknown }).__historyAudit
      })
    }
  })
}

for (const theme of ['light', 'dark']) {
  for (const width of [1200, 760]) {
    test(`application panels keep deliberate control styling in ${theme} at ${width}px`, async ({ appWindow, electronApp }, testInfo) => {
      test.slow()
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<!doctype html><title>UI audit</title><main><h1>UI audit</h1><p>A local page for reviewing browser tools.</p></main>')
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      try {
        await appWindow.evaluate(`window.hronaut.newTab({url:'http://127.0.0.1:${address.port}/',active:true})`)
        await appWindow.evaluate(axe.source)
        await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
        await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
        await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 760), width)
        await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(width)
        for (const [trigger, surfaceName] of [
          ['.downloads-button', '.downloads-panel'], ['.history-button', '.history-panel'],
          ['.tab-search-button', '.tab-search-panel'], ['.command-palette-button', '.command-palette'],
          ['.new-workspace', '.workspace-editor']
        ]) {
          await appWindow.locator(trigger!).click()
          const surface = appWindow.locator(surfaceName!)
          await expect(surface).toBeVisible()
          await expectStyledButtons(surface)
          await expectReadableContrast(surface)
          expect.soft(await surface.evaluate(element => element.scrollWidth - element.clientWidth), surfaceName).toBeLessThanOrEqual(1)
          await appWindow.screenshot({ path: testInfo.outputPath(`${surfaceName!.slice(1)}-${theme}-${width}.png`) })
          await surface.locator('.panel-close').first().click()
          await expect(surface).toBeHidden()
        }
        for (const tool of ['site-storage', 'responsive-preview', 'environment', 'console', 'network', 'request-conditions', 'issues', 'security', 'design-overview', 'page-metadata', 'coverage', 'cpu-profile', 'memory', 'repro-recorder', 'dom-changes', 'visual-compare', 'quality-audit', 'accessibility', 'performance', 'debug-report']) {
          await appWindow.locator('.page-tools-button').click()
          const tools = appWindow.getByRole('dialog', { name: 'Page tools', exact: true })
          const names: Record<string, string> = {
            'site-storage': 'Site storage', 'responsive-preview': 'Responsive preview', environment: 'Environment', console: 'Console', network: 'Network monitor', 'request-conditions': 'Request conditions', issues: 'Issues', security: 'Security', 'design-overview': 'Design overview', 'page-metadata': 'Page metadata', coverage: 'Code coverage', 'cpu-profile': 'JavaScript CPU', memory: 'Memory', 'repro-recorder': 'Repro recorder', 'dom-changes': 'DOM changes', 'visual-compare': 'Visual compare', 'quality-audit': 'Quality audit', accessibility: 'Accessibility', performance: 'Performance', 'debug-report': 'Debug report'
          }
          await tools.locator('.page-tools-grid button').filter({ has: appWindow.locator('strong', { hasText: new RegExp('^' + names[tool] + '$') }) }).click()
          const surface = appWindow.locator('[role="dialog"]:visible').last()
          await expect(surface).toBeVisible()
          if (tool === 'site-storage') {
            await surface.getByRole('textbox', { name: 'Storage key', exact: true }).fill('ui-review')
          }
          await expectStyledButtons(surface)
          await expectReadableContrast(surface)
          expect.soft(await surface.evaluate(element => element.scrollWidth - element.clientWidth), tool).toBeLessThanOrEqual(1)
          await expect.soft(surface.locator('.panel-close').first(), `${tool}: close control must remain reachable`).toBeInViewport({ ratio: 1, timeout: 1000 })
          for (const action of await surface.locator(':scope > footer button').all()) {
            await expect.soft(action, `${tool}: persistent footer actions must stay visible`).toBeInViewport({ ratio: 1, timeout: 1000 })
          }
          await appWindow.screenshot({ path: testInfo.outputPath(`${tool}-${theme}-${width}.png`) })
          const footer = surface.locator('footer').last()
          if (await footer.isVisible()) {
            await expectStyledButtons(footer)
            await footer.scrollIntoViewIfNeeded()
            for (const button of await footer.getByRole('button').all()) {
              await expect.soft(button, `${tool}: footer action must be reachable`).toBeInViewport({ timeout: 1000 })
            }
          }
          await surface.locator('.panel-close').first().click()
          await expect(surface).toBeHidden()
        }
      } finally { await closeFixtureServer(server) }
    })
  }
}

for (const theme of ['light', 'dark']) {
  test(`help and wallet approval use readable full-sized actions in ${theme}`, async ({ appWindow, electronApp }, testInfo) => {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
    await appWindow.evaluate(axe.source)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 520))
    for (const label of ['About Hronaut', 'Keyboard Shortcuts']) {
      await electronApp.evaluate(({ BrowserWindow, Menu }, label) => {
        const item = Menu.getApplicationMenu()!.items.find(item => item.label === 'Help')!.submenu!.items.find(item => item.label === label)!
        item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
      }, label)
      const dialog = appWindow.locator('.help-dialog')
      await expect(dialog).toBeVisible()
      await expectStyledButtons(dialog)
      await expectReadableContrast(dialog)
      for (const button of await dialog.locator('.about-actions button').all()) expect.soft((await button.boundingBox())!.height).toBeGreaterThanOrEqual(36)
      await appWindow.screenshot({ path: testInfo.outputPath(`${label}-${theme}.png`) })
      await appWindow.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
    const request: WalletRequestSummary = {
      id: 'ui-audit-request', walletId: 'audit-wallet', workspaceId: 'audit-workspace', status: 'awaiting-human',
      approvalHash: 'a'.repeat(64), operation: 'sign-message', requester: { type: 'website', id: 'audit-tab', name: 'Local UI fixture' },
      origin: 'https://example.test', networkId: '1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      details: { walletName: 'UI review wallet', publicAddress: '0x0000000000000000000000000000000000000001', chainFamily: 'evm', networkName: 'Ethereum', capability: 'sign', understood: true, simulationAttempted: false, simulationSuccess: false, method: 'personal_sign', raw: { messageUtf8Preview: 'Interface review only' } }
    }
    await electronApp.evaluate(({ BrowserWindow }, request) => BrowserWindow.getAllWindows()[0]!.webContents.send('wallets:requests-changed', [request]), request)
    try {
      const approval = appWindow.getByRole('alertdialog', { name: /sign message/i })
      await expect(approval).toBeVisible()
      await approval.locator('footer').scrollIntoViewIfNeeded()
      for (const button of await approval.locator('footer button').all()) {
        expect.soft((await button.boundingBox())!.height).toBeGreaterThanOrEqual(36)
        await expect(button).toBeInViewport({ ratio: 1 })
      }
      await expectStyledButtons(approval)
      await expectReadableContrast(approval)
      await appWindow.screenshot({ path: testInfo.outputPath(`wallet-approval-${theme}.png`) })
    } finally {
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('wallets:requests-changed', []))
    }
  })
}
