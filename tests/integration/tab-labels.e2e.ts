import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const fixtureUrl = 'data:text/html,<title>Shared application</title><main>Synthetic task fixture</main>'
const api = (page: Page) => ({
  state: () => page.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()),
  label: (id: string, label: string) => page.evaluate(({ id, label }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabLabel(id, label), { id, label })
})
async function newTab(page: Page): Promise<string> {
  const state = await page.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), fixtureUrl)
  const id = state.activeTabId!
  await expect.poll(async () => (await api(page).state()).tabs.find(tab => tab.id === id)?.title).toBe('Shared application')
  return id
}
async function disk(profile: string) { return JSON.parse(await readFile(join(profile, 'tabs.json'), 'utf8')) }

// Patch only writes containing a synthetic marker in this isolated profile.
// Always restored in finally; no production fault-injection API is exposed.
async function installSaveFault(app: ElectronApplication, mode: 'hold' | 'reject' | 'directory', marker: string, profile: string): Promise<void> {
  await app.evaluate((_electron, { mode, marker, profile }) => {
    const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
    const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
    const originalRename = fs.rename
    const originalOpen = fs.open
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const fault = { entered: false, release, restore: () => { fs.rename = originalRename; fs.open = originalOpen; syncBuiltinESMExports(); release() } }
    ;(globalThis as unknown as { labelFault: typeof fault }).labelFault = fault
    let directoryFailure = false
    fs.rename = async (source, destination) => {
      if (String(destination) === `${profile}/tabs.json` && (await fs.readFile(source, 'utf8')).includes(marker)) {
        fault.entered = true
        if (mode === 'reject') throw new Error('Synthetic tab label rename rejection')
        if (mode === 'hold') await gate
        if (mode === 'directory') directoryFailure = true
      }
      return originalRename(source, destination)
    }
    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      if (directoryFailure && String(args[0]) === profile && args[1] === 'r') {
        directoryFailure = false
        throw Object.assign(new Error('Synthetic directory flush failure'), { code: 'EIO' })
      }
      return originalOpen(...args)
    }) as typeof fs.open
    syncBuiltinESMExports()
  }, { mode, marker, profile })
}
async function faultEntered(app: ElectronApplication): Promise<void> {
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { labelFault: { entered: boolean } }).labelFault.entered)).toBe(true)
}
async function releaseFault(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => (globalThis as unknown as { labelFault: { release: () => void } }).labelFault.release())
}
async function restoreFault(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => (globalThis as unknown as { labelFault?: { restore: () => void } }).labelFault?.restore())
}

test('edits, searches and clears task labels without replacing document titles through navigation', async ({ appWindow }, testInfo) => {
  const first = await newTab(appWindow)
  await newTab(appWindow)
  await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
  const cards = panel.locator('.tab-overview-card')
  await expect(cards).toHaveCount(2)
  await cards.first().getByRole('button', { name: 'Edit label for Shared application', exact: true }).click()
  const input = panel.getByRole('textbox', { name: 'Tab label', exact: true })
  await expect(input).toBeFocused()
  await input.fill('  Customer checkout  ')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await api(appWindow).state()).tabs.find(tab => tab.id === first)?.label).toBe('Customer checkout')
  await panel.getByRole('searchbox').fill('customer checkout')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Shared application')
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ url: 'data:text/html,<title>Changed document</title><main>Another synthetic document</main>', tabId: id }), first)
  await expect.poll(async () => (await api(appWindow).state()).tabs.find(tab => tab.id === first)?.title).toBe('Changed document')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Changed document')
  await cards.first().getByRole('button', { name: 'Edit label for Customer checkout', exact: true }).click()
  await testInfo.attach('tab-label-editor', { body: await panel.screenshot(), contentType: 'image/png' })
  await input.fill('Canceled draft')
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await api(appWindow).state()).tabs.find(tab => tab.id === first)?.label).toBe('Customer checkout')
  await cards.first().getByRole('button', { name: 'Edit label for Customer checkout', exact: true }).click()
  await panel.getByRole('button', { name: 'Clear label', exact: true }).click()
  await expect(cards).toHaveCount(0)
  expect((await api(appWindow).state()).tabs.find(tab => tab.id === first)?.label).toBeUndefined()
})

