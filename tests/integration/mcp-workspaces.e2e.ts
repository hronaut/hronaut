import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function connectClient(name: string, port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { authorization: `Bearer ${token}` }
      })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

async function createWorkspace(client: Client, name: string, color?: string): Promise<string> {
  const result = await client.callTool({
    name: 'browser_workspaces',
    arguments: { action: 'create', name, ...(color ? { color } : {}) }
  }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  return (JSON.parse(text(result)) as { id: string }).id
}

test('uses UUIDv7 for tabs and puts the last-tab replacement in Default', async ({ appWindow }) => {
  const initial = await appWindow.evaluate(`window.hronaut.getState()`) as BrowserState
  expect(initial.tabs).toHaveLength(1)
  expect(initial.tabs[0]!.id).toMatch(UUID_V7_PATTERN)
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(initial.tabs[0]!.id)})`)
  const replacement = await appWindow.evaluate(`window.hronaut.getState()`) as BrowserState
  const defaultWorkspace = replacement.mcpTabGroups.find((workspace) => workspace.isDefault)
  expect(defaultWorkspace?.id).toMatch(UUID_V7_PATTERN)
  expect(replacement.tabs).toEqual([
    expect.objectContaining({
      id: expect.stringMatching(UUID_V7_PATTERN),
      url: 'about:blank',
      mcpGroupId: defaultWorkspace?.id
    })
  ])
})

test('keeps empty workspaces visible and opens a tab from each workspace action', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const client = await connectClient('empty-workspace-ui', mcpPort, mcpToken)
  try {
    const workspaceId = await createWorkspace(client, 'Empty investigation', 'cyan')
    const workspaceControl = appWindow.locator('.tab-group-label', { hasText: 'Empty investigation' })
    await expect(workspaceControl).toBeVisible()
    await expect(workspaceControl).toHaveAccessibleName('Collapse workspace Empty investigation, 0 tabs')
    await expect(appWindow.getByRole('tab')).toHaveCount(0)

    const workspaceNewTab = appWindow.getByRole('button', { name: 'New tab in Empty investigation workspace' })
    const createWorkspaceButton = appWindow.getByRole('button', { name: 'Create workspace' })
    const [workspaceBounds, newTabBounds, createBounds] = await Promise.all([
      workspaceControl.boundingBox(),
      workspaceNewTab.boundingBox(),
      createWorkspaceButton.boundingBox()
    ])
    expect(Math.round(workspaceBounds?.height ?? 0)).toBe(28)
    expect(Math.round(newTabBounds?.height ?? 0)).toBe(28)
    expect(Math.round(createBounds?.height ?? 0)).toBe(28)
    expect(Math.round(newTabBounds?.y ?? 0)).toBe(Math.round(workspaceBounds?.y ?? -1))
    expect(Math.round(createBounds?.y ?? 0)).toBe(Math.round(workspaceBounds?.y ?? -1))
    expect(Math.abs((workspaceBounds?.x ?? 0) + (workspaceBounds?.width ?? 0) - (newTabBounds?.x ?? 0))).toBeLessThanOrEqual(1)
    await expect(createWorkspaceButton).toHaveText('Workspace')

    await workspaceNewTab.click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      workspaceTabIds: state.tabs
        .filter((tab) => tab.mcpGroupId === ${JSON.stringify(workspaceId)})
        .map((tab) => tab.id)
    }))`)).toEqual({
      activeTabId: expect.stringMatching(UUID_V7_PATTERN),
      workspaceTabIds: [expect.stringMatching(UUID_V7_PATTERN)]
    })
    await expect(workspaceControl).toHaveAccessibleName('Collapse workspace Empty investigation, 1 tab')
    await expect(appWindow.getByRole('button', { name: 'New tab in Default workspace' })).toBeVisible()
  } finally {
    await client.close()
  }
})

