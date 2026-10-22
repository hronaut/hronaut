import { expect, test } from './fixtures.js'

// `site:example.test electron` or a pasted error message typed in the address bar was taken for an address of an
// unknown scheme, which the workspace refused, instead of being searched.

test('searches text with spaces after a word and a colon, as Chrome does', async ({ appWindow, electronApp }) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().filter((contents) => contents.getURL() === 'about:blank').length
  ))).toBe(1)
  // The search engine is out of reach here: note the searches the tab asks for, and cancel them.
  await electronApp.evaluate(({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === 'about:blank')
    if (!page) throw new Error('New tab was not found')
    const globalState = globalThis as typeof globalThis & { __hronautSearches?: string[] }
    globalState.__hronautSearches = []
    page.session.webRequest.onBeforeRequest({ urls: ['https://www.google.com/*'] }, (details, callback) => {
      globalState.__hronautSearches?.push(details.url)
      callback({ cancel: true })
    })
  })
  const searches = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautSearches?: string[] }).__hronautSearches)

  const addressBar = appWindow.getByRole('combobox', { name: 'Address' })
  await addressBar.fill('site:example.test electron')
  await addressBar.press('Enter')
  await expect.poll(searches).toEqual(['https://www.google.com/search?q=site%3Aexample.test%20electron'])
  await addressBar.fill('TypeError: x is undefined')
  await addressBar.press('Enter')
  await expect.poll(searches).toEqual([
    'https://www.google.com/search?q=site%3Aexample.test%20electron',
    'https://www.google.com/search?q=TypeError%3A%20x%20is%20undefined'
  ])
  // The cancelled searches fail to load here, but neither is refused as an address.
  await expect(appWindow.getByText('Agent workspaces cannot open local, privileged, or credential-bearing browser URLs.')).toHaveCount(0)
})