test('keeps labels through duplicate, close/reopen, archive/restore and restart', async ({ profileDirectory, mcpPort }) => {
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort)
    const id = await newTab(instance.window)
    await api(instance.window).label(id, 'Admin task')
    await instance.app.evaluate(({ Menu }) => {
      const original = Menu.prototype.popup
      Menu.prototype.popup = function (): void {
        Menu.prototype.popup = original
        const item = this.getMenuItemById('duplicate-tab')!
        ;(item.click as unknown as () => void)()
      }
    })
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.showTabContextMenu(id), id)
    await expect.poll(async () => (await api(instance!.window).state()).tabs.filter(tab => tab.url === fixtureUrl).length).toBe(2)
    const duplicate = await api(instance.window).state()
    const duplicateId = duplicate.activeTabId!
    expect(duplicate.tabs.find(tab => tab.id === duplicateId)?.label).toBe('Admin task')
    await api(instance.window).label(duplicateId, 'Customer task')
    expect((await api(instance.window).state()).tabs.find(tab => tab.id === id)?.label).toBe('Admin task')
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), duplicateId)
    const closed = (await api(instance.window).state()).closedTabs.find(tab => tab.label === 'Customer task')!
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.reopenClosedTab(id), closed.id)
    const group = (await api(instance.window).state()).tabs.find(tab => tab.id === id)!.mcpGroupId!
    const archived = await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), group)
    expect(archived.savedTabGroups.find(candidate => candidate.id === group)?.tabs.map(tab => tab.label)).toEqual(['Admin task', 'Customer task'])
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    const restored = await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), group)
    expect(restored.tabs.filter(tab => tab.mcpGroupId === group).map(tab => tab.label)).toEqual(['Admin task', 'Customer task'])
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    expect((await api(instance.window).state()).tabs.filter(tab => tab.mcpGroupId === group).map(tab => tab.label)).toEqual(['Admin task', 'Customer task'])
  } finally { if (instance) await closeHronaut(instance.app) }
})

test('keeps failed label writes out of UI and unrelated persistence while allowing retry', async ({ appWindow, electronApp, profileDirectory }) => {
  const id = await newTab(appWindow)
  await api(appWindow).label(id, 'Previous role')
  await installSaveFault(electronApp, 'reject', 'Rejected role', profileDirectory)
  try {
    await expect(api(appWindow).label(id, 'Rejected role')).rejects.toThrow('Synthetic tab label rename rejection')
    expect((await api(appWindow).state()).tabs.find(tab => tab.id === id)?.label).toBe('Previous role')
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabPinned(id, true), id)
    await expect.poll(async () => (await disk(profileDirectory)).tabs.find((tab: { id: string }) => tab.id === id)?.pinned).toBe(true)
    expect((await disk(profileDirectory)).tabs.find((tab: { id: string }) => tab.id === id)?.label).toBe('Previous role')
    await api(appWindow).label(id, 'Retry role')
    expect((await disk(profileDirectory)).tabs.find((tab: { id: string }) => tab.id === id)?.label).toBe('Retry role')
  } finally { await restoreFault(electronApp) }
})

test('serializes newer label intent with concurrent workspace and tab changes', async ({ appWindow, electronApp, profileDirectory }) => {
  const id = await newTab(appWindow)
  const group = (await api(appWindow).state()).tabs.find(tab => tab.id === id)!.mcpGroupId!
  await installSaveFault(electronApp, 'hold', 'Queued first', profileDirectory)
  const first = api(appWindow).label(id, 'Queued first')
  let latest: ReturnType<ReturnType<typeof api>['label']> | undefined
  try {
    await faultEntered(electronApp)
    expect((await api(appWindow).state()).tabs.find(tab => tab.id === id)?.label).toBeUndefined()
    await appWindow.evaluate(({ id, group }) => Promise.all([
      (window as unknown as { hronaut: HronautApi }).hronaut.setTabPinned(id, true),
      (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(group, { name: 'Concurrent workspace' })
    ]), { id, group })
    latest = api(appWindow).label(id, 'Latest role')
    await releaseFault(electronApp)
    expect((await first).status).toBe('saved')
    expect((await latest).status).toBe('saved')
    await expect.poll(async () => {
      const saved = await disk(profileDirectory)
      return { label: saved.tabs.find((tab: { id: string }) => tab.id === id)?.label, pinned: saved.tabs.find((tab: { id: string }) => tab.id === id)?.pinned, name: saved.mcpTabGroups.find((candidate: { id: string }) => candidate.id === group)?.name }
    }).toEqual({ label: 'Latest role', pinned: true, name: 'Concurrent workspace' })
  } finally { await restoreFault(electronApp); await Promise.allSettled([first, ...(latest ? [latest] : [])]) }
})

test('waits for a pending label before closing and copying it into reopened tabs', async ({ appWindow, electronApp, profileDirectory }) => {
  const id = await newTab(appWindow)
  await installSaveFault(electronApp, 'hold', 'Closing role', profileDirectory)
  const save = api(appWindow).label(id, 'Closing role')
  let close: Promise<unknown> | undefined
  try {
    await faultEntered(electronApp)
    close = appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), id)
    // This subsequent IPC must see the lifecycle hold, not enqueue a newer edit.
    await expect(api(appWindow).label(id, 'Too late')).rejects.toThrow('Wait for the tab operation')
    await releaseFault(electronApp)
    await save
    await close
    const closed = (await api(appWindow).state()).closedTabs.find(tab => tab.label === 'Closing role')!
    expect(closed).toBeTruthy()
    const restored = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.reopenClosedTab(id), closed.id)
    expect(restored.tabs.find(tab => tab.active)?.label).toBe('Closing role')
  } finally { await restoreFault(electronApp); await Promise.allSettled([save, ...(close ? [close] : [])]) }
})