test('keeps many open tabs reachable without covering the fixed topbar actions', async ({ appWindow }) => {
  const lastTabId = await appWindow.evaluate(`(async () => {
    const initial = await window.hronaut.getState();
    const workspaceId = initial.mcpTabGroups.find((workspace) => workspace.isDefault)?.id;
    if (!workspaceId) throw new Error('Default workspace was not found');
    let lastTabId = '';
    for (let index = 1; index <= 12; index += 1) {
      const url = 'data:text/html,<title>Overflow tab ' + index + '</title><main>Overflow ' + index + '</main>';
      const state = await window.hronaut.newTab({ url, active: false, mcpGroupId: workspaceId });
      lastTabId = state.tabs.find((tab) => tab.url === url)?.id ?? '';
    }
    return lastTabId;
  })()`) as string
  expect(lastTabId).toMatch(UUID_V7_PATTERN)

  const strip = appWindow.getByRole('tablist', { name: 'Browser tabs and workspaces' })
  await expect.poll(() => strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  const previousTabs = appWindow.locator('.tabs-scroll-button.previous')
  const moreTabs = appWindow.getByRole('button', { name: 'Show more tabs' })
  await expect(previousTabs).toBeHidden()
  await expect(moreTabs).toBeEnabled()

  const [moreBounds, actionsBounds] = await Promise.all([
    moreTabs.boundingBox(),
    appWindow.locator('.topbar-actions').boundingBox()
  ])
  expect((moreBounds?.x ?? 0) + (moreBounds?.width ?? 0)).toBeLessThanOrEqual(actionsBounds?.x ?? 0)

  await strip.dispatchEvent('wheel', { deltaY: 220 })
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  await strip.evaluate((element) => { element.scrollLeft = 0 })
  await moreTabs.click()
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(lastTabId)})`)
  await expect.poll(() => appWindow.locator('[data-active-tab="true"]').evaluate((element) => {
    const tab = element.getBoundingClientRect()
    const strip = element.closest('.tabs-strip')?.getBoundingClientRect()
    return Boolean(strip && tab.left >= strip.left + 30 && tab.right <= strip.right - 30)
  })).toBe(true)
  await expect(previousTabs).toBeVisible()
  await expect(previousTabs).toBeEnabled()

  const firstTab = appWindow.getByRole('tab', { name: /^Overflow tab 1 —/ })
  const lastTab = appWindow.getByRole('tab', { name: /^Overflow tab 12 —/ })
  const previousTab = appWindow.getByRole('tab', { name: /^Overflow tab 11 —/ })
  await lastTab.focus()
  await lastTab.press('Home')
  await expect(firstTab).toBeFocused()
  expect(await appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`)).toBe(lastTabId)

  await firstTab.press('End')
  await expect(lastTab).toBeFocused()
  await lastTab.press('ArrowLeft')
  await expect(previousTab).toBeFocused()
  await expect(previousTab).toHaveAttribute('tabindex', '0')
  await expect(appWindow.locator('.tab[tabindex="0"]')).toHaveCount(1)
  expect(await appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`)).toBe(lastTabId)

  await previousTab.press('Enter')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)`)).toBe('Overflow tab 11')
})

