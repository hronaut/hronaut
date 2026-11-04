import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

type MenuItemState = { id: string; label: string; checked: boolean }

// Websites' text fields always checked spelling, with no switch to turn it off as Chrome's Spell check has. Settings →
// General and a text field's menu now turn it off and on for every website.

test('turns spell checking off from a text field menu and back on in Settings, for every website', async ({ appWindow, electronApp, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Spell check fixture</title><textarea id="note" rows="4" cols="40">Ths note has a tset</textarea>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/compose`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Spell check fixture/ })).toBeVisible()
    // The sessions of the website and of Home, which belong to different workspaces.
    const checking = (): Promise<{ page?: boolean; home?: boolean }> => electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents()
      return {
        page: contents.find(candidate => candidate.getURL() === url)?.session.isSpellCheckerEnabled(),
        home: contents.find(candidate => candidate.getURL().startsWith('hronaut://home'))?.session.isSpellCheckerEnabled()
      }
    }, url)
    expect(await checking()).toEqual({ page: true, home: true })

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    // A real right-click on the screen, at the text field.
    const point = await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, url) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children
        .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === url)
      if (!view) throw new Error('Spell check fixture view was not found')
      const center = await view.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#note').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`) as { x: number; y: number }
      const origin = window.getContentBounds()
      const bounds = view.getBounds()
      return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
    }, url)
    await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(point.x), String(point.y), '--right-click'])
    const menuIds = (): Promise<string[]> => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu })
      .__hronautContextMenu?.items.filter(item => item.type !== 'separator').map(item => item.id) ?? [])
    await expect.poll(menuIds).toContain('select-all')
    const spellCheck = (): Promise<{ label?: string; items: MenuItemState[] }> => electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById('spell-check')
      return { label: item?.label, items: item?.submenu?.items.map(entry => ({ id: entry.id, label: entry.label, checked: entry.checked })) ?? [] }
    })
    expect(await spellCheck()).toEqual({
      label: 'Spell check',
      items: [
        { id: 'check-spelling', label: 'Check the spelling of text fields', checked: true },
        { id: 'spell-check-language-settings', label: 'Language settings', checked: false }
      ]
    })

    // Choosing the item flips its checkbox, as the menu does when it is clicked.
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu!.getMenuItemById('check-spelling')!
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(checking).toEqual({ page: false, home: false })
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).spellCheck).toBe(false)

    // The shell heard of the change, so Settings shows it, and its switch turns checking back on everywhere.
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.locator('.settings-nav-item').nth(0).click()
    const setting = appWindow.getByRole('checkbox', { name: /^Spell check/ })
    await expect(setting).not.toBeChecked()
    await setting.check()
    await expect.poll(checking).toEqual({ page: true, home: true })
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).spellCheck).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})

// Chromium checked only the language for the system locale, with no way to add one, as Chrome's spell check languages
// allow. Settings → General now lists them, and a text field's Spell check → Language settings opens it.

test('checks spelling in the languages chosen in Settings, for every website, from a text field menu\'s Language settings', async ({ appWindow, electronApp, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Spell check languages fixture</title><textarea id="note" rows="4" cols="40">Ths note</textarea>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/compose`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Spell check languages fixture/ })).toBeVisible()
    // The languages of the website's session and of Home's, which belong to different workspaces.
    const languages = (): Promise<{ page?: string[]; home?: string[] }> => electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents()
      return {
        page: contents.find(candidate => candidate.getURL() === url)?.session.getSpellCheckerLanguages(),
        home: contents.find(candidate => candidate.getURL().startsWith('hronaut://home'))?.session.getSpellCheckerLanguages()
      }
    }, url)
    // Hronaut runs in American English here, so that is the language checked while none is chosen.
    expect(await electronApp.evaluate(({ app }) => app.getLocale())).toBe('en-US')
    expect(await languages()).toEqual({ page: ['en-US'], home: ['en-US'] })

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    // A real right-click on the screen, at the text field.
    const point = await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, url) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children
        .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === url)
      if (!view) throw new Error('Spell check languages fixture view was not found')
      const center = await view.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#note').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`) as { x: number; y: number }
      const origin = window.getContentBounds()
      const bounds = view.getBounds()
      return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
    }, url)
    await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(point.x), String(point.y), '--right-click'])
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu })
      .__hronautContextMenu?.getMenuItemById('spell-check-language-settings')))).toBe(true)
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu!.getMenuItemById('spell-check-language-settings')!
      ;(item.click as unknown as () => void)()
    })

    // Settings opens on General, with the automatic language listed.
    const list = appWindow.getByRole('list', { name: 'Spell check languages' })
    await expect(list).toBeVisible()
    await expect(list.getByRole('listitem')).toHaveText(['American English'])
    // Chosen from the keyboard: focus stays on the select, which the save disables for a moment.
    const add = appWindow.getByRole('combobox', { name: 'Add language' })
    await add.focus()
    await add.selectOption({ label: 'Ukrainian' })
    await expect(list.getByRole('listitem')).toHaveText(['American English', 'Ukrainian'])
    await expect(add).toBeFocused()
    await expect.poll(languages).toEqual({ page: ['en-US', 'uk'], home: ['en-US', 'uk'] })
    const saved = async (): Promise<unknown> => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).spellCheckLanguages
    await expect.poll(saved).toEqual(['en-US', 'uk'])

    await appWindow.getByRole('button', { name: 'Remove American English' }).click()
    await expect(list.getByRole('listitem')).toHaveText(['Ukrainian'])
    await expect.poll(languages).toEqual({ page: ['uk'], home: ['uk'] })
    await expect.poll(saved).toEqual(['uk'])
    // The last language stays.
    await expect(appWindow.getByRole('button', { name: 'Remove Ukrainian' })).toHaveAttribute('aria-disabled', 'true')
  } finally {
    await closeFixtureServer(server)
  }
})

