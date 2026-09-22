import { expect, test } from './fixtures.js'
import type { HronautApi, HronautBookmarksApi, HronautHistoryApi } from '../../src/shared/types.js'

type TestWindow = Window & {
  hronaut: HronautApi
  hronautBookmarks: HronautBookmarksApi
  hronautHistory: HronautHistoryApi
}

test('keeps an address draft when focus moves to the page or another shell control', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Address draft fixture</title><main><button>Page action</button></main>'
  await appWindow.evaluate(async url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), url)
  await expect.poll(() => appWindow.evaluate(async () => (
    (await (window as unknown as TestWindow).hronaut.getState()).tabs.find(tab => tab.active)?.title
  ))).toBe('Address draft fixture')
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  const draft = 'google unfinished search'
  await address.fill(draft)

  await appWindow.getByRole('button', { name: 'Settings' }).focus()
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue(draft)
  await address.focus()
  await expect(address).toHaveValue(draft)

  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Address draft page was not found')
    page.focus()
  }, url)
  await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()))
    .toBe(url)
  await expect(address).toHaveValue(draft)
  await address.focus()
  await address.press('Escape')
  await expect(address).toHaveValue(url)
})

test('suggests a previously visited Google hostname in the visible native popup', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate(async () => (window as unknown as TestWindow).hronaut.newTab({ active: true }))
  // Serve synthetic content from this disposable workspace's HTTPS handler.
  // Exercise the real hostname/history path without sending requests to Google.
  const webContentsId = await electronApp.evaluate(({ webContents }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === 'about:blank')
    if (!page) throw new Error('Address history page was not found')
    page.session.protocol.handle('https', () => new Response(
      '<!doctype html><title>Previously visited search engine</title><main>Local fixture</main>',
      { headers: { 'content-type': 'text/html' } }
    ))
    return page.id
  })
  try {
    await appWindow.evaluate(async () => (window as unknown as TestWindow).hronaut.navigate({ url: 'https://www.google.com/' }))
    await expect.poll(() => appWindow.evaluate(async () => (
      (await (window as unknown as TestWindow).hronautHistory.list()).some(entry => entry.url === 'https://www.google.com/')
    ))).toBe(true)
    await appWindow.evaluate(async () => (window as unknown as TestWindow).hronaut.newTab({ active: true }))
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    await address.fill('')
    await address.pressSequentially('google')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    await expect(appWindow.locator('#address-suggestions [role="option"]')).toContainText(['https://www.google.com/'])
    await expect.poll(() => electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
      if (!contents || contents.isLoading()) return null
      const main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Hronaut')
      const view = main?.contentView.children.find(child => (
        (child as unknown as { webContents?: { id: number } }).webContents?.id === contents.id
      ))
      return {
        visible: view?.getVisible(),
        text: await contents.executeJavaScript("document.querySelector('[role=option]')?.textContent")
      }
    })).toMatchObject({ visible: true, text: expect.stringContaining('https://www.google.com/') })

    await appWindow.evaluate(async () => {
      for (let index = 0; index < 9; index += 1) {
        await (window as unknown as TestWindow).hronautBookmarks.add(`https://guides.example/${index}`, `Google integration guide ${index}`)
      }
    })
    await expect(appWindow.locator('#address-suggestions [role="option"]').first()).toContainText('https://www.google.com/')
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
      return contents?.executeJavaScript("document.querySelector('[role=option]')?.textContent")
    })).toContain('https://www.google.com/')

    // Native views may not receive animation frames while hidden. The popup
    // starts each update hidden until it reports its measured content height.
    await electronApp.evaluate(async ({ webContents }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
      if (!contents) throw new Error('Address popup was not found')
      await contents.executeJavaScript('window.requestAnimationFrame = () => 0; undefined')
    })
    await address.fill('google.com')
    await expect.poll(() => electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
      if (!contents) return null
      const main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Hronaut')
      const view = main?.contentView.children.find(child => (
        (child as unknown as { webContents?: { id: number } }).webContents?.id === contents.id
      ))
      return { visible: view?.getVisible(), height: view?.getBounds().height }
    })).toMatchObject({ visible: true, height: expect.any(Number) })
    await expect(address).toBeFocused()

  } finally {
    await electronApp.evaluate(({ webContents }, id) => {
      webContents.fromId(id)?.session.protocol.unhandle('https')
    }, webContentsId)
  }
})