test('does not offer or attempt tab reordering across workspace boundaries', async ({ appWindow }) => {
  await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Default drag source</title><main>Default</main>',
    active: true
  })`)
  const isolatedState = await appWindow.evaluate(`window.hronaut.createWorkspace({
    name: 'Drag isolation',
    color: 'cyan',
    storage: 'scratch'
  })`) as BrowserState
  const isolatedTabId = isolatedState.activeTabId
  expect(isolatedTabId).toMatch(UUID_V7_PATTERN)
  await appWindow.evaluate(`window.hronaut.navigate({
    tabId: ${JSON.stringify(isolatedTabId)},
    url: 'data:text/html,<title>Isolated drag target</title><main>Isolated</main>'
  })`)
  await expect(appWindow.getByRole('tab', { name: /^Default drag source/ })).toBeVisible()
  await expect(appWindow.getByRole('tab', { name: /^Isolated drag target/ })).toBeVisible()

  const before = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs
    .filter((tab) => !tab.url.startsWith('hronaut://'))
    .map(({ id, mcpGroupId }) => ({ id, mcpGroupId })))`)
  await appWindow.getByRole('tab', { name: /^Default drag source/ }).dragTo(
    appWindow.getByRole('tab', { name: /^Isolated drag target/ }),
    { targetPosition: { x: 3, y: 18 } }
  )

  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs
    .filter((tab) => !tab.url.startsWith('hronaut://'))
    .map(({ id, mcpGroupId }) => ({ id, mcpGroupId })))`)).toEqual(before)
  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toHaveCount(0)
})

test('requires visible workspaces and keeps each tool inside its selected workspace', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const first = await connectClient('group-test-first', mcpPort, mcpToken)
  const second = await connectClient('group-test-second', mcpPort, mcpToken)
  try {
    const availableTools = await first.listTools()
    const groupsTool = availableTools.tools.find((tool) => tool.name === 'browser_workspaces')
    expect(groupsTool?.description).toContain('Required first step: call browser_workspaces with action=create')
    expect(groupsTool?.description).toContain('Creation choice 1 — from scratch: storage=scratch (the default)')
    expect(groupsTool?.description).toContain('{"action":"create","name":"Task name","storage":"scratch"}')
    expect(groupsTool?.description).toContain('Creation choice 2 — fork Default: storage=fork-default')
    expect(groupsTool?.description).toContain('{"action":"create","name":"Task name","storage":"fork-default"}')
    expect(groupsTool?.description).toContain('Optional merge-back: after the task, call action=save-default with your created workspaceId')
    expect(groupsTool?.description).toContain('{"action":"save-default","workspaceId":"<id returned by create>"}')
    expect(groupsTool?.description).toContain('never ongoing synchronization')
    expect(groupsTool?.description).toContain("MCP deliberately does not expose Default's origin inventory")
    expect(groupsTool?.description).toContain('Use list-origins first when you want to select origins')
    expect(groupsTool?.description).toContain('Pass the UUIDv7 id returned by your own create call—or the fresh id returned when reopening your own archive—as workspaceId')
    expect(groupsTool?.description).toContain('must never pass the workspace marked isDefault to page tools')
    expect(groupsTool?.inputSchema).toMatchObject({
      properties: {
        action: {
          description: expect.stringContaining('For create, choose storage=scratch or storage=fork-default')
        },
        workspaceId: {
          description: expect.stringContaining('Never pass the human Default id')
        },
        storage: {
          enum: ['scratch', 'fork-default'],
          description: expect.stringContaining('scratch (the default when omitted) starts from a clean isolated profile')
        },
        origins: {
          type: 'array',
          description: expect.stringContaining("Default's origin list is private")
        }
      }
    })
    const initialWorkspaces = await first.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(initialWorkspaces))).toEqual([
      expect.objectContaining({ name: 'Default', isDefault: true, storageKind: 'default', tabCount: 0 })
    ])
    const defaultWorkspaceId = (JSON.parse(text(initialWorkspaces)) as Array<{ id: string }>)[0]!.id
    expect(defaultWorkspaceId).toMatch(UUID_V7_PATTERN)
    const defaultStatus = await first.callTool({
      name: 'browser_status',
      arguments: { workspaceId: defaultWorkspaceId }
    }) as CallToolResult
    expect(defaultStatus.isError).toBe(true)
    expect(text(defaultStatus)).toContain('Default workspace is not available through MCP')
    const defaultOrigins = await first.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'list-origins', workspaceId: defaultWorkspaceId }
    }) as CallToolResult
    expect(defaultOrigins.isError).toBe(true)
    expect(text(defaultOrigins)).toContain('Default workspace is not available through MCP')
    const defaultRename = await first.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'rename', workspaceId: defaultWorkspaceId, name: 'Agent profile' }
    }) as CallToolResult
    expect(defaultRename.isError).toBe(true)
    expect(text(defaultRename)).toContain('Default workspace is not available through MCP')

    const unscoped = await first.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    expect(unscoped.isError).toBe(true)
    expect(text(unscoped)).toContain('workspaceId')

    const firstGroupId = await createWorkspace(first, 'Checkout agent', 'blue')
    const secondGroupId = await createWorkspace(second, 'Documentation agent', 'cyan')
    expect(firstGroupId).toMatch(UUID_V7_PATTERN)
    expect(secondGroupId).toMatch(UUID_V7_PATTERN)
    const listed = await first.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(listed))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstGroupId, name: 'Checkout agent', color: 'blue', tabCount: 0 }),
      expect.objectContaining({ id: secondGroupId, name: 'Documentation agent', color: 'cyan', tabCount: 0 })
    ]))

    const renamed = await first.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'rename', workspaceId: firstGroupId, name: 'Checkout debugging' }
    }) as CallToolResult
    expect(renamed.isError, text(renamed)).not.toBe(true)
    expect(JSON.parse(text(renamed))).toMatchObject({ id: firstGroupId, name: 'Checkout debugging' })
    const afterRename = await first.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(afterRename))).toContainEqual(expect.objectContaining({
      id: firstGroupId,
      name: 'Checkout debugging',
      color: 'blue'
    }))
    const duplicateRename = await second.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'rename', workspaceId: secondGroupId, name: ' checkout debugging ' }
    }) as CallToolResult
    expect(duplicateRename.isError).toBe(true)
    expect(text(duplicateRename)).toContain('already exists')
    const recolored = await first.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'update', workspaceId: firstGroupId, color: 'orange' }
    }) as CallToolResult
    expect(recolored.isError, text(recolored)).not.toBe(true)
    expect(JSON.parse(text(recolored))).toMatchObject({ id: firstGroupId, name: 'Checkout debugging', color: 'orange' })
    const listedOrigins = await first.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'list-origins', workspaceId: firstGroupId }
    }) as CallToolResult
    expect(listedOrigins.isError, text(listedOrigins)).not.toBe(true)
    expect(JSON.parse(text(listedOrigins))).toEqual([])
    const imported = await first.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'import-default', workspaceId: firstGroupId, origins: [] }
    }) as CallToolResult
    expect(imported.isError, text(imported)).not.toBe(true)
    expect(JSON.parse(text(imported))).toMatchObject({
      workspaceId: firstGroupId,
      direction: 'from-default',
      cookieCount: 0,
      localStorageItemCount: 0
    })

    const firstOpened = await first.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId: firstGroupId, url: 'data:text/html,<title>Checkout workspace</title><h1>Checkout</h1>' }
    }) as CallToolResult
    const firstState = JSON.parse(text(firstOpened)) as { activeTabId: string; tabs: Array<{ id: string; workspaceId: string }> }
    const firstTabId = firstState.activeTabId
    expect(firstTabId).toMatch(UUID_V7_PATTERN)
    expect(firstState.tabs).toEqual([expect.objectContaining({ id: firstTabId, workspaceId: firstGroupId })])
    const malformedTabId = await first.callTool({
      name: 'browser_select_tab',
      arguments: { workspaceId: firstGroupId, tabId: 'not-a-uuid-v7' }
    }) as CallToolResult
    expect(malformedTabId.isError).toBe(true)
    expect(text(malformedTabId)).toContain('Tab ID must be a UUIDv7')

    const secondOpened = await second.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId: secondGroupId, url: 'data:text/html,<title>Docs workspace</title><h1>Docs</h1>' }
    }) as CallToolResult
    const secondTabId = (JSON.parse(text(secondOpened)) as { activeTabId: string }).activeTabId

    await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Human default tab</title><h1>Human</h1>', active: true })`)
    await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Another human tab</title><h1>Human two</h1>', active: false })`)
    const humanState = await appWindow.evaluate(`window.hronaut.getState()`) as BrowserState
    const defaultGroup = humanState.mcpTabGroups.find((group) => group.isDefault)
    expect(defaultGroup).toMatchObject({ name: 'Default', color: 'gray', isDefault: true, tabCount: 2 })
    expect(humanState.tabs.filter((tab) => tab.mcpGroupId === defaultGroup?.id)).toHaveLength(2)
    await expect(appWindow.locator('.tab-group-label', { hasText: 'Default' })).toContainText('Default')

    const firstTabs = await first.callTool({ name: 'browser_tabs', arguments: { workspaceId: firstGroupId } }) as CallToolResult
    expect(JSON.parse(text(firstTabs))).toEqual([expect.objectContaining({ id: firstTabId })])
    expect(text(firstTabs)).not.toContain(secondTabId)

    const crossGroupSnapshot = await second.callTool({
      name: 'browser_snapshot',
      arguments: { workspaceId: secondGroupId, tabId: firstTabId }
    }) as CallToolResult
    expect(crossGroupSnapshot.isError).toBe(true)
    expect(text(crossGroupSnapshot)).toContain('does not belong to workspace')

    await expect(appWindow.locator('.tab-group-label', { hasText: 'Checkout debugging' })).toBeVisible()
    await expect(appWindow.locator('.tab-group-label', { hasText: 'Documentation agent' })).toBeVisible()

    await first.callTool({
      name: 'browser_evaluate',
      arguments: {
        workspaceId: firstGroupId,
        tabId: firstTabId,
        script: "window.open('data:text/html,<title>Checkout popup</title><h1>Popup</h1>'); true"
      }
    })
    await expect.poll(async () => {
      const result = await first.callTool({ name: 'browser_tabs', arguments: { workspaceId: firstGroupId } }) as CallToolResult
      return (JSON.parse(text(result)) as unknown[]).length
    }).toBe(2)
  } finally {
    await first.close()
    await second.close()
  }
})

