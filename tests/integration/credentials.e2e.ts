import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { credentialFillPageScript } from '../../src/main/browser/credential-fill-page.js'
import { blockFileDestination, closeFixtureServer, expect, test } from './fixtures.js'
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

  const credentialPath = join(profileDirectory, 'credentials.json')
  const restoreCredentialFile = await blockFileDestination(credentialPath)
  try {
    await removeImportedCredential.click()
    await expect(appWindow.getByRole('alert', { name: 'Remove password failed' })).toBeVisible()
    await expect(removeImportedCredential).toBeVisible()
    await expect(removeImportedCredential).toBeEnabled()
    await expect.poll(() => appWindow.evaluate('window.hronautCredentials.list()')).toEqual(imported)
  } finally {
    await restoreCredentialFile()
  }

  await removeImportedCredential.click()
  await expect(appWindow.getByRole('status', { name: 'Password removed' })).toBeVisible()
  await expect(removeImportedCredential).toHaveCount(0)
  await expect.poll(() => appWindow.evaluate('window.hronautCredentials.list()')).toEqual([
    expect.objectContaining({ origin: 'https://new.example', username: 'new-person' })
  ])
})

test('fills the visible login form instead of hidden or unrelated fields', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Credential fill fixture</title>
      <form hidden><input id="hidden-password" type="password" autocomplete="current-password"></form>
      <form inert><input id="inert-password" type="password" autocomplete="current-password"></form>
      <form><fieldset disabled><input id="disabled-password" type="password" autocomplete="current-password"></fieldset></form>
      <form style="opacity:0"><input id="transparent-password" type="password" autocomplete="current-password"></form>
      <form style="visibility:hidden"><input id="invisible-password" type="password" autocomplete="current-password"></form>
      <form style="content-visibility:hidden"><input id="content-hidden-password" type="password" autocomplete="current-password"></form>
      <form><input id="zero-size-password" style="transform:scale(0)" type="password" autocomplete="current-password"></form>
      <form><input id="offscreen-password" style="position:fixed;left:-10000px;top:0" type="password" autocomplete="current-password"></form>
      <form><label>Unrelated <input id="unrelated-username" name="username" autocomplete="username"></label></form>
      <form id="login-form">
        <label>Email <input id="login-username" type="email" name="email" autocomplete="section-login username"></label>
        <label>Password <input id="login-password" type="password" autocomplete="section-login current-password"></label>
      </form>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Credential fill fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/login`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Credential fill fixture')
    const username = 'person</script>";globalThis.__hronautCredentialFillPwned=true;//\u2028@example.test'
    const password = 'private</script>\u2029password'
    const script = credentialFillPageScript({
      origin: new URL(url).origin,
      url,
      navigationGeneration: 0,
      tabSelectionGeneration: 0
    }, username, password)

    expect(await electronApp.evaluate(async ({ webContents }, input) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
      if (!page) throw new Error('Credential fill fixture WebContents was not found')
      return page.executeJavaScript(input.script, true)
    }, { url, script })).toBe(true)
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) return null
      return page.executeJavaScript(`({
        hiddenPassword: document.querySelector('#hidden-password').value,
        inertPassword: document.querySelector('#inert-password').value,
        disabledPassword: document.querySelector('#disabled-password').value,
        transparentPassword: document.querySelector('#transparent-password').value,
        invisiblePassword: document.querySelector('#invisible-password').value,
        contentHiddenPassword: document.querySelector('#content-hidden-password').value,
        zeroSizePassword: document.querySelector('#zero-size-password').value,
        offscreenPassword: document.querySelector('#offscreen-password').value,
        unrelatedUsername: document.querySelector('#unrelated-username').value,
        username: document.querySelector('#login-username').value,
        password: document.querySelector('#login-password').value,
        focused: document.activeElement?.id,
        injectedSideEffect: globalThis.__hronautCredentialFillPwned
      })`)
    }, url)).toEqual({
      hiddenPassword: '',
      inertPassword: '',
      disabledPassword: '',
      transparentPassword: '',
      invisiblePassword: '',
      contentHiddenPassword: '',
      zeroSizePassword: '',
      offscreenPassword: '',
      unrelatedUsername: '',
      username,
      password,
      focused: 'login-password',
      injectedSideEffect: undefined
    })
  } finally {
    await closeFixtureServer(server)
  }
})

test('requires focus to disambiguate multiple visible login forms', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Ambiguous credential fixture</title>
      <form id="first-form">
        <input id="first-username" autocomplete="username">
        <input id="first-password" type="password" autocomplete="current-password">
      </form>
      <form id="second-form">
        <input id="second-username" autocomplete="username">
        <input id="second-password" type="password" autocomplete="current-password">
      </form>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Ambiguous credential fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/login`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Ambiguous credential fixture')
    const script = credentialFillPageScript({
      origin: new URL(url).origin,
      url,
      navigationGeneration: 0,
      tabSelectionGeneration: 0
    }, 'selected-person', 'selected-password')
    const execute = async (): Promise<boolean> => electronApp.evaluate(async ({ webContents }, input) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
      if (!page) throw new Error('Ambiguous credential fixture WebContents was not found')
      return page.executeJavaScript(input.script, true)
    }, { url, script })
    const values = async (): Promise<string[]> => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Ambiguous credential fixture WebContents was not found')
      return page.executeJavaScript(`[
        document.querySelector('#first-username').value,
        document.querySelector('#first-password').value,
        document.querySelector('#second-username').value,
        document.querySelector('#second-password').value
      ]`)
    }, url)

    expect(await execute()).toBe(false)
    expect(await values()).toEqual(['', '', '', ''])
    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Ambiguous credential fixture WebContents was not found')
      await page.executeJavaScript(`document.querySelector('#second-username').focus()`)
    }, url)
    expect(await execute()).toBe(true)
    expect(await values()).toEqual(['', '', 'selected-person', 'selected-password'])
  } finally {
    await closeFixtureServer(server)
  }
})

test('rejects new-password forms and leaves formless usernames untouched', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/signup') {
      response.end(`<!doctype html><title>New password fixture</title><form>
        <input id="signup-username" autocomplete="username">
        <input id="signup-password" type="password" autocomplete="new-password">
      </form>`)
      return
    }
    response.end(`<!doctype html><title>Formless password fixture</title>
      <input id="global-username" autocomplete="username">
      <input id="formless-password" type="password" autocomplete="current-password">`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Password-purpose fixture did not expose a port')
    const origin = `http://127.0.0.1:${address.port}`
    const execute = async (url: string): Promise<boolean> => {
      const script = credentialFillPageScript({
        origin,
        url,
        navigationGeneration: 0,
        tabSelectionGeneration: 0
      }, 'person', 'private-password')
      return electronApp.evaluate(async ({ webContents }, input) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
        if (!page) throw new Error('Password-purpose fixture WebContents was not found')
        return page.executeJavaScript(input.script, true)
      }, { url, script })
    }

    const signupUrl = `${origin}/signup`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(signupUrl)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('New password fixture')
    expect(await execute(signupUrl)).toBe(false)
    expect(await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript(`[document.querySelector('#signup-username').value, document.querySelector('#signup-password').value]`)
    }, signupUrl)).toEqual(['', ''])

    const formlessUrl = `${origin}/formless`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(formlessUrl)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Formless password fixture')
    expect(await execute(formlessUrl)).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript(`[document.querySelector('#global-username').value, document.querySelector('#formless-password').value]`)
    }, formlessUrl)).toEqual(['', 'private-password'])
  } finally {
    await closeFixtureServer(server)
  }
})
