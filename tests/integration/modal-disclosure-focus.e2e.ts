import { expect, test } from './fixtures.js'

test('modal keyboard wrapping skips controls inside collapsed disclosures', async ({ appWindow }) => {
  await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace', exact: true })
  await expect(editor).toBeVisible()
  // Exercise the shared modal trap with a disclosure at the keyboard-loop boundary.
  await editor.evaluate(panel => {
    panel.insertAdjacentHTML('beforeend', `
      <details data-testid="focus-disclosure">
        <summary>Advanced fixture actions</summary>
        <button type="button">Hidden fixture action</button>
        <details open><summary>Nested fixture actions</summary><button type="button">Nested fixture action</button></details>
      </details>
    `)
  })
  const first = editor.locator('button:not(:disabled)').first()
  const disclosure = editor.getByTestId('focus-disclosure')
  const summary = disclosure.locator('summary').first()
  await first.focus()
  await first.press('Shift+Tab')
  await expect(summary).toBeFocused()
  await summary.press('Tab')
  await expect(first).toBeFocused()

  await disclosure.evaluate(element => { (element as HTMLDetailsElement).open = true })
  await first.focus()
  await first.press('Shift+Tab')
  const nested = disclosure.getByRole('button', { name: 'Nested fixture action' })
  await expect(nested).toBeFocused()
  await nested.press('Tab')
  await expect(first).toBeFocused()
})