test('rejects duplicate human names instead of reusing another workspace identity', async ({ mcpPort, mcpToken }) => {
  const first = await connectClient('same-name-first', mcpPort, mcpToken)
  const second = await connectClient('same-name-second', mcpPort, mcpToken)
  try {
    const firstWorkspaceId = await useMcpWorkspace(first, 'Shared test label', false)
    await expect(useMcpWorkspace(second, '  shared TEST label  ', false)).rejects.toThrow('already exists')
    const listed = await first.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect((JSON.parse(text(listed)) as Array<{ id: string; name: string }>).filter((workspace) => workspace.name === 'Shared test label')).toEqual([
      expect.objectContaining({ id: firstWorkspaceId })
    ])
  } finally {
    await first.close()
    await second.close()
  }
})

test('caps new and restored workspaces so profiles cannot grow without bound', async ({ mcpPort, mcpToken }) => {
  const client = await connectClient('workspace-limit', mcpPort, mcpToken)
  try {
    const archivedWorkspaceId = await createWorkspace(client, 'Archived at the limit')
    await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId: archivedWorkspaceId, url: 'data:text/html,<title>Archived limit tab</title>' }
    })
    const archiveResult = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'save', workspaceId: archivedWorkspaceId }
    }) as CallToolResult
    expect(archiveResult.isError, text(archiveResult)).not.toBe(true)
    const archivedWorkspace = JSON.parse(text(archiveResult)) as { id: string }

    for (let index = 1; index < 50; index += 1) {
      const result = await client.callTool({
        name: 'browser_workspaces',
        arguments: { action: 'create', name: `Bounded workspace ${index}` }
      }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
    }
    const overflow = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Workspace over the limit' }
    }) as CallToolResult
    expect(overflow.isError).toBe(true)
    expect(text(overflow)).toContain('up to 50 active workspaces')

    const restoredOverflow = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'open', savedWorkspaceId: archivedWorkspace.id }
    }) as CallToolResult
    expect(restoredOverflow.isError).toBe(true)
    expect(text(restoredOverflow)).toContain('up to 50 active workspaces')
    const savedAfterRejectedRestore = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'list' }
    }) as CallToolResult
    expect(JSON.parse(text(savedAfterRejectedRestore))).toContainEqual(expect.objectContaining({ id: archivedWorkspace.id }))
  } finally {
    await client.close()
  }
})

