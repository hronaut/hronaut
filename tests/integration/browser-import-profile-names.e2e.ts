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
      const scope = globalThis as typeof globalThis & { profileNameConsent?: string; profileNameConfigHome?: string; profileNameChromeConfigHome?: string }
      // A configuration folder the runner names would list its real Firefox and Chrome profiles; without one, HOME's is read.
      scope.profileNameConfigHome = process.env.XDG_CONFIG_HOME
      delete process.env.XDG_CONFIG_HOME
      scope.profileNameChromeConfigHome = process.env.CHROME_CONFIG_HOME
      delete process.env.CHROME_CONFIG_HOME
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
      const scope = globalThis as typeof globalThis & { profileNameConfigHome?: string; profileNameChromeConfigHome?: string }
      if (scope.profileNameConfigHome !== undefined) process.env.XDG_CONFIG_HOME = scope.profileNameConfigHome
      if (scope.profileNameChromeConfigHome !== undefined) process.env.CHROME_CONFIG_HOME = scope.profileNameChromeConfigHome
    }, previousHome)
    await removeTestDirectory(fixtureHome)
  }
})

test('lists Chrome profiles from the configuration folder XDG_CONFIG_HOME names', async ({ appWindow, electronApp }) => {
  // Chrome keeps its profiles there, but Import from browser only looked in ~/.config and listed none.
  const fixtureHome = await mkdtemp(join(tmpdir(), 'hronaut-chrome-config-home-'))
  let changed = false
  try {
    const configHome = join(fixtureHome, 'configured')
    await mkdir(join(fixtureHome, 'home'), { recursive: true })
    await mkdir(join(configHome, 'google-chrome/Default'), { recursive: true })
    await writeFile(join(configHome, 'google-chrome/Default/Cookies'), 'not a cookie database')
    await writeFile(join(configHome, 'google-chrome/Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Configured' } } } }))
    await electronApp.evaluate((_electron, { home, configHome }) => {
      const scope = globalThis as typeof globalThis & { configHomeEnvironment?: Record<string, string | undefined> }
      scope.configHomeEnvironment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CHROME_CONFIG_HOME: process.env.CHROME_CONFIG_HOME }
      process.env.HOME = home
      process.env.XDG_CONFIG_HOME = configHome
      delete process.env.CHROME_CONFIG_HOME
    }, { home: join(fixtureHome, 'home'), configHome })
    changed = true
    const target = await appWindow.evaluate(async () => {
      const state = await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Configured destination', storage: 'scratch' })
      return state.mcpTabGroups.find(group => group.name === 'Configured destination')!.id
    })
    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:home-workspace-editor', { view: 'import', workspaceId: id }), target)
    const panel = appWindow.getByTestId('browser-import-panel')
    await expect(panel.locator('#browser-import-profile option')).toHaveText(['Google Chrome · Configured · Default'])
  } finally {
    if (changed) await electronApp.evaluate(() => {
      const saved = (globalThis as typeof globalThis & { configHomeEnvironment?: Record<string, string | undefined> }).configHomeEnvironment ?? {}
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    })
    await removeTestDirectory(fixtureHome)
  }
})
