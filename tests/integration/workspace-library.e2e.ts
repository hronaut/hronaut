import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

async function homePage(app: ElectronApplication) {
  await expect.poll(() => app.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  const page = app.context().pages().find(page => page.url().startsWith('hronaut://home'))!
  await expect(page.getByRole('tab', { name: 'Workspaces', exact: true })).toHaveAttribute('aria-selected', 'true')
  return page
}

test('Home manages workspaces across themes and narrow windows', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate(async () => {
    const browser = (window as unknown as { hronaut: HronautApi }).hronaut
    await browser.createWorkspace({ name: 'Product research', color: 'purple', storage: 'scratch' })
    await browser.createWorkspace({ name: 'Personal accounts', color: 'blue', storage: 'scratch', agentAccess: false })
    await browser.createWorkspace({ name: 'Release checks', color: 'green', storage: 'scratch', navigationPolicy: { mode: 'restricted', rules: ['https://example.com'] } })
    const state = await browser.createWorkspace({ name: 'Previous launch', color: 'orange', storage: 'scratch' })
    await browser.saveAndCloseTabGroup(state.mcpTabGroups.find(group => group.name === 'Previous launch')!.id)
    await browser.openHome()
  })
  expect(await appWindow.locator('.workspace-library-launcher').count()).toBe(0)
  const home = await homePage(electronApp)
  const library = home.locator('#home-workspaces')
  await expect(library.getByRole('article')).toHaveCount(3)
  await expect(library.getByText('Direct agent access off', { exact: true })).toBeVisible()
  const search = library.getByRole('searchbox', { name: 'Search workspaces or tabs' })
  await search.fill('personal')
  await expect(library.getByRole('article')).toHaveCount(1)
  await search.press('Enter')
  expect(await appWindow.getByRole('dialog').count()).toBe(0)
  await library.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(library.getByRole('status')).toContainText('Tabs and sign-ins are saved')
  await library.getByRole('button', { name: 'Undo archive' }).click()
  await expect(library.getByRole('article')).toHaveCount(1)
  await search.fill('')
  for (const theme of ['light', 'dark']) {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await home.emulateMedia({ colorScheme: null })
    for (const width of [1200, 640]) {
      await electronApp.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]!
        window.setMinimumSize(600, 600)
        window.setSize(width, 800)
      }, width)
      await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(width)
      expect(await home.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      const alignment = await home.evaluate(() => {
        const search = document.querySelector('#workspace-search')!.getBoundingClientRect()
        const buttons = [...document.querySelectorAll('.workspace-toolbar > button')].map(button => {
          const rect = button.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom, height: rect.height }
        })
        return { search: { top: search.top, bottom: search.bottom, height: search.height }, buttons }
      })
      for (const button of alignment.buttons) expect(button.height).toBe(alignment.search.height)
      if (width >= 1000) {
        for (const button of alignment.buttons) {
          expect(Math.abs(button.top - alignment.search.top)).toBeLessThanOrEqual(1)
          expect(Math.abs(button.bottom - alignment.search.bottom)).toBeLessThanOrEqual(1)
        }
      } else expect(alignment.buttons[0]!.top).toBe(alignment.buttons[1]!.top)

      await library.getByRole('article').last().scrollIntoViewIfNeeded()
      await expect(library.getByRole('article').last().getByRole('button', { name: 'Open workspace', exact: true })).toBeInViewport()
      await home.screenshot({ path: testInfo.outputPath(`home-workspaces-${theme}-${width}.png`), fullPage: true })
    }
  }
  await library.getByRole('tab', { name: 'Archived (1)', exact: true }).click()
  await library.getByRole('article', { name: 'Previous launch' }).getByRole('button', { name: 'Restore workspace', exact: true }).click()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(s => s.savedTabGroups.length)')).toBe(0)
  await appWindow.evaluate('window.hronaut.openHome()')
  await library.getByRole('tab', { name: 'Open (4)', exact: true }).click()
  await library.getByRole('article', { name: 'Personal accounts' }).getByRole('button', { name: 'Manage', exact: true }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
  await expect(editor.getByLabel('Workspace name', { exact: true })).toHaveValue('Personal accounts')
  await editor.getByLabel('Workspace name', { exact: true }).fill('Personal browsing')
  await editor.getByRole('button', { name: 'Save changes' }).click()
  await expect(editor).toBeHidden()
  await expect(library.getByRole('article', { name: 'Personal browsing' })).toBeVisible()
  await library.getByRole('button', { name: 'Portable workspace templates', exact: true }).click()
  await expect(appWindow.getByRole('dialog', { name: 'Portable workspace templates', exact: true })).toBeVisible()
  await appWindow.getByRole('button', { name: 'All workspaces' }).click()
  await expect(appWindow.getByRole('dialog')).toHaveCount(0)
})

