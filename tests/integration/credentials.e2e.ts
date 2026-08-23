import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'
import type { BrowserState, CredentialStorageStatus, CredentialSummary } from '../../src/shared/types.js'

test('exposes metadata-only password controls and fails closed without secure storage', async ({ appWindow }) => {
  const state = await appWindow.evaluate(`Promise.all([
    window.hronautCredentials.status(),
    window.hronautCredentials.list(),
    window.hronaut.getState()
  ]).then(([status, credentials, browser]) => ({ status, credentials, browser }))`) as {
    status: CredentialStorageStatus
    credentials: CredentialSummary[]
    browser: BrowserState
  }
  expect(state.credentials).toEqual([])
  expect(Object.keys(state.status).sort()).toEqual(expect.arrayContaining(['available']))
  await expect(appWindow.getByRole('button', { name: 'No saved password for this site' })).toHaveCount(0)
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(pageTools.getByRole('button', { name: 'No saved password for this site' })).toBeDisabled()
  await pageTools.getByRole('button', { name: 'Close page tools' }).click()
  expect(await appWindow.evaluate(`window.hronautCredentials.fill(${JSON.stringify(state.browser.activeTabId)}, 'missing-credential')`)).toBe(false)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: 'Passwords' }).click()
  await expect(appWindow.getByRole('button', { name: 'Reset to default' })).toHaveCount(0)
  if (state.status.available) {
    await expect(appWindow.getByText('No saved passwords')).toBeVisible()
    await expect(appWindow.getByText(new RegExp(`Encrypted by ${state.status.backend}`))).toBeVisible()
  } else {
    await expect(appWindow.getByText(state.status.reason!)).toBeVisible()
  }
})

test('imports a confirmed browser CSV without exposing plaintext outside the main process', async ({
  appWindow,
  electronApp,
  profileDirectory
}) => {
  const status = await appWindow.evaluate('window.hronautCredentials.status()') as CredentialStorageStatus
  if (!status.available) {
    await expect(appWindow.evaluate('window.hronautCredentials.importFromCsv()')).rejects.toThrow(status.reason)
    return
  }

  const csvPath = join(profileDirectory, 'browser-passwords.csv')
  await writeFile(csvPath, [
    'name,url,username,password,note',
    'Existing,https://example.test/login,person,first-browser-secret,',
    'Existing duplicate,https://example.test/account,person,final-browser-secret,',
    'New,https://new.example/sign-in,new-person,new-browser-secret,',
    'Unsafe,javascript:alert(1),attacker,unsafe-browser-secret,'
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })

  await electronApp.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, csvPath)
  expect(await appWindow.evaluate('window.hronautCredentials.importFromCsv()')).toEqual({
    canceled: true,
    added: 0,
    updated: 0,
    skipped: 0
  })
  expect(await appWindow.evaluate('window.hronautCredentials.list()')).toEqual([])

  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  expect(await appWindow.evaluate('window.hronautCredentials.importFromCsv()')).toEqual({
    canceled: false,
    added: 2,
    updated: 0,
    skipped: 2
  })
  const imported = await appWindow.evaluate('window.hronautCredentials.list()') as CredentialSummary[]
  expect(imported).toEqual([
    expect.objectContaining({ origin: 'https://example.test', username: 'person' }),
    expect.objectContaining({ origin: 'https://new.example', username: 'new-person' })
  ])
  expect(imported.every((entry) => Object.keys(entry).every((key) => key !== 'password' && key !== 'encryptedPassword'))).toBe(true)
  const persisted = await readFile(join(profileDirectory, 'credentials.json'), 'utf8')
  expect(persisted).not.toContain('browser-secret')
  expect(persisted).not.toContain(csvPath)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: 'Passwords' }).click()
  const removeImportedCredential = appWindow.getByRole('button', {
    name: 'Remove saved password for person on https://example.test'
  })
  await expect(removeImportedCredential).toBeVisible()

  const blockedTemporaryPath = join(profileDirectory, 'credentials.json.tmp')
  await rm(blockedTemporaryPath, { recursive: true, force: true })
  await mkdir(blockedTemporaryPath)
  try {
    await removeImportedCredential.click()
    await expect(appWindow.getByRole('alert', { name: 'Remove password failed' })).toBeVisible()
    await expect(removeImportedCredential).toBeVisible()
    await expect(removeImportedCredential).toBeEnabled()
    await expect.poll(() => appWindow.evaluate('window.hronautCredentials.list()')).toEqual(imported)
  } finally {
    await rm(blockedTemporaryPath, { recursive: true, force: true })
  }

  await removeImportedCredential.click()
  await expect(appWindow.getByRole('status', { name: 'Password removed' })).toBeVisible()
  await expect(removeImportedCredential).toHaveCount(0)
  await expect.poll(() => appWindow.evaluate('window.hronautCredentials.list()')).toEqual([
    expect.objectContaining({ origin: 'https://new.example', username: 'new-person' })
  ])
})