test('archives an agent workspace and reopens it with a fresh workspace id', async ({ mcpPort, mcpToken }) => {
  const client = await connectClient('saved-group-test', mcpPort, mcpToken)
  try {
    const workspaceId = await createWorkspace(client, 'Deferred investigation', 'pink')
    await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: 'data:text/html,<title>Deferred tab</title><h1>Later</h1>' }
    })
    const savedResult = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'save', workspaceId }
    }) as CallToolResult
    expect(savedResult.isError, text(savedResult)).not.toBe(true)
    const saved = JSON.parse(text(savedResult)) as { id: string; name: string; color: string; tabs: Array<{ url: string }> }
    expect(saved.id).toMatch(UUID_V7_PATTERN)
    expect(saved).toMatchObject({ name: 'Deferred investigation', color: 'pink' })
    expect(saved.tabs).toEqual([expect.objectContaining({ url: expect.stringContaining('<title>Deferred tab</title>') })])

    const activeGroups = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(activeGroups))).not.toContainEqual(expect.objectContaining({ id: workspaceId }))
    const listedSaved = await client.callTool({ name: 'browser_saved_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(listedSaved))).toContainEqual(expect.objectContaining({ id: saved.id, name: 'Deferred investigation' }))

    const openedResult = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'open', savedWorkspaceId: saved.id }
    }) as CallToolResult
    expect(openedResult.isError, text(openedResult)).not.toBe(true)
    const opened = JSON.parse(text(openedResult)) as { id: string; name: string; color: string; tabCount: number }
    expect(opened).toMatchObject({ name: 'Deferred investigation', color: 'pink', tabCount: 1 })
    expect(opened.id).toMatch(UUID_V7_PATTERN)
    expect(opened.id).not.toBe(workspaceId)
    const emptySaved = await client.callTool({ name: 'browser_saved_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(emptySaved))).toEqual([])
  } finally {
    await client.close()
  }
})