test('creates a hidden protected workspace from Home at enlarged scale and keeps it accessible', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 700))
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.25)')
  const home = await homePage(electronApp)
  await expect(home.getByText('Your first workspace starts here', { exact: true })).toBeVisible()
  await home.getByRole('button', { name: 'Create workspace', exact: true }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace', exact: true })
  await editor.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('Private research')
  await editor.getByRole('checkbox', { name: 'Hide from left sidebar', exact: false }).check()
  await editor.getByRole('checkbox', { name: 'Protect from deletion', exact: false }).check()
  await editor.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(appWindow.locator('.tab-group-label', { hasText: 'Private research' })).toHaveCount(0)
  await appWindow.evaluate('window.hronaut.openHome()')
  const card = home.getByRole('article', { name: 'Private research', exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByText('Deletion protected', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Clear…', exact: true })).toBeDisabled()
  await card.getByRole('button', { name: 'Open workspace', exact: true }).click()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(s => s.tabs.find(t => t.active)?.mcpGroupId)')).toBeTruthy()
  await expect(appWindow.locator('.tab-group-label', { hasText: 'Private research' })).toHaveCount(0)
  await appWindow.evaluate('window.hronaut.openHome()')
  await card.locator('summary').click()
  await card.getByLabel('Hide from left sidebar', { exact: true }).uncheck()
  await appWindow.locator('.browser-tabs-bar').hover()
  await expect(appWindow.locator('.tab-group-label', { hasText: 'Private research' })).toBeVisible()
  await card.getByRole('button', { name: 'Archive', exact: true }).click()
  await home.getByRole('tab', { name: 'Archived (1)' }).click()
  await expect(card.getByRole('button', { name: 'Delete…', exact: true })).toBeDisabled()
  const id = await appWindow.evaluate('window.hronaut.getState().then(s => s.savedTabGroups[0].id)') as string
  const rejected = await appWindow.evaluate(async id => {
    try { await (window as unknown as { hronaut: HronautApi }).hronaut.deleteSavedTabGroup(id); return '' }
    catch (error) { return String(error) }
  }, id)
  expect(rejected).toContain('protected from deletion')
  await card.locator('summary').click()
  await card.getByLabel('Protect from deletion', { exact: true }).uncheck()
  await expect(card.getByRole('button', { name: 'Delete…', exact: true })).toBeEnabled()
})

test('clears an open workspace from Home while website input is locked', async ({ appWindow, electronApp }) => {
  const state = await appWindow.evaluate(async () => {
    const browser = (window as unknown as { hronaut: HronautApi }).hronaut
    const created = await browser.createWorkspace({ name: 'Stuck workspace', storage: 'scratch' })
    await browser.setAllHumanInteractionLocked(true)
    await browser.openHome()
    return created
  })
  const workspaceId = state.mcpTabGroups.find(group => group.name === 'Stuck workspace')!.id
  const home = await homePage(electronApp)
  const card = home.getByRole('article', { name: 'Stuck workspace', exact: true })

  await expect(card.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled()
  await expect(card.getByRole('button', { name: 'Clear…', exact: true })).toBeEnabled()
  home.once('dialog', dialog => dialog.accept())
  await card.getByRole('button', { name: 'Clear…', exact: true }).click()

  await expect(card).toBeHidden()
  await expect.poll(() => appWindow.evaluate(id => (
    (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.mcpTabGroups.some(group => group.id === id))
  ), workspaceId)).toBe(false)
})

test('persists deletion protection and browser mute without requiring a website tab', async ({ profileDirectory }) => {
  let instance = await launchHronaut(profileDirectory)
  try {
    const audio = instance.window.locator('.all-tabs-audio-button')
    await expect(audio).toBeEnabled()
    await audio.click()
    await expect(audio).toHaveAttribute('aria-pressed', 'true')
    let state = await instance.window.evaluate("window.hronaut.createWorkspace({ name: 'Protected project', storage: 'scratch', hiddenFromSidebar: true, deletionProtected: true })") as BrowserState
    const id = state.mcpTabGroups[0]!.id
    expect(state.tabs.filter(tab => tab.mcpGroupId === id).every(tab => tab.muted)).toBe(true)
    const rejected = await instance.window.evaluate(async id => {
      try { await (window as unknown as { hronaut: HronautApi }).hronaut.closeWorkspace(id); return '' }
      catch (error) { return String(error) }
    }, id)
    expect(rejected).toContain('protected from deletion')
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), id)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory)
    state = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
    expect(state.allTabsMuted).toBe(true)
    expect(state.savedTabGroups[0]).toMatchObject({ id, hiddenFromSidebar: true, deletionProtected: true })
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), id)
    state = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
    expect(state.mcpTabGroups[0]).toMatchObject({ id, hiddenFromSidebar: true, deletionProtected: true })
    const tab = state.tabs.find(tab => tab.mcpGroupId === id)!
    expect(tab.muted).toBe(true)
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabMuted(id, false), tab.id)
    expect(await instance.window.evaluate('window.hronaut.getState().then(s => s.tabs.find(t => t.active).muted)')).toBe(true)
    await instance.window.locator('.all-tabs-audio-button').click()
    await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabMuted(id, true), tab.id)
    await instance.window.locator('.all-tabs-audio-button').click()
    await instance.window.locator('.all-tabs-audio-button').click()
    expect(await instance.window.evaluate('window.hronaut.getState().then(s => s.tabs.find(t => t.active).muted)')).toBe(true)
    const next = await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ mcpGroupId: id }), id) as BrowserState
    expect(next.tabs.at(-1)?.muted).toBe(false)
  } finally { await closeHronaut(instance.app) }
})


