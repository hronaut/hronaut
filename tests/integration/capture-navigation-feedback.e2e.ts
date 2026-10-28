import { expect, test } from './fixtures.js'

type CaptureProbe = { calls: number; release(): void; restore(): void }
type ProbeGlobal = typeof globalThis & { __navigationCaptureProbe?: CaptureProbe }

test('clears pending screenshot feedback when the captured tab reloads', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Capture navigation</title><h1>Capture navigation</h1>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
  const page = electronApp.context().pages().find(page => page.url() === url)!
  await expect(page.getByRole('heading')).toHaveText('Capture navigation')
  await electronApp.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    const original = contents.capturePage.bind(contents)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const probe: CaptureProbe = { calls: 0, release, restore: () => { contents.capturePage = original; release() } }
    // Every capture waits, not only the first: the tab's overview preview also captures the page once it has loaded,
    // and holding only whichever came first left the screenshot free to finish before the reload.
    contents.capturePage = async (...args: Parameters<typeof original>) => {
      probe.calls += 1
      await gate
      return original(...args)
    }
    ;(globalThis as ProbeGlobal).__navigationCaptureProbe = probe
  }, url)
  try {
    await appWindow.getByRole('button', { name: 'Open command palette' }).click()
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await palette.getByRole('combobox').fill('Capture viewport screenshot')
    await electronApp.evaluate(() => { (globalThis as ProbeGlobal).__navigationCaptureProbe!.calls = 0 })
    await palette.getByRole('option', { name: /Capture viewport screenshot/ }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).__navigationCaptureProbe!.calls)).toBeGreaterThan(0)
    await expect(appWindow.getByRole('button', { name: 'Capturing viewport screenshot', exact: true })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole('heading')).toHaveText('Capture navigation')
    // The old native capture is still pending: reset must follow navigation,
    // rather than waiting for native completion or a feedback timeout.
    await expect(appWindow.getByRole('button', { name: 'Capture an area to the clipboard', exact: true })).toBeEnabled()
  } finally {
    await electronApp.evaluate(() => {
      ;(globalThis as ProbeGlobal).__navigationCaptureProbe?.restore()
      delete (globalThis as ProbeGlobal).__navigationCaptureProbe
    })
  }
})
