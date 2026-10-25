import { writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// Hronaut had no secure DNS setting: Chromium looked up every address in its own Automatic mode. As in Chrome's Use
// secure DNS, a chosen provider now gets every lookup, from startup on, and turning the setting off stops that. The
// provider here only counts the connections Chromium opens to it, so names under .test resolve nowhere.

async function openAddress(window: Page, url: string): Promise<void> {
  await window.evaluate('window.hronaut.newTab({ active: true })')
  const address = window.getByRole('combobox', { name: 'Address', exact: true })
  await address.fill(url)
  await address.press('Enter')
  await expect.poll(
    () => window.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem)'),
    { timeout: 30_000 }
  ).toMatchObject({ kind: 'load-error', url, errorDescription: 'ERR_NAME_NOT_RESOLVED' })
}

test('looks up addresses through the chosen secure DNS provider from startup, and stops when it is turned off', async ({ profileDirectory, mcpPort }) => {
  let connections = 0
  const provider = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject)
    provider.listen(0, '127.0.0.1', () => resolve())
  })
  const template = `https://127.0.0.1:${(provider.address() as { port: number }).port}/dns-query`
  const settingsPath = join(profileDirectory, 'settings.json')
  const saved = async () => {
    const { secureDnsMode, secureDnsTemplate } = JSON.parse(await readFile(settingsPath, 'utf8'))
    return { secureDnsMode, secureDnsTemplate }
  }
  await writeFile(settingsPath, `${JSON.stringify({
    theme: 'system', interfaceScale: 1, tabPosition: 'top', mcpToolSet: 'complete', mcpAuthentication: false,
    secureDnsMode: 'secure', secureDnsTemplate: template
  }, null, 2)}\n`, 'utf8')

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const { window } = instance
    await openAddress(window, 'http://hronaut-secure-dns-startup.test/')
    expect(connections).toBeGreaterThan(0)

    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('button', { name: /Workspaces & data/ }).click()
    const secureDns = window.getByRole('tabpanel', { name: 'Settings' }).getByRole('region', { name: 'Secure DNS' })
    const use = secureDns.getByRole('checkbox', { name: /Use secure DNS/ })
    await expect(use).toBeChecked()
    await expect(secureDns.getByRole('combobox', { name: /Provider/ })).toHaveValue('custom')
    await expect(secureDns.getByLabel('Provider address')).toHaveValue(template)

    // Off, the provider gets nothing more.
    await use.click()
    await expect(use).not.toBeChecked()
    await expect.poll(saved).toEqual({ secureDnsMode: 'off', secureDnsTemplate: template })
    await window.getByRole('button', { name: 'Close settings' }).click()
    connections = 0
    await openAddress(window, 'http://hronaut-secure-dns-off.test/')
    expect(connections).toBe(0)

    // On again, it starts with the DNS service's own secure DNS, and a provider typed in becomes the one asked.
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('button', { name: /Workspaces & data/ }).click()
    await use.click()
    const choice = secureDns.getByRole('combobox', { name: /Provider/ })
    await expect(choice).toHaveValue('automatic')
    await expect.poll(saved).toEqual({ secureDnsMode: 'automatic', secureDnsTemplate: template })
    await choice.selectOption({ label: 'Custom' })
    const field = secureDns.getByLabel('Provider address')
    // The custom provider used last is filled in again.
    await expect(field).toBeFocused()
    await expect(field).toHaveValue(template)
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await window.keyboard.type(` ${template} `)
    await window.keyboard.press('Enter')
    await expect.poll(saved).toEqual({ secureDnsMode: 'secure', secureDnsTemplate: template })
    await expect(choice).toHaveValue('custom')
    await window.getByRole('button', { name: 'Close settings' }).click()
    connections = 0
    await openAddress(window, 'http://hronaut-secure-dns-custom.test/')
    expect(connections).toBeGreaterThan(0)
  } finally {
    await closeHronaut(instance.app)
    await closeFixtureServer(provider)
  }
})
