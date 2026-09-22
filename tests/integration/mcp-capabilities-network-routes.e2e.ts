import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('orders, consumes and removes temporary network conditions', async ({ capabilities, appWindow }) => {
  const { client, tabId, address } = capabilities
  const routePattern = `http://127.0.0.1:${address.port}/route-target`
  const throttledRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'add', tabId, urlPattern: routePattern, throttle: 'slow-3g' }
  }) as CallToolResult
  expect(JSON.parse(text(throttledRoutes))).toEqual([
    expect.objectContaining({ urlPattern: routePattern, behavior: 'throttle', throttle: 'slow-3g' })
  ])
  expect(text(throttledRoutes)).not.toContain('remainingMatches')
  const throttledFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => { const started = performance.now(); const status = await fetch('/route-target').then((response) => response.status); return { status, elapsedMs: Math.round(performance.now() - started) }; })()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(throttledFetch))).toEqual({ status: 200, elapsedMs: expect.any(Number) })
  expect((JSON.parse(text(throttledFetch)) as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(1_500)
  const throttleRouteId = (JSON.parse(text(throttledRoutes)) as Array<{ id: string }>)[0]?.id
  expect(throttleRouteId).toBeTruthy()
  await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'remove', tabId, routeId: throttleRouteId }
  })
  const mockedRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: {
      action: 'add',
      tabId,
      urlPattern: routePattern,
      method: 'GET',
      response: {
        status: 503,
        headers: { 'content-type': 'application/json', 'x-hronaut-mock': 'active' },
        body: '{"source":"mocked"}'
      }
    }
  }) as CallToolResult
  expect(JSON.parse(text(mockedRoutes))).toEqual([
    expect.objectContaining({
      urlPattern: routePattern,
      method: 'GET',
      behavior: 'fulfill',
      remainingMatches: 1,
      response: expect.objectContaining({ status: 503, bodyBytes: 19 })
    })
  ])
  const lowerPriorityRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: {
      action: 'add',
      tabId,
      urlPattern: routePattern,
      method: 'GET',
      response: { status: 429, body: '{"source":"priority"}' }
    }
  }) as CallToolResult
  const priorityRouteId = (JSON.parse(text(lowerPriorityRoutes)) as Array<{ id: string }>)[1]?.id
  expect(priorityRouteId).toBeTruthy()
  const prioritizedRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'move', tabId, routeId: priorityRouteId, direction: 'up' }
  }) as CallToolResult
  expect((JSON.parse(text(prioritizedRoutes)) as Array<{ response?: { status: number } }>).map((route) => route.response?.status)).toEqual([429, 503])
  const priorityFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: `fetch('/route-target').then((response) => response.status)` }
  }) as CallToolResult
  expect(text(priorityFetch)).toBe('429')
  const requestConditionPill = appWindow.getByRole('button', { name: 'Open 1 temporary request condition' })
  await expect(requestConditionPill).toBeVisible()
  await requestConditionPill.click()
  const routeNetworkPanel = appWindow.getByRole('dialog', { name: 'Network' })
  const requestConditions = routeNetworkPanel.getByRole('region', { name: 'Request conditions' })
  await expect(requestConditions.getByText(routePattern, { exact: true })).toBeVisible()
  await expect(requestConditions).not.toContainText('{"source":"mocked"}')
  await expect(requestConditions).not.toContainText('x-hronaut-mock: active')
  const mockedFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `Promise.all([fetch('/route-target'), fetch('/route-target')]).then((responses) => Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json(), mock: response.headers.get('x-hronaut-mock') }))))`
    }
  }) as CallToolResult
  expect(JSON.parse(text(mockedFetch))).toEqual([
    { status: 503, body: { source: 'mocked' }, mock: 'active' },
    { status: 200, body: { source: 'real' }, mock: null }
  ])
  await expect(appWindow.locator('.network-routes-pill')).toHaveCount(0)

  const abortRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: {
      action: 'add',
      tabId,
      urlPattern: routePattern,
      times: 2,
      abort: 'TimedOut'
    }
  }) as CallToolResult
  expect(JSON.parse(text(abortRoutes))).toEqual([
    expect.objectContaining({ behavior: 'abort', abort: 'TimedOut', remainingMatches: 2 })
  ])
  const abortedFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: `fetch('/route-target').then(() => 'unexpected', () => 'failed')` }
  }) as CallToolResult
  expect(text(abortedFetch)).toBe('failed')
  const remainingRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'list', tabId }
  }) as CallToolResult
  expect(JSON.parse(text(remainingRoutes))).toEqual([
    expect.objectContaining({ behavior: 'abort', remainingMatches: 1 })
  ])
  await expect(appWindow.getByRole('button', { name: 'Open 1 temporary request condition' })).toBeVisible()
  await expect(requestConditions).toContainText('TimedOut')
  await requestConditions.getByRole('button', { name: 'Remove all' }).click()
  const clearedRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'list', tabId }
  }) as CallToolResult
  expect(JSON.parse(text(clearedRoutes))).toEqual([])

  const conditionForm = requestConditions.getByRole('form', { name: 'Add temporary request condition' })
  await conditionForm.getByLabel('URL pattern').fill(routePattern)
  await conditionForm.getByLabel('Method').selectOption('GET')
  await conditionForm.getByLabel('Behavior').selectOption('fulfill')
  await conditionForm.getByLabel('Matches').fill('1')
  await conditionForm.getByLabel('HTTP status').fill('418')
  await conditionForm.getByLabel(/Response headers/).fill('{"content-type":"application/json","x-human-secret":"not-rendered"}')
  await conditionForm.getByLabel(/Response body/).fill('{"source":"human-condition"}')
  await conditionForm.getByRole('button', { name: 'Add condition' }).click()
  await expect(requestConditions).toContainText('Respond 418')
  await expect(requestConditions).not.toContainText('not-rendered')
  await expect(requestConditions).not.toContainText('human-condition')
  const secondaryPattern = `http://127.0.0.1:${address.port}/route-secondary`
  const twoHumanRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'add', tabId, urlPattern: secondaryPattern, abort: 'Failed' }
  }) as CallToolResult
  const secondaryRouteId = (JSON.parse(text(twoHumanRoutes)) as Array<{ id: string }>)[1]?.id
  expect(secondaryRouteId).toBeTruthy()
  await expect(requestConditions.getByText(secondaryPattern, { exact: true })).toBeVisible()
  await requestConditions.getByRole('button', { name: `Move request condition ${secondaryPattern} up` }).click()
  await expect.poll(async () => {
    const routes = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'list', tabId } }) as CallToolResult
    return (JSON.parse(text(routes)) as Array<{ urlPattern: string }>).map((route) => route.urlPattern)
  }).toEqual([secondaryPattern, routePattern])
  await requestConditions.getByRole('button', { name: `Move request condition ${secondaryPattern} down` }).click()
  await expect.poll(async () => {
    const routes = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'list', tabId } }) as CallToolResult
    return (JSON.parse(text(routes)) as Array<{ urlPattern: string }>).map((route) => route.urlPattern)
  }).toEqual([routePattern, secondaryPattern])
  await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'remove', tabId, routeId: secondaryRouteId }
  })
  const humanRoutes = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'list', tabId }
  }) as CallToolResult
  expect(JSON.parse(text(humanRoutes))).toEqual([
    expect.objectContaining({
      urlPattern: routePattern,
      method: 'GET',
      behavior: 'fulfill',
      remainingMatches: 1,
      response: expect.objectContaining({ status: 418, headerNames: ['content-type', 'x-human-secret'] })
    })
  ])
  const humanMock = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `fetch('/route-target').then(async (response) => ({ status: response.status, body: await response.json() }))`
    }
  }) as CallToolResult
  expect(JSON.parse(text(humanMock))).toEqual({ status: 418, body: { source: 'human-condition' } })
  await conditionForm.getByLabel('URL pattern').fill(secondaryPattern)
  await conditionForm.getByLabel('Behavior').selectOption('throttle')
  await conditionForm.getByLabel('Network profile').selectOption('fast-4g')
  await conditionForm.getByRole('button', { name: 'Add condition' }).click()
  await expect(requestConditions).toContainText('Throttle as Fast 4G')
  await expect(requestConditions).toContainText('until removed')
  const humanThrottle = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'list', tabId }
  }) as CallToolResult
  expect(JSON.parse(text(humanThrottle))).toEqual([
    expect.objectContaining({ urlPattern: secondaryPattern, behavior: 'throttle', throttle: 'fast-4g' })
  ])
  await requestConditions.getByRole('button', { name: 'Remove all' }).click()
  await expect(appWindow.locator('.network-routes-pill')).toHaveCount(0)
})
