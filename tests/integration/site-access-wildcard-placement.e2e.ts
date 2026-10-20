import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('refuses a Site access rule whose * could never match a site', async ({ appWindow }) => {
  await appWindow.getByRole('button', { name: 'Create workspace' }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace' })
  await editor.locator('.workspace-access-disclosure > summary').click()
  await editor.getByRole('textbox', { name: 'Workspace name' }).fill('Local subdomains')
  await editor.getByText('Only listed sites', { exact: true }).click()
  // Meant as every localhost subdomain on any port; it used to be saved as written and match nothing.
  await editor.getByRole('textbox', { name: 'Allowed site rules' }).fill('http://*.localhost:*')
  await editor.getByRole('button', { name: 'Create workspace' }).click()

  await expect(editor.getByText(
    'A * can only start a subdomain rule, such as *.example.com, or stand for the port of a loopback host, such as http://localhost:*.'
  )).toBeVisible()
  await expect(editor).toBeVisible()
  const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
  expect(state.mcpTabGroups.some((workspace) => workspace.name === 'Local subdomains')).toBe(false)
})