test('keeps a failed archive restore under one active owner when rollback also fails', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  const client = await connectClient('saved-group-rollback-test', mcpPort, mcpToken)
  try {
    const workspaceId = await createWorkspace(client, 'Recoverable archive', 'orange')
    await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: 'data:text/html,<title>Recoverable tab</title><h1>Keep me</h1>' }
    })
    const savedResult = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'save', workspaceId }
    }) as CallToolResult
    expect(savedResult.isError, text(savedResult)).not.toBe(true)
    const savedWorkspaceId = (JSON.parse(text(savedResult)) as { id: string }).id

    await electronApp.evaluate(({ BrowserWindow, WebContentsView }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (!mainWindow) throw new Error('Main window is unavailable')
      const contentView = mainWindow.contentView as unknown as {
        removeChildView: (view: Electron.WebContentsView) => void
      }
      const viewPrototype = WebContentsView.prototype as unknown as {
        setBounds: (bounds: Electron.Rectangle) => void
      }
      const originalRemoveChildView = contentView.removeChildView
      const originalSetBounds = viewPrototype.setBounds
      const existingViews = new Set(mainWindow.contentView.children)
      let layoutFailed = false
      let restoredView: Electron.WebContentsView | null = null
      contentView.removeChildView = function (view): void {
        if (layoutFailed && view === restoredView) throw new Error('Injected archive rollback detach failure')
        return originalRemoveChildView.call(this, view)
      }
      viewPrototype.setBounds = function (this: Electron.WebContentsView, bounds): void {
        if (!layoutFailed && !existingViews.has(this)) {
          restoredView = this
          layoutFailed = true
          throw new Error('Injected archive restore layout failure')
        }
        return originalSetBounds.call(this, bounds)
      }
      ;(globalThis as typeof globalThis & {
        __hronautArchiveRestoreFault?: {
          contentView: typeof contentView
          viewPrototype: typeof viewPrototype
          originalRemoveChildView: typeof originalRemoveChildView
          originalSetBounds: typeof originalSetBounds
        }
      }).__hronautArchiveRestoreFault = {
        contentView,
        viewPrototype,
        originalRemoveChildView,
        originalSetBounds
      }
    })

    const openedResult = await client.callTool({
      name: 'browser_saved_workspaces',
      arguments: { action: 'open', savedWorkspaceId }
    }) as CallToolResult
    expect(openedResult.isError).toBe(true)
    expect(text(openedResult)).toContain('could not be restored or rolled back')

    await electronApp.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __hronautArchiveRestoreFault?: {
          contentView: { removeChildView: (view: Electron.WebContentsView) => void }
          viewPrototype: { setBounds: (bounds: Electron.Rectangle) => void }
          originalRemoveChildView: (view: Electron.WebContentsView) => void
          originalSetBounds: (bounds: Electron.Rectangle) => void
        }
      }).__hronautArchiveRestoreFault
      if (!state) return
      state.contentView.removeChildView = state.originalRemoveChildView
      state.viewPrototype.setBounds = state.originalSetBounds
      delete (globalThis as typeof globalThis & { __hronautArchiveRestoreFault?: unknown }).__hronautArchiveRestoreFault
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      active: state.mcpTabGroups.filter((workspace) => workspace.name === 'Recoverable archive').length,
      archived: state.savedTabGroups.filter((workspace) => workspace.name === 'Recoverable archive').length
    }))`)).toEqual({ active: 1, archived: 0 })
    await expect.poll(async () => {
      const source = await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => '')
      if (!source) return null
      const persisted = JSON.parse(source) as {
        mcpTabGroups: Array<{ name: string }>
        savedTabGroups?: Array<{ name: string }>
      }
      return {
        active: persisted.mcpTabGroups.filter((workspace) => workspace.name === 'Recoverable archive').length,
        archived: (persisted.savedTabGroups ?? []).filter((workspace) => workspace.name === 'Recoverable archive').length
      }
    }).toEqual({ active: 1, archived: 0 })
  } finally {
    await electronApp.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __hronautArchiveRestoreFault?: {
          contentView: { removeChildView: (view: Electron.WebContentsView) => void }
          viewPrototype: { setBounds: (bounds: Electron.Rectangle) => void }
          originalRemoveChildView: (view: Electron.WebContentsView) => void
          originalSetBounds: (bounds: Electron.Rectangle) => void
        }
      }).__hronautArchiveRestoreFault
      if (!state) return
      state.contentView.removeChildView = state.originalRemoveChildView
      state.viewPrototype.setBounds = state.originalSetBounds
      delete (globalThis as typeof globalThis & { __hronautArchiveRestoreFault?: unknown }).__hronautArchiveRestoreFault
    }).catch(() => undefined)
    await client.close()
  }
})

test('restores workspace identity and tabs after an application restart', async ({ profileDirectory, mcpPort }) => {
  let instance = await launchHronaut(profileDirectory, mcpPort)
  const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
  const firstClient = await connectClient('group-restart-before', mcpPort, token)
  const workspaceId = await createWorkspace(firstClient, 'Persistent investigation', 'green')
  const opened = await firstClient.callTool({
    name: 'browser_new_tab',
    arguments: { workspaceId, url: 'data:text/html,<title>Persistent grouped tab</title><h1>Still here</h1>' }
  }) as CallToolResult
  const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
  await instance.window.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Persistent human tab</title><h1>Mine</h1>', active: false })`)
  const defaultGroupId = await instance.window.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.find((group) => group.isDefault)?.id)`) as string
  const groupControl = instance.window.locator('.tab-group-label', { hasText: 'Persistent investigation' })
  await expect(groupControl).toHaveAttribute('aria-expanded', 'true')
  await expect(groupControl).toHaveAccessibleName('Collapse workspace Persistent investigation, 1 tab')
  await groupControl.click()
  await expect(groupControl).toHaveAttribute('aria-expanded', 'false')
  await expect(instance.window.getByRole('tab', { name: /^Persistent grouped tab/ })).toBeHidden()
  expect(await instance.window.evaluate('JSON.parse(localStorage.getItem("hronaut:collapsed-tab-groups"))')).toEqual([workspaceId])
  await firstClient.close()
  await closeHronaut(instance.app)

  instance = await launchHronaut(profileDirectory, mcpPort)
  const secondClient = await connectClient('group-restart-after', mcpPort, token)
  try {
    const restoredGroupControl = instance.window.locator('.tab-group-label', { hasText: 'Persistent investigation' })
    await expect.poll(() => instance.window.evaluate(`window.hronaut.getState().then((state) => ({
      defaultGroup: state.mcpTabGroups.find((group) => group.isDefault),
      humanGroupId: state.tabs.find((tab) => tab.title === 'Persistent human tab')?.mcpGroupId
    }))`)).toMatchObject({
      defaultGroup: { id: defaultGroupId, name: 'Default', isDefault: true },
      humanGroupId: defaultGroupId
    })
    await expect(restoredGroupControl).toHaveAttribute('aria-expanded', 'false')
    await expect(restoredGroupControl).toHaveAccessibleName('Expand workspace Persistent investigation, 1 tab')
    await expect(instance.window.getByRole('tab', { name: /^Persistent grouped tab/ })).toBeHidden()
    const humanTabId = await instance.window.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === 'Persistent human tab')?.id)`) as string
    await instance.window.evaluate(`window.hronaut.selectTab('${humanTabId}')`)
    await expect.poll(() => instance.window.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`)).toBe(humanTabId)
    await instance.window.evaluate(`window.hronaut.selectTab('${tabId}')`)
    await expect(restoredGroupControl).toHaveAttribute('aria-expanded', 'true')
    await expect(instance.window.getByRole('tab', { name: /^Persistent grouped tab/ })).toBeVisible()
    await restoredGroupControl.press('Space')
    await expect(restoredGroupControl).toHaveAttribute('aria-expanded', 'false')
    await instance.window.getByRole('button', { name: 'Search tabs' }).click()
    await instance.window.getByRole('dialog', { name: 'Tabs' }).locator('.tab-search-open', { hasText: 'Persistent grouped tab' }).click()
    await expect(restoredGroupControl).toHaveAttribute('aria-expanded', 'true')
    await expect(instance.window.getByRole('tab', { name: /^Persistent grouped tab/ })).toBeVisible()
    const listed = await secondClient.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(listed))).toContainEqual(expect.objectContaining({
      id: workspaceId,
      name: 'Persistent investigation',
      color: 'green',
      tabCount: 1,
      activeTabId: tabId
    }))
    const status = await secondClient.callTool({ name: 'browser_status', arguments: { workspaceId } }) as CallToolResult
    expect(JSON.parse(text(status))).toMatchObject({
      activeTabId: tabId,
      tabs: [expect.objectContaining({ id: tabId, workspaceId })]
    })
  } finally {
    await secondClient.close()
    await closeHronaut(instance.app)
  }
})

test('drops legacy tab state and starts with a fresh UUIDv7 workspace format', async ({ profileDirectory, mcpPort }) => {
  await writeFile(join(profileDirectory, 'tabs.json'), `${JSON.stringify({
    activeTabId: 'legacy-human-tab',
    splitView: {
      firstTabId: 'legacy-human-tab',
      secondTabId: 'legacy-agent-tab',
      orientation: 'vertical',
      ratio: 0.5
    },
    mcpTabGroups: [
      {
        id: '8a513dbb-7f70-451e-8e27-f6c1d92168aa',
        name: 'Legacy agent workspace',
        color: 'cyan',
        createdAt: '2026-08-14T09:00:00.000Z',
        lastUsedAt: '2026-08-14T09:01:00.000Z'
      }
    ],
    tabs: [
      {
        id: 'legacy-human-tab',
        title: 'Legacy human tab',
        url: 'data:text/html,<title>Legacy human tab</title><h1>Legacy</h1>'
      },
      {
        id: 'legacy-agent-tab',
        title: 'Legacy agent tab',
        url: 'data:text/html,<title>Legacy agent tab</title><h1>Agent</h1>',
        mcpGroupId: '8a513dbb-7f70-451e-8e27-f6c1d92168aa'
      }
    ]
  }, null, 2)}\n`, 'utf8')

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const fresh = await instance.window.evaluate(`window.hronaut.getState().then((state) => ({
      defaultWorkspaceId: state.mcpTabGroups.find((workspace) => workspace.isDefault)?.id,
      workspaceNames: state.mcpTabGroups.map((workspace) => workspace.name),
      activeTabId: state.activeTabId,
      splitView: state.splitView,
      tabs: state.tabs.map((tab) => ({ id: tab.id, title: tab.title, url: tab.url }))
    }))`) as {
      defaultWorkspaceId?: string
      workspaceNames: string[]
      activeTabId?: string
      splitView?: { firstTabId: string; secondTabId: string }
      tabs: Array<{ id: string; title: string; url: string }>
    }
    expect(fresh.defaultWorkspaceId).toMatch(UUID_V7_PATTERN)
    expect(fresh.workspaceNames).toEqual(['Default'])
    expect(fresh.splitView).toBeUndefined()
    expect(fresh.tabs).toEqual([expect.objectContaining({
      id: expect.stringMatching(UUID_V7_PATTERN),
      title: 'Hronaut Home',
      url: 'hronaut://home/'
    })])
    expect(fresh.activeTabId).toBe(fresh.tabs[0]!.id)
    await expect.poll(async () => {
      const persisted = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8')) as {
        version?: number
        tabs?: Array<{ id: string; title: string }>
        mcpTabGroups?: Array<{ id: string; name: string }>
      }
      return persisted
    }).toMatchObject({
      version: 2,
      tabs: [expect.objectContaining({ id: expect.stringMatching(UUID_V7_PATTERN), title: 'Hronaut Home' })],
      mcpTabGroups: [expect.objectContaining({ id: expect.stringMatching(UUID_V7_PATTERN), name: 'Default' })]
    })
  } finally {
    await closeHronaut(instance.app)
  }
})
