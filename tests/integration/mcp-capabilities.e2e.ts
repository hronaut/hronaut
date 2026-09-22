import { BROWSER_TOOL_CATALOG } from '../../src/main/mcp/server.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('advertises scoped tools, handles attention and wakes semantic interactions', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl, counters } = capabilities
  const tools = await client.listTools()
  expect(tools.tools.map((tool) => ({ name: tool.name, description: tool.description })).sort((left, right) => left.name.localeCompare(right.name)))
    .toEqual(BROWSER_TOOL_CATALOG.map((tool) => ({ name: tool.name, description: tool.description })).sort((left, right) => left.name.localeCompare(right.name)))
  for (const availableTool of tools.tools) {
    if (availableTool.name === 'browser_workspaces' || availableTool.name === 'browser_saved_workspaces') continue
    const required = (availableTool.inputSchema as { required?: unknown }).required
    expect(required, `${availableTool.name} must require workspaceId`).toEqual(expect.arrayContaining(['workspaceId']))
  }

  const defaultDiagnosticLogs = await client.callTool({ name: 'browser_diagnostic_logs', arguments: { action: 'get' } }) as CallToolResult
  expect(JSON.parse(text(defaultDiagnosticLogs))).toMatchObject({ preserveAcrossNavigation: true })
  const disabledDiagnosticLogs = await client.callTool({
    name: 'browser_diagnostic_logs',
    arguments: { action: 'set', preserveAcrossNavigation: false }
  }) as CallToolResult
  expect(JSON.parse(text(disabledDiagnosticLogs))).toMatchObject({ preserveAcrossNavigation: false })
  await client.callTool({ name: 'browser_diagnostic_logs', arguments: { action: 'set', preserveAcrossNavigation: true } })

  const initialStatus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
  const requestedTabId = JSON.parse(text(initialStatus)).activeTabId as string
  const attention = await client.callTool({
    name: 'browser_request_user_attention',
    arguments: {
      reason: 'Please complete the manual confirmation in this browser.',
      tabId: requestedTabId
    }
  }) as CallToolResult
  expect(JSON.parse(text(attention))).toMatchObject({
    reason: 'Please complete the manual confirmation in this browser.',
    tabId: requestedTabId
  })
  const attentionStatus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
  expect(JSON.parse(text(attentionStatus)).userAttention).toMatchObject({
    reason: 'Please complete the manual confirmation in this browser.'
  })
  await client.callTool({ name: 'browser_show', arguments: {} })
  const afterAiFocus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
  expect(JSON.parse(text(afterAiFocus)).userAttention).toMatchObject({
    reason: 'Please complete the manual confirmation in this browser.'
  })
  await appWindow.mouse.click(400, 110)
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    return JSON.parse(text(result)).userAttention
  }).toBeNull()

  await electronApp.evaluate(async ({ webContents }, fixture) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === fixture.url)
    if (!page) throw new Error(`Memory Saver fixture tab was not found: ${fixture.tabId}`)
    await page.executeJavaScript('window.startMemorySaverProbe()')
  }, { tabId, url: fixtureUrl })
  await expect.poll(() => counters.memorySaverTicks).toBeGreaterThan(1)
  await appWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: true })`)
  await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((value) => value.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(true)
  const ticksBeforeSleep = counters.memorySaverTicks
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(counters.memorySaverTicks).toBeLessThanOrEqual(ticksBeforeSleep + 1)
  const wakeSnapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
  expect(wakeSnapshot.isError, text(wakeSnapshot)).not.toBe(true)
  expect(text(wakeSnapshot)).toContain('Capability fixture')
  const findResult = await client.callTool({
    name: 'browser_find',
    arguments: { tabId, query: 'capture this area', maxMatches: 5 }
  }) as CallToolResult
  expect(findResult.isError, text(findResult)).not.toBe(true)
  const foundSnapshotText = JSON.parse(text(findResult)) as {
    tabId: string
    query: string
    matches: Array<{ snippet: string }>
    truncated: boolean
  }
  expect(foundSnapshotText).toMatchObject({
    tabId,
    query: 'capture this area',
    truncated: false
  })
  expect(foundSnapshotText.matches).toEqual(expect.arrayContaining([
    expect.objectContaining({ snippet: expect.stringContaining('Capture this area') })
  ]))
  const elementInspectionResult = await client.callTool({
    name: 'browser_element_inspect',
    arguments: { tabId, selector: '#capture-target' }
  }) as CallToolResult
  expect(elementInspectionResult.isError, text(elementInspectionResult)).not.toBe(true)
  const elementInspection = JSON.parse(text(elementInspectionResult))
  expect(elementInspection).toMatchObject({
    tabId,
    selector: '#capture-target',
    tag: 'button',
    text: 'Capture this area',
    box: { width: 240, height: 120, boxSizing: 'border-box' },
    layout: { display: expect.any(String), position: 'static' },
    typography: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(103, 87, 232)' },
    accessibility: { role: 'button', name: 'Capture this area', focusable: true, disabled: false }
  })
  expect(JSON.stringify(elementInspection)).not.toContain('element-inspection-secret')
  const generatedLocatorResult = await client.callTool({
    name: 'browser_generate_locator',
    arguments: { tabId, selector: '#capture-target' }
  }) as CallToolResult
  expect(generatedLocatorResult.isError, text(generatedLocatorResult)).not.toBe(true)
  expect(JSON.parse(text(generatedLocatorResult))).toMatchObject({
    tabId,
    locator: 'page.getByRole("button", { name: "Capture this area", exact: true })',
    strategy: 'role',
    selector: '#capture-target'
  })
  expect(text(generatedLocatorResult)).not.toContain('element-inspection-secret')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((value) => value.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(false)
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!page) throw new Error('Woken Memory Saver fixture tab was not found')
    await page.executeJavaScript('window.startMemorySaverProbe()')
  }, fixtureUrl)
  await expect.poll(() => counters.memorySaverTicks).toBeGreaterThan(ticksBeforeSleep + 1)
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!page) throw new Error('Memory Saver form-protection fixture tab was not found')
    await page.executeJavaScript(`(() => {
      const input = document.querySelector('#name');
      input.value = 'unsaved draft';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
  }, fixtureUrl)
  const sleepError = await appWindow.evaluate(`(async () => {
    try {
      await window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)
      return ''
    } catch (error) {
      return String(error)
    }
  })()`)
  expect(sleepError).toContain('partially filled form')
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })
  const hardReload = await client.callTool({
    name: 'browser_history',
    arguments: { action: 'reload-ignoring-cache', tabId }
  }) as CallToolResult
  expect(hardReload.isError).not.toBe(true)
  expect(JSON.parse(text(hardReload))).toMatchObject({ activeTabId: tabId })
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })
})
