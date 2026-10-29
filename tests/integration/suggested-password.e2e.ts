import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { credentialFillContext } from '../../src/main/browser/credential-fill-context.js'
import { ISOLATED_WORLDS } from '../../src/main/browser/isolated-worlds.js'
import { suggestedPasswordFieldScript, suggestedPasswordFillScript } from '../../src/main/browser/suggested-password/suggested-password-page.js'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { CredentialStorageStatus } from '../../src/shared/types.js'

const exec = promisify(execFile)

type MenuItemState = { id: string; label: string; enabled: boolean }

const SIGN_UP = `<!doctype html>
  <title>Sign up fixture</title>
  <form id="sign-up" style="display:grid;gap:12px;width:280px;padding:24px">
    <input id="email" type="email" autocomplete="username">
    <input id="new" type="password" autocomplete="new-password" style="height:32px">
    <div style="display:none"><input id="ghost" type="text"></div>
    <input id="confirm" type="password" autocomplete="new-password">
    <input id="decoy" type="password" style="opacity:0">
    <!-- Two fields named "elements" stand in for the form's own list of fields. -->
    <input type="hidden" name="elements"><input type="hidden" name="elements">
  </form>
  <account-form></account-form>
  <script>
    globalThis.__inputs = []
    document.addEventListener('input', (event) => __inputs.push(event.composedPath()[0].id))
    const root = document.querySelector('account-form').attachShadow({ mode: 'open' })
    root.innerHTML = '<input id="shadow-new" type="password"><input id="shadow-confirm" type="password">'
    // A page that watches the value setter, as a framework does, never sees Hronaut's fill through it.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'),
      set(value) { globalThis.__setterCalls = (globalThis.__setterCalls || 0) + 1; setter.call(this, value) }
    })
  </script>`

test('fills a suggested password into a real page and the field confirming it, as typing would', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(SIGN_UP)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/sign-up`
  const context = credentialFillContext(url, 0, 0)!
  // The page's own script, in its main world.
  const run = (code: string): Promise<unknown> => electronApp.evaluate(async ({ webContents }, input) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
    if (!page) throw new Error('Sign up fixture WebContents was not found')
    return page.executeJavaScript(input.code, true)
  }, { url, code })
  // Hronaut's suggestion, in its own isolated world, as the menu item runs it.
  const suggest = (code: string): Promise<unknown> => electronApp.evaluate(async ({ webContents }, input) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
    if (!page) throw new Error('Sign up fixture WebContents was not found')
    return page.executeJavaScriptInIsolatedWorld(input.world, [{ code: input.code }], true)
  }, { url, code, world: ISOLATED_WORLDS.suggestedPassword })
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Sign up fixture')

    await run(`document.querySelector('#new').focus()`)
    expect(await suggest(suggestedPasswordFieldScript(context))).toEqual({ minLength: -1, maxLength: -1 })
    expect(await suggest(suggestedPasswordFillScript(context, 'k7Gm2xPqR9sTv4w'))).toBe('filled')
    // The field shown nowhere sits between the two, so the second password field still confirms the first; the
    // transparent one after them gets nothing.
    expect(await run(`({
      email: document.querySelector('#email').value,
      password: document.querySelector('#new').value,
      confirmation: document.querySelector('#confirm').value,
      ghost: document.querySelector('#ghost').value,
      decoy: document.querySelector('#decoy').value,
      focused: document.activeElement.id,
      inputs: __inputs.splice(0),
      setterCalls: globalThis.__setterCalls,
      field: globalThis.__hronautSuggestedPasswordField
    })`)).toEqual({
      email: '',
      password: 'k7Gm2xPqR9sTv4w',
      confirmation: 'k7Gm2xPqR9sTv4w',
      ghost: '',
      decoy: '',
      focused: 'new',
      inputs: ['new', 'confirm'],
      setterCalls: undefined,
      field: undefined
    })

    // A sign-up form built in a shadow root, whose submission Hronaut could not see, gets no suggestion.
    await run(`document.querySelector('account-form').shadowRoot.querySelector('#shadow-new').focus()`)
    expect(await suggest(suggestedPasswordFieldScript(context))).toBeNull()
    expect(await suggest(suggestedPasswordFillScript(context, 'k7Gm2xPqR9sTv4w'))).toBe('none')
    expect(await run(`document.querySelector('account-form').shadowRoot.querySelector('#shadow-new').value`)).toBe('')
  } finally {
    await closeFixtureServer(server)
  }
})

test('a right-click focuses the password field, whose menu suggests a password only while passwords can be saved', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(SIGN_UP)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/sign-up`
  const pageValue = (code: string): Promise<unknown> => electronApp.evaluate(async ({ webContents }, input) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
    return page?.executeJavaScript(input.code)
  }, { url, code })
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect(appWindow.getByRole('tab', { name: /Sign up fixture/ })).toBeVisible()
    await expect.poll(() => pageValue('document.readyState')).toBe('complete')
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const point = await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, pageUrl) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children
        .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === pageUrl)
      if (!view) throw new Error('Sign up fixture view was not found')
      const center = await view.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#new').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`) as { x: number; y: number }
      const origin = window.getContentBounds()
      const bounds = view.getBounds()
      return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
    }, url)
    await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(point.x), String(point.y), '--right-click'])
    let items: MenuItemState[] = []
    await expect.poll(async () => {
      items = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.items
        .filter(item => item.type !== 'separator')
        .map(item => ({ id: item.id, label: item.label, enabled: item.enabled })) ?? [])
      return items.length
    }).toBeGreaterThan(0)
    // The suggestion fills the focused field, which the right-click focused, as a click does.
    expect(await pageValue('document.activeElement.id')).toBe('new')

    const status = await appWindow.evaluate('window.hronautCredentials.status()') as CredentialStorageStatus
    const ids = items.map(item => item.id)
    if (!status.available) {
      // Without secure storage a suggested password could never be filled in again, so none is offered.
      expect(ids).toContain('select-all')
      expect(ids).not.toContain('suggest-strong-password')
      return
    }
    expect(ids.slice(ids.indexOf('select-all'), ids.indexOf('select-all') + 2)).toEqual(['select-all', 'suggest-strong-password'])
    expect(items.find(item => item.id === 'suggest-strong-password')).toEqual({ id: 'suggest-strong-password', label: 'Suggest Strong Password', enabled: true })
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById('suggest-strong-password')
      ;(item!.click as unknown as () => void)()
    })
    await expect.poll(() => pageValue(`[document.querySelector('#new').value, document.querySelector('#confirm').value]`))
      .toEqual([expect.stringMatching(/^[a-km-np-zA-HJ-NP-Z2-9]{15}$/u), expect.stringMatching(/^[a-km-np-zA-HJ-NP-Z2-9]{15}$/u)])
    const [password, confirmation] = await pageValue(`[document.querySelector('#new').value, document.querySelector('#confirm').value]`) as string[]
    expect(confirmation).toBe(password)
  } finally {
    await closeFixtureServer(server)
  }
})
