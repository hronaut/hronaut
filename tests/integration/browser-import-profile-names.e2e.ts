import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './fixtures.js'
import { removeTestDirectory } from '../helpers/remove-test-directory.js'
import type { HronautApi } from '../../src/shared/types.js'

test('shows browser display names and preserves the selected duplicate-name profile at consent', async ({ appWindow, electronApp }, testInfo) => {
  const fixtureHome = await mkdtemp(join(tmpdir(), 'hronaut-profile-names-'))
  let previousHome: string | undefined
  let homeChanged = false
  try {
    const chrome = join(fixtureHome, '.config/google-chrome')
    for (const folder of ['Default', 'Profile 10', 'Profile 2']) {
      await mkdir(join(chrome, folder), { recursive: true })
      // Discovery/declined consent must not try to open this as a cookie database.
      await writeFile(join(chrome, folder, 'Cookies'), 'not a cookie database')
    }
    await writeFile(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: {
      Default: { name: 'Person 1', is_using_default_name: true, gaia_given_name: 'Avery' },
      'Profile 10': { name: 'Person 10', is_using_default_name: true, gaia_given_name: 'Avery', user_name: 'private-account@example.test' }
    } } }))
    await writeFile(join(chrome, 'Profile 2/Preferences'), JSON.stringify({ profile: { name: 'Personal' } }))
    const firefox = join(fixtureHome, '.mozilla/firefox')
    await mkdir(join(firefox, 'fixture'), { recursive: true })
    await writeFile(join(firefox, 'fixture/cookies.sqlite'), 'not a cookie database')
    await writeFile(join(firefox, 'profiles.ini'), '[Profile0]\nName=個人 🚀\nIsRelative=1\nPath=fixture\n')
    previousHome = await electronApp.evaluate(({ dialog }, home) => {
      const previous = process.env.HOME
      process.env.HOME = home
      const scope = globalThis as typeof globalThis & { profileNameConsent?: string }
      dialog.showMessageBox = async (...args: unknown[]) => {
        scope.profileNameConsent = JSON.stringify(args.at(-1))
        return { response: 0, checkboxChecked: false }
      }
      return previous
    }, fixtureHome)
    homeChanged = true
    const target = await appWindow.evaluate(async () => {
      const state = await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Profile name destination', storage: 'scratch' })
      return state.mcpTabGroups.find(group => group.name === 'Profile name destination')!.id
    })
    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:home-workspace-editor', { view: 'import', workspaceId: id }), target)
    const panel = appWindow.getByTestId('browser-import-panel')
    const picker = panel.locator('#browser-import-profile')
    await expect(picker.locator('option')).toHaveCount(4)
    expect(await picker.locator('option').allTextContents()).toEqual([
      'Google Chrome · Avery · Default', 'Google Chrome · Avery · Profile 10',
      'Google Chrome · Personal · Profile 2', 'Firefox · 個人 🚀 · fixture'
    ])
    const ids = await picker.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))
    expect(new Set(ids).size).toBe(4)
    await picker.selectOption({ label: 'Google Chrome · Avery · Profile 10' })
    await appWindow.screenshot({ path: testInfo.outputPath('profile-display-names.png') })
    await panel.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { profileNameConsent?: string }).profileNameConsent)).toContain('Avery · Profile 10')
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
    expect(await panel.textContent()).not.toContain('private-account@example.test')
    expect(await panel.textContent()).not.toContain(fixtureHome)
  } finally {
    if (homeChanged) await electronApp.evaluate((_electron, previous) => {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }, previousHome)
    await removeTestDirectory(fixtureHome)
  }
})
