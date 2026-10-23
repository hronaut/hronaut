import { expect, test } from './fixtures.js'

// A paste into the address field went in as copied, so `javascript:` text copied from a page, pasted and entered, ran
// as script in the tab. Chrome's address bar drops the scheme from every paste, by key or from its menu.
test('a paste into the address field drops a leading javascript: and joins an address split over lines, as in Chrome', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(async () => (window as unknown as { hronaut: { newTab(options: { active: boolean }): Promise<unknown> } }).hronaut.newTab({ active: true }))
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  const copy = (text: string) => electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
  await address.fill('')

  await copy('javascript:alert(document.cookie)')
  await address.press('ControlOrMeta+v')
  await expect(address).toHaveValue('alert(document.cookie)')
  // The cleaned paste is one step on the field's undo stack, as a plain paste is.
  await address.press('ControlOrMeta+z')
  await expect(address).toHaveValue('')

  await address.fill('old')
  await address.selectText()
  await copy('  https://example.com/a\n  /b  ')
  await address.press('ControlOrMeta+v')
  await expect(address).toHaveValue('https://example.com/a/b')

  // Text that needs nothing dropped pastes as it is.
  await address.fill('')
  await copy('hronaut.dev/docs')
  await address.press('ControlOrMeta+v')
  await expect(address).toHaveValue('hronaut.dev/docs')

  // Paste in the field's own menu reads the text the same way.
  await electronApp.evaluate(({ Menu }) => {
    const shown: Electron.Menu[] = []
    Object.assign(globalThis, { shownPasteMenus: shown })
    Menu.prototype.popup = function popup(this: Electron.Menu) { shown.push(this) }
  })
  await address.fill('')
  await copy('JavaScript:void(0)')
  await address.click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { shownPasteMenus: Electron.Menu[] }).shownPasteMenus.length)).toBe(1)
  await electronApp.evaluate(() => {
    const item = (globalThis as unknown as { shownPasteMenus: Electron.Menu[] }).shownPasteMenus[0]!.items.find(candidate => candidate.id === 'paste')!
    ;(item.click as () => void)()
  })
  await expect(address).toHaveValue('void(0)')

  // Text dropped on the field from a page is read the same way and replaces the field's text. The field takes the
  // keyboard with the text selected, as Chrome's does, so Enter opens it; it stayed where the drag came from.
  await address.fill('old')
  await address.evaluate((field) => (field as HTMLInputElement).blur())
  const transfer = await appWindow.evaluateHandle(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'javascript:alert(2)')
    return data
  })
  await address.dispatchEvent('drop', { dataTransfer: transfer })
  await expect(address).toHaveValue('alert(2)')
  await expect(address).toBeFocused()
  expect(await address.evaluate((field) => [(field as HTMLInputElement).selectionStart, (field as HTMLInputElement).selectionEnd])).toEqual([0, 8])
})
