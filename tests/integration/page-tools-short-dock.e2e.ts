import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Locator } from '@playwright/test'
import { translate } from '../../src/shared/i18n.js'
import { expect, test } from './fixtures.js'

for (const dock of ['top', 'bottom', 'left', 'right'] as const) {
  for (const locale of ['en-US', 'ru-RU'] as const) {
    for (const scale of [1, 1.25]) {
      for (const height of [520, 900]) {
        if ((dock === 'left' || dock === 'right') && (scale !== 1.25 || height !== 520)) continue
        test(`Page tools ${dock} ${locale} at 760x${height} scale ${scale} supports scrolling and selection`, async ({ appWindow, electronApp }, info) => {
          test.skip(process.platform !== 'linux', 'Native input proof uses X11')
          await appWindow.getByRole('button', { name: 'New tab' }).click()
          await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
          const panel = appWindow.locator('#page-tools-panel')
          await panel.getByRole('combobox').selectOption(dock)
          await appWindow.evaluate(locale => (window as unknown as { hronautSettings: { setLanguagePreference(locale: string): Promise<unknown> } }).hronautSettings.setLanguagePreference(locale), locale)
          await electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0]!.setSize(760, height), height)
          await appWindow.evaluate(scale => (window as unknown as { hronautSettings: { setInterfaceScale(scale: number): Promise<unknown> } }).hronautSettings.setInterfaceScale(scale), scale)
          await expect.poll(() => appWindow.evaluate(() => innerHeight)).toBe(height / scale)
          const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
          const search = panel.getByRole('searchbox')
          const close = panel.getByRole('button', { name: t('shell.pageTools.close'), exact: true })
          const network = panel.getByRole('button', { name: t('shell.pageTools.openNetwork'), exact: true })
          const native = async (target: Locator, action: string) => {
            const rect = (await target.boundingBox())!
            const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
            await promisify(execFile)('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(Math.round(origin.x + (rect.x + rect.width / 2) * scale)), String(Math.round(origin.y + (rect.y + rect.height / 2) * scale)), action])
          }
          const capture = async (name: string) => {
            const png = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
            await writeFile(info.outputPath(name), Buffer.from(png, 'base64'))
          }
          const body = panel.locator('.page-tools-body')
          const receipts: unknown[] = []
          const wheel = async (target: Locator) => {
            const before = await body.evaluate(element => {
              const evidence = { wheels: [] as Array<{ trusted: boolean; deltaY: number }>, ends: 0 }
              const onWheel = (event: Event) => { evidence.wheels.push({ trusted: event.isTrusted, deltaY: (event as WheelEvent).deltaY }) }
              const onEnd = () => { evidence.ends++ }
              Object.assign(element, { scrollEvidence: evidence, scrollCleanup: () => {
                element.removeEventListener('wheel', onWheel)
                element.removeEventListener('scrollend', onEnd)
              } })
              element.addEventListener('wheel', onWheel, { once: true })
              element.addEventListener('scrollend', onEnd, { once: true })
              return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight }
            })
            const observed = () => body.evaluate(element => ({ top: element.scrollTop, ...(element as unknown as { scrollEvidence: { wheels: Array<{ trusted: boolean; deltaY: number }>; ends: number } }).scrollEvidence }))
            try {
              await native(target, '--wheel-once')
              await expect.poll(async () => (await observed()).wheels.length).toBe(1)
              if (before.top < before.max - 1) await expect.poll(async () => (await observed()).ends).toBeGreaterThan(0)
              const after = await observed()
              expect(after.wheels[0]!.trusted).toBe(true)
              expect(after.wheels[0]!.deltaY).toBeGreaterThan(0)
            } finally {
              receipts.push({ before, after: await observed() })
              await writeFile(info.outputPath('wheel-receipts.json'), JSON.stringify(receipts, null, 2))
              await body.evaluate(element => (element as unknown as { scrollCleanup(): void }).scrollCleanup())
            }
          }
          await search.fill('websocket')
          await expect(panel.locator('.page-tools-grid > button')).toHaveCount(1)
          await wheel(search)
          // Observe settled results without locator auto-scroll or keyboard focus assistance.
          const titleRatios = () => panel.locator('.page-tools-grid strong').evaluateAll(elements =>
            Promise.all(elements.map(element => new Promise<number>(resolve => {
              const observer = new IntersectionObserver(entries => { observer.disconnect(); resolve(entries[0]!.intersectionRatio) })
              observer.observe(element)
            })))
          )
          for (let step = 0; step < 5 && !(await titleRatios()).includes(1); step++) await wheel(body)
          expect((await titleRatios()).includes(1)).toBe(true)
          await capture('wheel-results.png')
          if (dock === 'top' || dock === 'bottom') {
            await expect(network.locator('strong')).toBeInViewport({ ratio: 1 })
            await native(network.locator('strong'), '--click')
            await expect(appWindow.locator('.network-monitor-panel')).toBeVisible()
            await appWindow.locator('.network-monitor-panel .panel-close').click()
            await appWindow.getByRole('button', { name: t('shell.pageTools.heading'), exact: true }).click()
            await search.fill('websocket')
          }
          // Footer and empty-result recovery share the same ordinary scroll route.
          for (let step = 0; step < 8; step++) {
            const atEnd = await body.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1)
            if (atEnd) break
            await wheel(body)
          }
          await expect(panel.locator('footer span').last()).toBeInViewport({ ratio: 1 })
          const hostname = panel.locator('footer span').first()
          if ((await hostname.textContent())?.trim()) await expect(hostname).toBeInViewport({ ratio: 1 })
          await writeFile(info.outputPath('footer-geometry.json'), JSON.stringify(await panel.locator('footer').evaluate(element => ({ footer: element.getBoundingClientRect().toJSON(), body: element.parentElement!.getBoundingClientRect().toJSON() })), null, 2))
          await capture('footer.png')
          await search.focus()
          await search.fill('no-such-page-tool')
          await search.press('Tab')
          await appWindow.keyboard.press('Tab')
          const emptyClear = panel.getByRole('button', { name: t('shell.pageTools.clearSearch'), exact: true }).last()
          await expect(emptyClear).toBeFocused()
          await expect(emptyClear).toBeInViewport({ ratio: 1 })
          await native(emptyClear, '--click')
          await expect(search).toHaveValue('')
          await expect(search).toBeFocused()
          await expect(close).toBeInViewport({ ratio: 1 })
          await expect(panel.getByRole('combobox')).toBeInViewport({ ratio: 1 })
          // Focus reveals the search again; ArrowDown must reveal the selected result.
          await search.focus()
          await search.fill('websocket')
          await expect(panel.locator('.page-tools-grid > button')).toHaveCount(1)
          await search.press('ArrowDown')
          await expect(network).toBeFocused()
          await expect(network.locator('strong')).toBeInViewport({ ratio: 1 })
          await expect(network.locator('small')).toBeInViewport({ ratio: 1 })
          await capture('keyboard-result.png')
          await native(network.locator('strong'), '--click')
          await expect(appWindow.locator('.network-monitor-panel')).toBeVisible()
          await appWindow.locator('.network-monitor-panel .panel-close').click()
          await appWindow.getByRole('button', { name: t('shell.pageTools.heading'), exact: true }).click()
          await expect(search).toHaveValue('')
          await search.fill('websocket')
          await search.press('Escape')
          await expect(search).toHaveValue('')
          await expect(search).toBeFocused()
          await search.fill('websocket')
          await panel.getByRole('button', { name: t('shell.pageTools.clearSearch'), exact: true }).click()
          await expect(search).toHaveValue('')
          await expect(search).toBeFocused()
          await panel.getByRole('combobox').selectOption(dock === 'top' ? 'bottom' : 'top')
          await search.fill('websocket')
          await search.press('ArrowDown')
          await expect(network).toBeFocused()
          await expect(network.locator('strong')).toBeInViewport({ ratio: 1 })
          await native(network.locator('strong'), '--shortcut=Return')
          await expect(appWindow.locator('.network-monitor-panel')).toBeVisible()
          await appWindow.locator('.network-monitor-panel .panel-close').click()
          await appWindow.getByRole('button', { name: t('shell.pageTools.heading'), exact: true }).click()
          await close.click()
          await expect(panel).toHaveCount(0)
          await appWindow.getByRole('button', { name: t('shell.pageTools.heading'), exact: true }).click()
          await expect(search).toHaveValue('')
          await expect(search).toBeInViewport({ ratio: 1 })
        })
      }
    }
  }
}