// Add to dictionary wrote the word only to the page's own session, so it stayed misspelled in every other workspace,
// such as Home's. Chromium marks a misspelling only with a dictionary it downloads, so the menu is asked for here with
// Electron's own parameters for a misspelled word, rather than found by a right-click.
test('adds a misspelled word to the dictionary of every workspace from a text field menu', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Dictionary fixture</title><textarea id="note" rows="4" cols="40">Zorblaxian</textarea>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/compose`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Dictionary fixture/ })).toBeVisible()
    // The words in the dictionaries of the website's session and of Home's, which belong to different workspaces.
    const words = (): Promise<{ page?: string[]; home?: string[]; separate: boolean }> => electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents()
      const page = contents.find(candidate => candidate.getURL() === url)?.session
      const home = contents.find(candidate => candidate.getURL().startsWith('hronaut://home'))?.session
      return { page: await page?.listWordsInSpellCheckerDictionary(), home: await home?.listWordsInSpellCheckerDictionary(), separate: page !== home }
    }, url)
    expect(await words()).toEqual({ page: [], home: [], separate: true })

    await electronApp.evaluate(({ Menu, webContents }, url) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      contents.emit('context-menu', { preventDefault: () => undefined }, {
        x: 20, y: 20, linkURL: '', linkText: '', pageURL: url, frameURL: url, srcURL: '', mediaType: 'none', hasImageContents: false,
        // A right-click on a misspelled word selects it.
        isEditable: true, selectionText: 'Zorblaxian', titleText: '', altText: '', suggestedFilename: '', misspelledWord: 'Zorblaxian',
        dictionarySuggestions: [], frameCharset: 'UTF-8', formControlType: 'text-area', spellcheckEnabled: true, menuSourceType: 'mouse',
        mediaFlags: { inError: false, isPaused: false, isMuted: false, canSave: false, hasAudio: false, isLooping: false, isControlsVisible: false,
          canToggleControls: false, canPrint: false, canRotate: false, canShowPictureInPicture: false, isShowingPictureInPicture: false,
          canLoop: false },
        editFlags: { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false },
        selectionRect: { x: 4, y: 4, width: 80, height: 16 }, selectionStartOffset: 0, referrerPolicy: 'strict-origin-when-cross-origin',
        frame: contents.mainFrame
      })
    }, url)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu })
      .__hronautContextMenu?.getMenuItemById('add-to-dictionary')?.label)).toBe('Add “Zorblaxian” to Dictionary')
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu!.getMenuItemById('add-to-dictionary')!
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(words).toEqual({ page: ['Zorblaxian'], home: ['Zorblaxian'], separate: true })

    // A workspace made afterwards gets the word too.
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Later', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const later = created.mcpTabGroups.find(group => group.name === 'Later')!.id
    const laterUrl = `${url}?later`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(laterUrl)}, mcpGroupId: ${JSON.stringify(later)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, { url, laterUrl }) => {
      const contents = webContents.getAllWebContents()
      const page = contents.find(candidate => candidate.getURL() === url)?.session
      const laterSession = contents.find(candidate => candidate.getURL() === laterUrl)?.session
      return laterSession && laterSession !== page ? await laterSession.listWordsInSpellCheckerDictionary() : null
    }, { url, laterUrl })).toEqual(['Zorblaxian'])
  } finally {
    await closeFixtureServer(server)
  }
})
