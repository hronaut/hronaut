import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'
const exec = promisify(execFile)

for (const compact of [false, true]) for (const scale of [1, 1.25]) for (const orientation of ['vertical', 'horizontal']) {
  test(`physically resizes native ${orientation} split without page input at ${scale} scale (${compact ? 'compact left' : 'normal top'})`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }, compact) => BrowserWindow.getAllWindows()[0]!.setContentSize(compact ? 760 : 1200, compact ? 520 : 800), compact)
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    if (compact) await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    const alpha = await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Divider Alpha</title><body style=background:teal;height:100vh;margin:0>Alpha</body>', active: true })`) as BrowserState
    await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Divider Beta</title><body style=background:orange;height:100vh;margin:0>Beta</body>', active: true })`)
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(alpha.activeTabId)})`)
    await appWindow.evaluate(`window.hronaut.updateSplitView({ orientation: '${orientation}' })`)
    await appWindow.evaluate(`(async () => { const state = await window.hronaut.getState(); await window.hronaut.setAllHumanInteractionLocked(false); for (const tab of state.tabs) await window.hronaut.setTabHumanInteractionLocked(tab.id, false); })()`)
    const session = await appWindow.context().newCDPSession(appWindow)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await electronApp.evaluate(async ({ webContents }) => {
      for (const page of webContents.getAllWebContents().filter(page => /^Divider /.test(page.getTitle()))) {
        await page.executeJavaScript("document.body.dataset.clicks = '0'; document.addEventListener('pointerdown', () => document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1))")
      }
    })
    const divider = appWindow.getByRole('separator', { name: 'Resize split view', exact: true })
    await expect(divider).toBeVisible()
    const views = () => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0]!.contentView.children
      .filter((view): view is InstanceType<typeof WebContentsView> => view instanceof WebContentsView && /^Divider /.test(view.webContents.getTitle()) && view.getVisible())
      .map(view => ({ title: view.webContents.getTitle(), bounds: view.getBounds() })))
    const before = await views()
    expect(before).toHaveLength(2)
    const bounds = (await divider.boundingBox())!
    const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
    const start = { x: origin.x + Math.round((bounds.x + bounds.width / 2) * scale), y: origin.y + Math.round((bounds.y + bounds.height / 2) * scale) }
    const axis = orientation === 'vertical' ? 'width' : 'height'
    const available = before.reduce((sum, page) => sum + page.bounds[axis], 0)
    const delta = Math.round(available * 0.15)
    const end = { x: start.x + (orientation === 'vertical' ? delta : 0), y: start.y + (orientation === 'horizontal' ? delta : 0) }
    await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(start.x), String(start.y), `--drag-to=${end.x},${end.y}`])
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => Math.round(state.splitView.ratio * 100))')).toBe(65)
    await expect(divider).toHaveAttribute('aria-valuenow', '65')
    const after = await views()
    const first = after.find(page => page.title === 'Divider Beta')!
    const second = after.find(page => page.title === 'Divider Alpha')!
    expect(Math.abs(first.bounds[axis] - available * 0.65)).toBeLessThanOrEqual(1)
    expect(first.bounds[axis] + second.bounds[axis]).toBe(available)
    const pageCounts = () => electronApp.evaluate(async ({ webContents }) => Promise.all(webContents.getAllWebContents().filter(page => /^Divider /.test(page.getTitle())).map(async page => ({ title: page.getTitle(), clicks: Number(await page.executeJavaScript('document.body.dataset.clicks')) }))))
    expect((await pageCounts()).every(page => page.clicks === 0)).toBe(true)
    await divider.focus()
    await divider.press(orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp')
    await expect(divider).toHaveAttribute('aria-valuenow', '64')
    await divider.press('Enter')
    await expect(divider).toHaveAttribute('aria-valuenow', '50')
    // Hold the physical mouse across native content, then cancel without committing.
    const physical = async (action: string, x: number, y: number) => exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(x), String(y), action])
    const currentPoint = async () => {
      const rect = (await divider.boundingBox())!
      return { x: origin.x + Math.round((rect.x + rect.width / 2) * scale), y: origin.y + Math.round((rect.y + rect.height / 2) * scale) }
    }
    for (const cancel of ['escape', 'lock']) {
      const point = await currentPoint()
      const moved = { x: point.x + (orientation === 'vertical' ? delta : 0), y: point.y + (orientation === 'horizontal' ? delta : 0) }
      await physical('--down', point.x, point.y)
      await physical('--move', moved.x, moved.y)
      await expect(divider).toHaveAttribute('aria-valuenow', '65')
      if (cancel === 'escape') await physical('--shortcut=Escape', moved.x, moved.y)
      else await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(true)')
      await physical('--up', moved.x, moved.y)
      await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.splitView.ratio)')).toBe(0.5)
      if (cancel === 'lock') await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(false)')
      await expect(divider).toHaveAttribute('aria-valuenow', '50')
    }
    expect((await pageCounts()).every(page => page.clicks === 0)).toBe(true)
    await divider.focus()
    await divider.press('Home')
    await expect(divider).toHaveAttribute('aria-valuenow', '25')
    await divider.press('End')
    await expect(divider).toHaveAttribute('aria-valuenow', '75')
    await divider.press(orientation === 'vertical' ? 'Shift+ArrowLeft' : 'Shift+ArrowUp')
    await expect(divider).toHaveAttribute('aria-valuenow', '70')
    const resetPoint = await currentPoint()
    await physical('--click', resetPoint.x, resetPoint.y)
    await physical('--click', resetPoint.x, resetPoint.y)
    await expect(divider).toHaveAttribute('aria-valuenow', '50')
    for (const page of await views()) {
      await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(origin.x + page.bounds.x + Math.round(page.bounds.width / 2)), String(origin.y + page.bounds.y + Math.round(page.bounds.height / 2)), '--click'])
    }
    expect((await pageCounts()).every(page => page.clicks === 1)).toBe(true)
    const screenshot = await electronApp.evaluate(async ({ desktopCapturer }) => (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1200 } }))[0]!.thumbnail.toPNG())
    await writeFile(testInfo.outputPath('physical-desktop.png'), Buffer.from(screenshot))
    await writeFile(testInfo.outputPath('native-divider.json'), JSON.stringify({ scale, orientation, before, after, pageCounts: await pageCounts() }, null, 2))
  })
}


test('persists a committed divider ratio and restores the last committed ratio after cancellation', async ({ profileDirectory, mcpPort }) => {
  const first = await launchHronaut(profileDirectory, mcpPort)
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    const alpha = await first.window.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Persist Alpha</title>Alpha', active: true })") as BrowserState
    await first.window.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Persist Beta</title>Beta', active: true })")
    await first.window.evaluate(`window.hronaut.openSplitView(${JSON.stringify(alpha.activeTabId)})`)
    await first.window.evaluate('window.hronaut.setAllHumanInteractionLocked(false)')
    const divider = first.window.getByRole('separator', { name: 'Resize split view', exact: true })
    await expect(divider).toBeVisible()
    await divider.focus()
    await divider.press('Shift+ArrowRight')
    await expect(divider).toHaveAttribute('aria-valuenow', '55')
    const rect = (await divider.boundingBox())!
    const origin = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
    const x = origin.x + Math.round(rect.x + rect.width / 2)
    const y = origin.y + Math.round(rect.y + rect.height / 2)
    const input = (action: string) => exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(x), String(y), action])
    await input('--down')
    await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(x + 80), String(y), '--move'])
    await expect.poll(() => divider.getAttribute('aria-valuenow')).not.toBe('55')
    await input('--shortcut=Escape')
    await input('--up')
    await expect(divider).toHaveAttribute('aria-valuenow', '55')
    await closeHronaut(first.app)
    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => second!.window.evaluate('window.hronaut.getState().then(state => state.splitView?.ratio)')).toBe(0.55)
    await second.window.evaluate('window.hronaut.setAllHumanInteractionLocked(false)')
    await expect(second.window.getByRole('separator', { name: 'Resize split view', exact: true })).toHaveAttribute('aria-valuenow', '55')
  } finally {
    await closeHronaut(second?.app ?? first.app)
  }
})