test('agents cannot delete protected active or archived workspaces or remove their protection', async ({ appWindow, mcpPort, mcpToken }) => {
  const client = new Client({ name: 'workspace-protection-test', version: '1' })
  const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join(' ')
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok }
      catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const created = await call('browser_workspaces', { action: 'create', name: 'Protected agent project', storage: 'scratch' })
    expect(created.isError, text(created)).not.toBe(true)
    const id = (JSON.parse(text(created)) as { id: string }).id
    await call('browser_new_tab', { workspaceId: id, url: 'about:blank' })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { deletionProtected: true }), id)
    await call('browser_workspaces', { action: 'update', workspaceId: id, name: 'Still protected', deletionProtected: false })
    const closed = await call('browser_workspaces', { action: 'close', workspaceId: id })
    expect(closed.isError).toBe(true)
    expect(text(closed)).toContain('protected from deletion')
    const archived = await call('browser_saved_workspaces', { action: 'save', workspaceId: id })
    expect(archived.isError, text(archived)).not.toBe(true)
    const deleted = await call('browser_saved_workspaces', { action: 'delete', savedWorkspaceId: id })
    expect(deleted.isError).toBe(true)
    expect(text(deleted)).toContain('protected from deletion')
    const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
    expect(state.savedTabGroups.find(group => group.id === id)?.deletionProtected).toBe(true)
  } finally { await client.close() }
})
