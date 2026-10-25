import { expect, test } from './fixtures.js'

// The address bar had no keyword search: "bing.com" and Tab left the field, and "bing.com cats" searched the default
// engine for the whole text. Chrome offers Tab to search an engine whose site is typed, and Tab, or a space after the
// site, turns the field into a search box for that engine. The keys are real key presses.

test('searches an engine by its site with Tab or a space, as in Chrome, and Backspace gives the site back', async ({ appWindow, electronApp }) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().filter((contents) => contents.getURL() === 'about:blank').length
  ))).toBe(1)
  // The search engines are out of reach here: note the searches the tab asks for, and cancel them.
  await electronApp.evaluate(({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === 'about:blank')
    if (!page) throw new Error('New tab was not found')
    const globalState = globalThis as typeof globalThis & { __hronautSearches?: string[] }
    globalState.__hronautSearches = []
    page.session.webRequest.onBeforeRequest({ urls: ['https://www.bing.com/*', 'https://duckduckgo.com/*', 'https://www.google.com/*'] }, (details, callback) => {
      if (details.resourceType === 'mainFrame') globalState.__hronautSearches?.push(details.url)
      callback({ cancel: true })
    })
  })
  const searches = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautSearches?: string[] }).__hronautSearches)
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  const hint = appWindow.locator('.address-keyword-hint')
  const chip = appWindow.locator('#address-keyword')

  // The site typed offers Tab to search it; Tab takes the site away and leaves a chip naming the engine, with the
  // keyboard still in the field.
  await address.click()
  await address.pressSequentially('bing.com')
  await expect(hint).toHaveText('Press Tab to search Bing')
  await address.press('Tab')
  await expect(chip).toHaveText('Search Bing')
  await expect(hint).toHaveCount(0)
  await expect(address).toBeFocused()
  await expect(address).toHaveValue('')
  await expect(address).toHaveAttribute('aria-expanded', 'false')
  await address.pressSequentially('cats')
  await address.press('Enter')
  await expect.poll(searches).toEqual(['https://www.bing.com/search?q=cats'])

  // A space after the site takes it too, and Backspace at the start of the search gives the site back.
  await address.click()
  await address.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await address.pressSequentially('duckduckgo.com a b')
  await expect(chip).toHaveText('Search DuckDuckGo')
  await expect(address).toHaveValue('a b')
  await address.press('Home')
  await address.press('Backspace')
  await expect(chip).toHaveCount(0)
  await expect(address).toHaveValue('duckduckgo.com a b')
  // The caret is after the site, so a space takes it again with the search as it was.
  await address.press('Space')
  await expect(chip).toHaveText('Search DuckDuckGo')
  await expect(address).toHaveValue('a b')
  await address.press('Enter')
  await expect.poll(searches).toEqual(['https://www.bing.com/search?q=cats', 'https://duckduckgo.com/?q=a%20b'])

  // Escape leaves the search; what is typed next is an address or a search of the default engine again.
  await address.click()
  await address.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await address.pressSequentially('bing.com dogs')
  await expect(chip).toHaveText('Search Bing')
  // Shift+Tab gives the site back too, and keeps the keyboard in the field.
  await address.press('Shift+Tab')
  await expect(chip).toHaveCount(0)
  await expect(address).toHaveValue('bing.com dogs')
  await expect(address).toBeFocused()
  await address.press('Space')
  await expect(chip).toHaveText('Search Bing')
  await address.press('Escape')
  await expect(chip).toHaveCount(0)
  await address.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await address.pressSequentially('dogs')
  await address.press('Enter')
  await expect.poll(searches).toEqual([
    'https://www.bing.com/search?q=cats',
    'https://duckduckgo.com/?q=a%20b',
    'https://www.google.com/search?q=dogs'
  ])
})
