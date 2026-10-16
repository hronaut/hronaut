import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { translate } from '../../src/shared/i18n.js'
import { PAGE_CARD_GUTTER } from '../../src/shared/page-card.js'
import { expect, test, text } from './capability-fixtures.js'

for (const dock of ['top', 'bottom'] as const) {
  for (const locale of ['en-US', 'ru-RU'] as const) {
    for (const height of [520, 900]) {
      test(`Network ${locale} ${dock} dock keeps details and footer actions reachable at 760x${height} with 125% scale`, async ({ capabilities, appWindow, electronApp }, info) => {
        test.skip(process.platform !== 'linux', 'Window-level pointer proof uses the Linux X11 desktop')
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

      await appWindow.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const geometry = await panel.evaluate(element => ({
        viewport: { width: innerWidth, height: innerHeight },
        panel: element.getBoundingClientRect().toJSON(),
        header: element.querySelector('header')!.getBoundingClientRect().toJSON(),
        shellTop: parseFloat(getComputedStyle(document.querySelector('.shell')!).getPropertyValue('--shell-content-top'))
      }))
      const nativeBounds = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.map(child => child.getBounds()))
      await writeFile(info.outputPath('geometry.json'), JSON.stringify({ geometry, nativeBounds }, null, 2))
      const toolbarHeight = Math.ceil(geometry.shellTop * 1.25)
      // The page is a card: a gutter at the window edges and between it and the dock.
      const gutter = Math.ceil(PAGE_CARD_GUTTER * 1.25)
      const dockInset = Math.ceil((geometry.panel.height + PAGE_CARD_GUTTER) * 1.25)
      const pageHeight = height - toolbarHeight - dockInset - (dock === 'top' ? gutter : 0)
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getBounds())).toEqual({
        x: gutter, y: toolbarHeight + (dock === 'top' ? dockInset : 0),
        width: 760 - 2 * gutter, height: pageHeight
      })
      // A short window keeps the dock usable and leaves the page card, gutters included, a third of the space.
      expect(pageHeight + gutter * (dock === 'top' ? 2 : 1)).toBeGreaterThanOrEqual(85)
      if (height === 520) expect(geometry.panel.height).toBeGreaterThanOrEqual(150)
      // A real native click must still reach the website beside the trusted dock.
      await call('browser_evaluate', { script: "(() => { const button = document.createElement('button'); button.id='dock-web-probe'; button.textContent='Website'; button.style.cssText='position:fixed;z-index:999999;left:8px;top:8px;width:80px;height:32px'; button.onclick=()=>button.dataset.clicked='yes'; document.body.append(button); return true })()" })
      const websitePoint = await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!
        const origin = window.getContentBounds()
        const view = window.contentView.children[0]!.getBounds()
        return { x: origin.x + view.x + 30, y: origin.y + view.y + 20 }
      })
      await promisify(execFile)('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(websitePoint.x), String(websitePoint.y), '--click'])
      expect(JSON.parse(await call('browser_evaluate', { script: "document.querySelector('#dock-web-probe').dataset.clicked === 'yes'" }))).toBe(true)


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
      await dockPicker.selectOption(dock === 'top' ? 'bottom' : 'top')
      await expect(dockPicker).toHaveValue(dock === 'top' ? 'bottom' : 'top')
      const close = panel.getByRole('button', { name: t('network.close'), exact: true })
      await expect(close).toBeInViewport({ ratio: 1 })
      await close.click()
      await expect(panel).toHaveCount(0)
      })
    }
  }
}
