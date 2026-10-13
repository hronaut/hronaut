import { writeFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { translate } from '../../src/shared/i18n.js'
import { expect, test, text } from './capability-fixtures.js'

for (const dock of ['right', 'left'] as const) {
  for (const locale of ['en-US', 'ru-RU'] as const) {
    for (const height of [520, 900]) {
      test(`Network ${locale} ${dock} dock keeps details and footer actions reachable at 760x${height} with 125% scale`, async ({ capabilities, appWindow, electronApp }, info) => {
          const { client, tabId, openPageTool } = capabilities
        const capture = async (name: string) => {
          const png = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
          await writeFile(info.outputPath(name), Buffer.from(png, 'base64'))
        }
          const call = async (name: string, args: Record<string, unknown> = {}) => {
            const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
            expect(result.isError, text(result)).not.toBe(true)
            return text(result)
          }
          await call('browser_network')
          await call('browser_evaluate', { script: "fetch('/api-details?fixture=copy-shell', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'shell-copy' }) }).then(r=>r.text()).then(()=>true)" })
          let requestId: string | undefined
          await expect.poll(async () => {
            const records = JSON.parse(await call('browser_network')) as Array<{ id: string; url: string; completedAt?: string }>
            requestId = records.find(row => row.url.includes('fixture=copy-shell') && row.completedAt)?.id
            return requestId
      }).toBeTruthy()
      const curl = await call('browser_network_request', { requestId, copyAs: 'curl' })
      await openPageTool('Open network monitor')
      const panel = appWindow.locator('.network-monitor-panel')
      await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('fixture=copy-shell')
      const rows = panel.getByRole('listbox').getByRole('option')
      await expect(rows).toHaveCount(1)
      await rows.first().click()

      await appWindow.evaluate(locale => (window as unknown as { hronautSettings: { setLanguagePreference(locale: string): Promise<unknown> } }).hronautSettings.setLanguagePreference(locale), locale)
      const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
      await panel.locator('.panel-dock-picker select').selectOption(dock)
      await electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0]!.setSize(760, height), height)
      await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.25)')
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(1.25)
      await expect.poll(() => appWindow.evaluate(() => innerHeight)).toBe(height / 1.25)

      const footer = panel.locator('footer')
      await expect(footer).toHaveCount(1)
      await expect(footer.getByRole('button')).toHaveCount(3)
      if (height === 900) {
        for (const action of await footer.getByRole('button').all()) await expect(action).toBeInViewport({ ratio: 1 })
      }

      // Native pointer action must reach retained request details without forced clicks.
      await panel.getByRole('button', { name: t('network.details.copyJson'), exact: true }).click({ timeout: 5000 })
      await expect(panel.getByRole('button', { name: t('network.details.copiedJson'), exact: true })).toBeVisible()
      expect(JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).url).toContain('fixture=copy-shell')
      const copy = panel.getByRole('button', { name: t('network.details.copyCurl'), exact: true })
      await copy.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await expect(copy).toBeInViewport({ ratio: 1 })
      await copy.focus()
      await copy.press('Enter')
      await expect(panel.getByRole('button', { name: t('network.details.copiedCurl'), exact: true })).toBeFocused()
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(curl)
      await capture('native-network-details.png')

      if (height === 900) {
        for (const action of await footer.getByRole('button').all()) await expect(action).toBeInViewport({ ratio: 1 })
      }
      const har = panel.locator('footer').getByRole('button', { name: t('network.copyHar'), exact: true })
      const clear = footer.getByRole('button', { name: t('network.clear'), exact: true })
      await clear.focus()
      await clear.press('Tab')
      await expect(har).toBeFocused()
      await expect(har).toBeInViewport({ ratio: 1 })
      await har.press('Enter')
      await expect(panel.locator('footer').getByRole('button', { name: t('network.copied'), exact: true })).toBeFocused()
      const entries = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).log.entries as Array<{ request: { url: string } }>
      expect(entries.some(entry => entry.request.url.includes('fixture=copy-shell'))).toBe(true)
      const copiedHar = footer.getByRole('button', { name: t('network.copied'), exact: true })
      const save = footer.getByRole('button', { name: t('network.saveHar'), exact: true })
      await copiedHar.press('Tab')
      await expect(save).toBeFocused()
      await expect(save).toBeInViewport({ ratio: 1 })
      await save.press('Shift+Tab')
      await expect(copiedHar).toBeFocused()
      await expect(copiedHar).toBeInViewport({ ratio: 1 })
      await capture('native-network-footer.png')
      await panel.locator('footer').getByRole('button', { name: t('network.clear'), exact: true }).click()
      await expect(rows).toHaveCount(0)
      const dockPicker = panel.locator('.panel-dock-picker select')
      await dockPicker.focus()
      await expect(dockPicker).toBeInViewport({ ratio: 1 })
      await dockPicker.selectOption(dock === 'right' ? 'left' : 'right')
      await expect(dockPicker).toHaveValue(dock === 'right' ? 'left' : 'right')
      const close = panel.getByRole('button', { name: t('network.close'), exact: true })
      await expect(close).toBeInViewport({ ratio: 1 })
      await close.click()
      await expect(panel).toHaveCount(0)
      })
    }
  }
}
