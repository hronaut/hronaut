import { expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'

type TestWindow = Window & { hronaut: HronautApi }

// A click in the address bar put the caret where it landed, so a new address typed after it went into the middle of
// the page's. Chrome's address bar selects all of its text on the click that gives it the keyboard; the next click, a
// drag, or a click while it has the keyboard place the caret or keep the selection as in any field.
test('a click that gives the address field the keyboard selects the whole address, as in Chrome', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Address click fixture</title><main><p>Page text</p></main>'
  await appWindow.evaluate(async url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), url)
  await expect.poll(() => appWindow.evaluate(async () => (
    (await (window as unknown as TestWindow).hronaut.getState()).tabs.find(tab => tab.active)?.title
  ))).toBe('Address click fixture')
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await expect(address).toHaveValue(url)
  const selection = () => address.evaluate((field) => {
    const input = field as HTMLInputElement
    return [input.selectionStart, input.selectionEnd]
  })
  const elsewhere = () => appWindow.getByRole('button', { name: 'Settings', exact: true }).focus()

  await elsewhere()
  await address.click()
  await expect(address).toBeFocused()
  expect(await selection()).toEqual([0, url.length])
  // The field has the keyboard, so the next click places the caret.
  await address.click()
  const [start, end] = await selection()
  expect(start).toBe(end)

  // What is typed after the click replaces the address.
  await elsewhere()
  await address.click()
  await appWindow.keyboard.type('next.example')
  await expect(address).toHaveValue('next.example')
  await address.press('Escape')
  await expect(address).toHaveValue(url)

  // A right click selects it before the field's menu reads the selection, so the menu can copy it.
  await electronApp.evaluate(({ Menu }) => {
    const shown: Electron.Menu[] = []
    Object.assign(globalThis, { shownClickMenus: shown })
    Menu.prototype.popup = function popup(this: Electron.Menu) { shown.push(this) }
  })
  await elsewhere()
  await address.click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => {
    const shown = (globalThis as unknown as { shownClickMenus: Electron.Menu[] }).shownClickMenus
    return shown.at(-1)?.items.find(item => item.id === 'copy')?.enabled
  })).toBe(true)
  expect(await selection()).toEqual([0, url.length])
})
