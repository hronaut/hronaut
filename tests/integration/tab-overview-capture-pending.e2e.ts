import { expect, test } from './fixtures.js'

interface CaptureProbe {
  calls: number
  timedOut: boolean
  release(): void
  restore(): void
}
type ProbeGlobal = typeof globalThis & { __previewCaptureProbe?: CaptureProbe }

test('does not start a second native thumbnail capture when opening the overview after a timeout', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Pending thumbnail</title><h1>Pending thumbnail</h1>'
  const tabId = await appWindow.evaluate<string>(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then(state => state.activeTabId)`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getTabOverviewPreviews([${JSON.stringify(tabId)}]).then(items => items.length)`)).toBe(1)
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const descriptor = Object.getOwnPropertyDescriptor(page, 'capturePage')
    const original = page.capturePage.bind(page)
    const frame = await original()
    const originalWarn = console.warn
    let release!: () => void
    const pending = new Promise<typeof frame>(resolve => { release = () => resolve(frame) })
    const probe: CaptureProbe = {
      calls: 0,
      timedOut: false,
      release,
      restore: () => {
        release()
        if (descriptor) Object.defineProperty(page, 'capturePage', descriptor)
        else Reflect.deleteProperty(page, 'capturePage')
        console.warn = originalWarn
      }
    }
    Object.defineProperty(page, 'capturePage', { configurable: true, value: (...args: Parameters<typeof original>) => {
      probe.calls++
      return probe.calls === 1 ? pending : original(...args)
    } })
    console.warn = (...args: unknown[]) => {
      if (args.some(value => value instanceof Error && value.message.startsWith('Tab overview capture exceeded'))) probe.timedOut = true
      originalWarn(...args)
    }
    ;(globalThis as ProbeGlobal).__previewCaptureProbe = probe
    // Trigger the visible capture path, whose timeout is reported by the owner.
    page.emit('did-stop-loading')
  }, url)
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).__previewCaptureProbe!.timedOut)).toBe(true)
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const overview = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    await expect(overview).toBeVisible()
    await appWindow.evaluate(`window.hronaut.getTabOverviewPreviews([${JSON.stringify(tabId)}])`)
    const calls = await electronApp.evaluate(async () => {
      await new Promise<void>(resolve => setImmediate(resolve))
      return (globalThis as ProbeGlobal).__previewCaptureProbe!.calls
    })
    expect(calls).toBe(1)
    await electronApp.evaluate(() => (globalThis as ProbeGlobal).__previewCaptureProbe!.release())
    await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).__previewCaptureProbe!.calls)).toBeGreaterThan(1)
  } finally {
    await electronApp.evaluate(() => {
      ;(globalThis as ProbeGlobal).__previewCaptureProbe?.restore()
      delete (globalThis as ProbeGlobal).__previewCaptureProbe
    })
  }
})
