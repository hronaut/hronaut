import { expect, test } from './fixtures.js'

// Switching tabs gave the page the keyboard, so an address half typed or a word in Find came back without it. As in
// Chrome, which gives a tab its focused view back, the field that had the keyboard when the tab was left takes it back.

test('gives the address field or Find the keyboard back on coming back to its tab, and the page to a tab left in it', async ({
  appWindow, electronApp
}) => {
  type State = { activeTabId: string | null, tabs: Array<{ id: string, title: string }> }
  const state = async () => (await appWindow.evaluate('window.hronaut.getState()')) as State
  const first = 'data:text/html,<title>Focus first</title><p>needle one</p>'
  const second = 'data:text/html,<title>Focus second</title><p>needle two</p>'
  const open = async (url: string, title: string) => {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(async () => { const current = await state(); return current.tabs.find(tab => tab.id === current.activeTabId)?.title }).toBe(title)
    return (await state()).activeTabId!
  }
  const shown = async () => { const current = await state(); return current.tabs.find(tab => tab.id === current.activeTabId)?.title }
  const keyboardAt = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
  // A key pressed in the page that has the keyboard, as the keyboard sends it.
  const pressInPage = async (url: string, keyCode: string, modifiers: Electron.InputEvent['modifiers']) => {
    await expect.poll(keyboardAt).toBe(url)
    await electronApp.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url, keyCode, modifiers })
  }
  const primary = process.platform === 'darwin' ? 'meta' : 'control'
  await appWindow.evaluate(`window.hronautBookmarks.add('https://saved.example/', 'Saved page')`)
  await open(first, 'Focus first')
  await open(second, 'Focus second')
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  const find = appWindow.getByRole('search', { name: 'Find in page' })
  const findField = find.getByRole('searchbox', { name: 'Find text' })
  // Each time the address suggestions open.
  await appWindow.evaluate(() => {
    const field = document.querySelector('[role="combobox"]')!
    Reflect.set(window, 'qaSuggestionsOpened', 0)
    new MutationObserver(() => {
      if (field.getAttribute('aria-expanded') === 'true') Reflect.set(window, 'qaSuggestionsOpened', Number(Reflect.get(window, 'qaSuggestionsOpened')) + 1)
    }).observe(field, { attributes: true, attributeFilter: ['aria-expanded'] })
  })
  const suggestionsOpened = () => appWindow.evaluate(() => Number(Reflect.get(window, 'qaSuggestionsOpened')))

  await appWindow.getByRole('tab', { name: /Focus first/ }).click()
  await expect.poll(shown).toBe('Focus first')
  // Ctrl+L in the page gives Hronaut's window the keyboard, as a click in the address field does.
  await pressInPage(first, 'L', [primary])
  await expect(address).toBeFocused()
  await expect.poll(keyboardAt).toBe(appWindow.url())
  await address.fill('page')
  await expect(address).toHaveAttribute('aria-expanded', 'true')
  await address.evaluate((field: HTMLInputElement) => field.setSelectionRange(1, 3))
  await address.press('Control+Tab')
  await expect.poll(shown).toBe('Focus second')
  // A tab never left with a field gives its page the keyboard, as before.
  await expect.poll(keyboardAt).toBe(second)

  const opened = await suggestionsOpened()
  await pressInPage(second, 'Tab', ['control', 'shift'])
  await expect.poll(shown).toBe('Focus first')
  await expect(address).toBeFocused()
  await expect.poll(keyboardAt).toBe(appWindow.url())
  await expect(address).toHaveValue('page')
  expect(await address.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([1, 3])
  // The suggestions wait for the person to type, as Chrome's do.
  await expect(address).toHaveAttribute('aria-expanded', 'false')
  expect(await suggestionsOpened()).toBe(opened)
  await address.press('End')
  await address.press('Backspace')
  await expect(address).toHaveValue('pag')
  await expect(address).toHaveAttribute('aria-expanded', 'true')

  // Find's field, all its text selected.
  await address.press('Control+Tab')
  await expect.poll(keyboardAt).toBe(second)
  await pressInPage(second, 'F', [primary])
  await expect(findField).toBeFocused()
  await findField.fill('needle')
  await expect(find.locator('.find-count')).toHaveText('1 / 1')
  await findField.press('Control+Shift+Tab')
  await expect.poll(shown).toBe('Focus first')
  await expect(address).toBeFocused()
  await expect(address).toHaveValue('pag')
  await address.press('Control+Tab')
  await expect.poll(shown).toBe('Focus second')
  await expect(findField).toBeFocused()
  expect(await findField.evaluate((field: HTMLInputElement) => [field.value, field.selectionStart, field.selectionEnd])).toEqual(['needle', 0, 6])
  await expect(find.locator('.find-count')).toHaveText('1 / 1')

  // Left with the keyboard in its page, the tab gives it to the page again.
  await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)?.focus(), second)
  await expect.poll(keyboardAt).toBe(second)
  await pressInPage(second, 'Tab', ['control', 'shift'])
  await expect.poll(shown).toBe('Focus first')
  await expect(address).toBeFocused()
  await address.evaluate((field: HTMLInputElement) => field.select())
  await address.press('Control+Tab')
  await expect.poll(shown).toBe('Focus second')
  await expect.poll(keyboardAt).toBe(second)
  await expect(find).toBeVisible()
  await expect(findField).not.toBeFocused()

  // A key held since before the field takes the keyboard back does not repeat into it: a held Delete closing a tab
  // from its row went on to delete the address of the tab shown next.
  await appWindow.getByRole('tab', { name: /Focus second/ }).focus()
  await appWindow.keyboard.down('Delete')
  await expect.poll(shown).toBe('Focus first')
  await expect(address).toBeFocused()
  await appWindow.keyboard.down('Delete')
  await appWindow.keyboard.down('Delete')
  await appWindow.keyboard.up('Delete')
  await expect(address).toHaveValue('pag')
  expect(await address.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([0, 3])
})
