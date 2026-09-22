import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('distinguishes service worker and cache sources from network responses', async ({ capabilities, appWindow }) => {
  const { client, tabId, fixtureOrigin, openPageTool } = capabilities
  const serviceWorkerRegistration = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => {
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        return registration.scope;
      })()`
    }
  }) as CallToolResult
  expect(text(serviceWorkerRegistration)).toContain(fixtureOrigin)
  await client.callTool({ name: 'browser_history', arguments: { action: 'reload', tabId } })
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })
  const normalRequestSources = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => {
        const cacheUrl = '/cache-probe?case=environment';
        const first = await fetch(cacheUrl).then((response) => response.json());
        const second = await fetch(cacheUrl).then((response) => response.json());
        const serviceWorker = await fetch('/sw-probe').then((response) => response.json());
        return { controlled: navigator.serviceWorker.controller !== null, first, second, serviceWorker };
      })()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(normalRequestSources))).toEqual({
    controlled: true,
    first: { requestCount: 1 },
    second: { requestCount: 1 },
    serviceWorker: { source: 'service-worker' }
  })
  const serviceWorkerNetworkResult = await client.callTool({
    name: 'browser_network',
    arguments: { tabId, query: '/sw-probe', resourceType: 'fetch/xhr' }
  }) as CallToolResult
  const serviceWorkerRequests = JSON.parse(text(serviceWorkerNetworkResult)) as Array<{
    id: string
    status: number
    responseSource?: string
    serviceWorkerResponseSource?: string
    cacheStorageCacheName?: string
  }>
  const serviceWorkerRequest = serviceWorkerRequests.find((request) => request.status === 200)
  expect(serviceWorkerRequest).toMatchObject({
    status: 200,
    responseSource: 'service-worker',
    serviceWorkerResponseSource: 'cache-storage',
    cacheStorageCacheName: 'hronaut-capability-cache'
  })
  const serviceWorkerDetailsResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: serviceWorkerRequest?.id }
  }) as CallToolResult
  expect(serviceWorkerDetailsResult.isError, text(serviceWorkerDetailsResult)).not.toBe(true)
  expect(JSON.parse(text(serviceWorkerDetailsResult))).toMatchObject({
    responseSource: 'service-worker',
    serviceWorkerResponseSource: 'cache-storage',
    cacheStorageCacheName: 'hronaut-capability-cache'
  })
  const serviceWorkerHarResult = await client.callTool({
    name: 'browser_network_har',
    arguments: { tabId, query: '/sw-probe', resourceType: 'fetch/xhr' }
  }) as CallToolResult
  expect(JSON.parse(text(serviceWorkerHarResult))).toMatchObject({
    log: {
      entries: [expect.objectContaining({
        _hronaut: expect.objectContaining({
          responseSource: 'service-worker',
          serviceWorkerResponseSource: 'cache-storage',
          cacheStorageCacheName: 'hronaut-capability-cache'
        })
      })]
    }
  })

  await openPageTool('Open network monitor')
  const responseSourceNetworkPanel = appWindow.getByRole('dialog', { name: 'Network' })
  await responseSourceNetworkPanel.getByRole('searchbox', { name: 'Filter network requests' }).fill('/sw-probe')
  const serviceWorkerRow = responseSourceNetworkPanel.locator(`[data-request-id="${serviceWorkerRequest?.id}"]`)
  await expect(serviceWorkerRow).toContainText('Service worker')
  await serviceWorkerRow.click()
  await expect(responseSourceNetworkPanel.locator('summary').filter({ hasText: 'Response source' })).toContainText('Service worker · Cache Storage')
  await expect(responseSourceNetworkPanel).toContainText('hronaut-capability-cache')
  await responseSourceNetworkPanel.getByRole('button', { name: 'Close network monitor' }).click()

  const bypassedRequestSources = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId, cacheDisabled: true, bypassServiceWorker: true }
  }) as CallToolResult
  expect(JSON.parse(text(bypassedRequestSources))).toMatchObject({
    cacheDisabled: true,
    bypassServiceWorker: true
  })
  const bypassedPageSources = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => {
        const cacheUrl = '/cache-probe?case=environment';
        const first = await fetch(cacheUrl).then((response) => response.json());
        const second = await fetch(cacheUrl).then((response) => response.json());
        const serviceWorker = await fetch('/sw-probe').then((response) => response.json());
        return { first, second, serviceWorker };
      })()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(bypassedPageSources))).toEqual({
    first: { requestCount: 2 },
    second: { requestCount: 3 },
    serviceWorker: { source: 'network' }
  })
  await openPageTool(/Environment: 2 active conditions/)
  const requestSourcesEnvironment = appWindow.getByRole('dialog', { name: 'Environment' })
  await expect(requestSourcesEnvironment.getByLabel('Disable HTTP cache')).toBeChecked()
  await expect(requestSourcesEnvironment.getByLabel('Bypass service worker')).toBeChecked()
  await requestSourcesEnvironment.getByLabel('Disable HTTP cache').uncheck()
  await requestSourcesEnvironment.getByLabel('Bypass service worker').uncheck()
  await requestSourcesEnvironment.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect.poll(async () => {
    const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    return JSON.parse(text(current))
  }).toMatchObject({ cacheDisabled: false, bypassServiceWorker: false })
  await requestSourcesEnvironment.getByRole('button', { name: 'Close Environment' }).click()
})
