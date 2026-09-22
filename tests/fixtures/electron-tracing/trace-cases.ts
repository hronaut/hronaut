import type { Page } from '@playwright/test'
import { closeHronaut, expect, launchHronaut, test } from '../../integration/fixtures.js'

async function interact(window: Page): Promise<void> {
  await window.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Trace fixture</title><h1>Trace fixture</h1>', active: true })")
  await window.getByRole('combobox', { name: 'Address', exact: true }).fill('trace-fixture.invalid')
}

test('fixture failure', async ({ appWindow }) => {
  await interact(appWindow)
  expect('intentional failure').toBe('successful fixture')
})

test('failure after manual restart', async ({ profileDirectory, mcpPort }) => {
  const first = await launchHronaut(profileDirectory, mcpPort)
  try { await interact(first.window) } finally { await closeHronaut(first.app) }
  const second = await launchHronaut(profileDirectory, mcpPort)
  try {
    await interact(second.window)
    expect('intentional failure').toBe('successful restart')
  } finally { await closeHronaut(second.app) }
})

test('passing fixture', async ({ appWindow }) => {
  await interact(appWindow)
  await expect(appWindow.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue('trace-fixture.invalid')
})