test('retains a replaced label and reports unconfirmed durability after directory flush failure', async ({ appWindow, electronApp, profileDirectory }) => {
  test.skip(process.platform === 'win32', 'Directory fsync is not available on Windows')
  const id = await newTab(appWindow)
  await api(appWindow).label(id, 'Prior role')
  await installSaveFault(electronApp, 'directory', 'Unconfirmed role', profileDirectory)
  try {
    const result = await api(appWindow).label(id, 'Unconfirmed role')
    expect(result.status).toBe('durability-unconfirmed')
    expect(result.state.tabs.find(tab => tab.id === id)?.label).toBe('Unconfirmed role')
    expect((await disk(profileDirectory)).tabs.find((tab: { id: string }) => tab.id === id)?.label).toBe('Unconfirmed role')
  } finally { await restoreFault(electronApp) }
  expect((await api(appWindow).label(id, 'Unconfirmed role')).status).toBe('saved')
})


test('keeps committed and pending labels when workspace storage deletion rolls back', async ({ appWindow, electronApp, profileDirectory }) => {
  const first = await newTab(appWindow)
  const second = await newTab(appWindow)
  await api(appWindow).label(first, 'Existing rollback role')
  const group = (await api(appWindow).state()).tabs.find(tab => tab.id === first)!.mcpGroupId!
  await electronApp.evaluate(({ webContents }, url) => {
    const browserSession = webContents.getAllWebContents().find(contents => contents.getURL() === url)!.session
    const original = browserSession.clearData.bind(browserSession)
    browserSession.clearData = async () => {
      browserSession.clearData = original
      throw new Error('Synthetic workspace deletion failure')
    }
  }, fixtureUrl)
  await installSaveFault(electronApp, 'hold', 'Pending rollback role', profileDirectory)
  const save = api(appWindow).label(second, 'Pending rollback role')
  let close: Promise<string> | undefined
  try {
    await faultEntered(electronApp)
    close = appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeWorkspace(id).then(() => 'closed', error => String(error)), group)
    await expect(api(appWindow).label(second, 'Too late')).rejects.toThrow('Wait for the tab operation')
    await releaseFault(electronApp)
    await save
    expect(await close).toContain('Synthetic workspace deletion failure')
    const state = await api(appWindow).state()
    expect(state.tabs.find(tab => tab.id === first)?.label).toBe('Existing rollback role')
    expect(state.tabs.find(tab => tab.id === second)?.label).toBe('Pending rollback role')
    await expect.poll(async () => (await disk(profileDirectory)).tabs.find((tab: { id: string }) => tab.id === second)?.label).toBe('Pending rollback role')
  } finally { await restoreFault(electronApp); await Promise.allSettled([save, ...(close ? [close] : [])]) }
})

test('drains an admitted label save during shutdown before restart', async ({ profileDirectory, mcpPort }) => {
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort)
    const id = await newTab(instance.window)
    await installSaveFault(instance.app, 'hold', 'Shutdown role', profileDirectory)
    const save = api(instance.window).label(id, 'Shutdown role')
    // Attach rejection handling before quit can destroy the renderer.
    const settled = save.catch(() => undefined)
    await faultEntered(instance.app)
    await instance.app.evaluate(({ app }) => { app.quit() })
    // Electron has closed the shell; no additional human edit can be sent.
    await expect(api(instance.window).label(id, 'After shutdown')).rejects.toThrow('closed')
    await restoreFault(instance.app)
    await settled
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    expect((await api(instance.window).state()).tabs.find(tab => tab.id === id)?.label).toBe('Shutdown role')
  } finally {
    if (instance) {
      await restoreFault(instance.app).catch(() => undefined)
      await closeHronaut(instance.app)
    }
  }
})
