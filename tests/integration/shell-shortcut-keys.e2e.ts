import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Keys typed right after Ctrl/Cmd+L, Ctrl/Cmd+F or the history key in a page, while Hronaut's window was busy, reached
// the window before the shortcut did: they went where the window had the keyboard before, such as after the address's
// text, which the address field then selected. Chrome runs its keys in order, so they go to the field the shortcut gives
// the keyboard to.

/**
 * Presses the shortcut in the page as Hronaut's window starts a long task, such as drawing many tabs, then types into
 * the window as soon as it has the keyboard, as a quick typist does: each key down, its text and its release.
 */
async function pressThenType(electronApp: ElectronApplication, request: { pageUrl: string, shellUrl: string, key: string, text: string }) {
  await electronApp.evaluate(async ({ webContents }, { pageUrl, shellUrl, key, text }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
    const shell = webContents.getAllWebContents().find((contents) => contents.getURL() === shellUrl)
    if (!page || !shell) throw new Error('The page or Hronaut\'s window was not found')
    page.focus()
    await new Promise((resolve) => setTimeout(resolve, 100))
    void shell.executeJavaScript('setTimeout(() => { const start = performance.now(); while (performance.now() - start < 150); }, 0)')
    const modifier = process.platform === 'darwin' ? 'meta' as const : 'control' as const
    page.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: [modifier] })
    page.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: [modifier] })
    const start = Date.now()
    while (webContents.getFocusedWebContents()?.id !== shell.id && Date.now() - start < 3000) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    for (const character of text) {
      const keyCode = character === '\r' ? 'Enter' : character
      shell.sendInputEvent({ type: 'keyDown', keyCode })
      shell.sendInputEvent({ type: 'char', keyCode: character })
      shell.sendInputEvent({ type: 'keyUp', keyCode })
    }
  }, request)
}

test('keys typed right after Ctrl/Cmd+L, Ctrl/Cmd+F or the history key in a page go to the field it gives the keyboard to', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url === '/next' ? '<!doctype html><title>Keys next</title><p>next</p>' : '<!doctype html><title>Keys first</title><p>first</p>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const origin = `127.0.0.1:${(server.address() as AddressInfo).port}`
    const pageUrl = `http://${origin}/`
    const shellUrl = appWindow.url()
    const shown = () => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active))') as Promise<{ title: string, url: string } | undefined>
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(pageUrl)}, active: true })`)
    await expect.poll(async () => (await shown())?.title).toBe('Keys first')
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    const findField = appWindow.getByRole('search', { name: 'Find in page' }).getByRole('searchbox', { name: 'Find text' })
    /** The address field had the keyboard last in Hronaut's window, with the caret after its text. */
    const leaveCaretInAddress = async () => {
      await address.focus()
      await address.evaluate((field: HTMLInputElement) => field.setSelectionRange(field.value.length, field.value.length))
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await leaveCaretInAddress()
      await pressThenType(electronApp, { pageUrl, shellUrl, key: 'L', text: 'typed' })
      await expect(address).toBeFocused()
      await expect(address).toHaveValue('typed')
      await appWindow.keyboard.press('Escape')
      await appWindow.keyboard.press('Escape')
      await expect(address).toHaveValue(pageUrl)
    }

    await leaveCaretInAddress()
    await pressThenType(electronApp, { pageUrl, shellUrl, key: 'F', text: 'first' })
    await expect(findField).toBeFocused()
    await expect(findField).toHaveValue('first')
    await expect(address).toHaveValue(pageUrl)
    await appWindow.keyboard.press('Escape')
    await expect(findField).toBeHidden()

    // Ctrl+H (Cmd+Y on macOS) gives the keyboard to History's search.
    const historySearch = appWindow.getByRole('searchbox', { name: 'Search browsing history' })
    await leaveCaretInAddress()
    await pressThenType(electronApp, { pageUrl, shellUrl, key: process.platform === 'darwin' ? 'Y' : 'H', text: 'first' })
    await expect(historySearch).toBeFocused()
    await expect(historySearch).toHaveValue('first')
    await expect(address).toHaveValue(pageUrl)
    await appWindow.keyboard.press('Escape')
    await expect(historySearch).toBeHidden()

    // Enter typed on goes to the address typed.
    await leaveCaretInAddress()
    await pressThenType(electronApp, { pageUrl, shellUrl, key: 'L', text: `${origin}/next\r` })
    await expect.poll(async () => (await shown())?.url).toBe(`http://${origin}/next`)
    await expect.poll(async () => (await shown())?.title).toBe('Keys next')
  } finally {
    await closeFixtureServer(server)
  }
})
