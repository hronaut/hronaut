import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'
const exec = promisify(execFile)

/** Presses keys through the X server, which turns them into characters by its keyboard layout, as a keyboard does. */
async function press(keys: string): Promise<void> {
  await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), '0', '0', `--shortcut=${keys}`])
}

/** The X server's layout and variant, put back after the test so no later test types Cyrillic. */
async function currentLayout(): Promise<string[]> {
  const { stdout } = await exec('setxkbmap', ['-query'])
  const value = (name: string): string | undefined => new RegExp(`^${name}:\\s*(\\S+)`, 'm').exec(stdout)?.[1]
  const layout = value('layout') ?? 'us'
  const variant = value('variant')
  return ['-layout', layout, ...variant ? ['-variant', variant] : []]
}

test.skip(process.platform !== 'linux', 'Switches the layout of the X server the app draws on.')

// Captured and put back around the test, also after a timeout, so the retry and later tests on this display type Latin.
let originalLayout: string[] | undefined
test.beforeEach(async () => {
  originalLayout = await currentLayout()
})
test.afterEach(async () => {
  if (originalLayout) await exec('setxkbmap', originalLayout)
  originalLayout = undefined
})

test('takes browser keys from the key\'s place on a US keyboard with a Russian layout on', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(() => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<BrowserState> } }).hronaut.newTab({
    url: 'data:text/html,<title>Layout keys</title><input aria-label="Field" autofocus>',
    active: true
  }))
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await expect(address).toHaveValue(/^data:text\/html,/)
  const field = async (): Promise<string | undefined> => electronApp.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Layout keys')
    return page ? await page.executeJavaScript('document.activeElement?.ariaLabel === "Field" ? document.activeElement.value : undefined') as string | undefined : undefined
  })
  await electronApp.evaluate(({ BrowserWindow, webContents }) => {
    BrowserWindow.getAllWindows()[0]!.focus()
    webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Layout keys')!.focus()
  })
  await expect.poll(field).toBe('')
  await exec('setxkbmap', ['-layout', 'ru'])

  // The page types the layout's own letter, so the keys below reach Hronaut as Cyrillic.
  await expect.poll(async () => {
    await press('Cyrillic_de')
    return (await field())?.slice(-1)
  }).toBe('д')

  // From the page: Ctrl with the L key types Ctrl+д there.
  await press('Control_L+Cyrillic_de')
  await expect(address).toBeFocused()

  // From Hronaut's own window: Ctrl with the T key opens a tab, and Ctrl with the W key closes it.
  const tabCount = async (): Promise<number> => (await appWindow.evaluate(() => (window as unknown as { hronaut: { getState(): Promise<BrowserState> } }).hronaut.getState())).tabs.length
  const before = await tabCount()
  await press('Control_L+Cyrillic_ie')
  await expect.poll(tabCount).toBe(before + 1)
  await press('Control_L+Cyrillic_tse')
  await expect.poll(tabCount).toBe(before)
})
