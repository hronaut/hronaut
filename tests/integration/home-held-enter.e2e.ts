import type { ElectronApplication } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

const HOME_READY_TIMEOUT_MS = 20_000

async function homeScript<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(source)
  }, script) as Promise<T>
}

/** Enter as the keyboard sends it to Home while Home has the focus, which is where a held key's repeats go. */
async function enterInHome(app: ElectronApplication, type: 'keyDown' | 'keyUp', repeat = false): Promise<void> {
  await app.evaluate(({ webContents }, { type, repeat }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    const modifiers = repeat ? ['isautorepeat' as const] : []
    home.sendInputEvent({ type, keyCode: 'Enter', modifiers })
    if (type === 'keyDown') home.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
  }, { type, repeat })
}

test('a held Enter on Archive in Home leaves the workspace archived', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Held Enter shop', storage: 'scratch' }))
  const homeTab = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.url.startsWith('hronaut://home'))?.id))
  expect(homeTab).toBeTruthy()
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), homeTab!)
  const cardScript = `[...document.querySelectorAll('.home-workspace-card')].find(card => card.textContent.includes('Held Enter shop'))`
  await expect.poll(() => homeScript(electronApp, `Boolean(${cardScript})`), { timeout: HOME_READY_TIMEOUT_MS }).toBe(true)

  // Archive in the card's menu, pressed with Enter from the keyboard.
  await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!.focus())
  await expect.poll(() => homeScript(electronApp, `(() => {
    const menu = ${cardScript}.querySelector('.card-menu')
    menu.open = true
    menu.querySelector('[data-workspace-action="archive"]').focus()
    return document.hasFocus() && document.activeElement?.dataset.workspaceAction
  })()`)).toBe('archive')
  await enterInHome(electronApp, 'keyDown')
  // Archiving hands the focus to Undo.
  await expect.poll(() => homeScript(electronApp, 'document.activeElement?.id')).toBe('workspace-undo')
  // The held key's repeats used to press Undo, which restored the workspace.
  for (let repeat = 0; repeat < 5; repeat += 1) {
    // Repeats at about a keyboard's pace.
    await appWindow.waitForTimeout(50)
    await enterInHome(electronApp, 'keyDown', true)
  }
  await enterInHome(electronApp, 'keyUp')
  await appWindow.waitForTimeout(300)
  const archivedNames = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.savedTabGroups.map(group => group.name)))
  expect(await archivedNames()).toContain('Held Enter shop')
  expect(await homeScript(electronApp, `document.getElementById('workspace-undo').hidden`)).toBe(false)

  // A new press on Undo still restores it.
  await enterInHome(electronApp, 'keyDown')
  await enterInHome(electronApp, 'keyUp')
  await expect.poll(archivedNames).not.toContain('Held Enter shop')
})
