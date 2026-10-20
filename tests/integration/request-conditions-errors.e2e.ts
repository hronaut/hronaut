import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('Request conditions say what to fix in the interface language while agents read why the same request was refused', async ({ capabilities, appWindow }) => {
  // Request conditions showed the English agents read, such as "Network route URL pattern must include a scheme…",
  // in every interface language.
  const { client, tabId, fixtureOrigin, openPageTool } = capabilities
  await openPageTool(/Request conditions/)
  const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
  const form = panel.getByRole('form', { name: 'Add temporary request condition' })
  await form.getByLabel('URL pattern').fill('api.example.test/*')
  await form.getByRole('button', { name: 'Add condition', exact: true }).click()
  await expect(panel.getByRole('alert')).toHaveText('Start the URL pattern with a scheme or with *, for example https://api.example.com/*.')

  await form.getByLabel('URL pattern').fill(`${fixtureOrigin}/mocked`)
  await form.getByLabel('Behavior').selectOption('fulfill')
  await form.getByLabel(/Response headers/).fill('{"content type":"text/plain"}')
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('de-DE')")
  try {
    const germanForm = appWindow.locator('form.request-condition-form')
    await expect(germanForm.getByRole('button', { name: 'Bedingung hinzufügen' })).toBeVisible()
    await germanForm.getByRole('button', { name: 'Bedingung hinzufügen' }).click()
    await expect(appWindow.getByRole('alert').filter({ hasText: 'Antwortheader-Name' })).toHaveText(
      'Ein Antwortheader-Name enthält ein Zeichen, das HTTP nicht zulässt, etwa ein Leerzeichen oder einen Doppelpunkt.'
    )
  } finally {
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
  }

  const agent = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'add', tabId, urlPattern: 'api.example.test/*', abort: 'Failed' }
  }) as CallToolResult
  expect(agent.isError).toBe(true)
  // Agents read only "No configuration command was submitted. Inspect current authority and application health…".
  expect(agent.structuredContent).toMatchObject({
    status: 'NOT_DISPATCHED',
    effects: 'none',
    message: 'Network route URL pattern must include a scheme, for example https://api.example.com/*'
  })
  expect(text(agent)).not.toContain('Start the URL pattern')
  const routes = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'list', tabId } }) as CallToolResult
  expect(JSON.parse(text(routes))).toEqual([])
})
