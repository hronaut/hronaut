import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('inspects network waits, streams, redirects and redacted diagnostic exports', async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
  const { client, tabId, address, fixtureOrigin, redactedFixtureUrl, openPageTool } = capabilities
  // Initial page requests may precede debugger attachment. Seed a completed
  // baseline here so duration sorting never depends on another capability case.
  const baselineFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: `fetch('/api-details?view=compact&timing=baseline', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'baseline' })
    }).then(response => response.json())` }
  }) as CallToolResult
  expect(baselineFetch.isError, text(baselineFetch)).not.toBe(true)
  const scheduledWaitProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "window.scheduleNetworkWaitProbe('future', 150)"
    }
  }) as CallToolResult
  expect(text(scheduledWaitProbe)).toBe('scheduled')
  const futureNetworkWaitResult = await client.callTool({
    name: 'browser_network_wait',
    arguments: {
      tabId,
      urlPattern: `*://127.0.0.1:${address.port}/wait-probe*`,
      method: 'GET',
      resourceType: 'fetch/xhr',
      status: 202,
      phase: 'complete',
      from: 'future',
      timeoutMs: 5_000
    }
  }) as CallToolResult
  expect(futureNetworkWaitResult.isError, text(futureNetworkWaitResult)).not.toBe(true)
  const futureNetworkWait = JSON.parse(text(futureNetworkWaitResult)) as {
    matchedFrom: string
    waitedMs: number
    request: { id: string; url: string; status: number; completedAt: string }
  }
  expect(futureNetworkWait).toMatchObject({
    matchedFrom: 'future',
    waitedMs: expect.any(Number),
    request: {
      status: 202,
      completedAt: expect.any(String),
      url: expect.stringContaining('sequence=future')
    }
  })
  expect(text(futureNetworkWaitResult)).not.toContain('network-wait-secret')
  const retainedWaitProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "window.runNetworkWaitProbe('retained')"
    }
  }) as CallToolResult
  expect(JSON.parse(text(retainedWaitProbe))).toMatchObject({ accepted: true })
  const retainedNetworkWaitResult = await client.callTool({
    name: 'browser_network_wait',
    arguments: {
      tabId,
      urlPattern: `*://127.0.0.1:${address.port}/wait-probe*`,
      status: 202,
      phase: 'complete',
      afterRequestId: futureNetworkWait.request.id,
      timeoutMs: 5_000
    }
  }) as CallToolResult
  expect(retainedNetworkWaitResult.isError, text(retainedNetworkWaitResult)).not.toBe(true)
  expect(JSON.parse(text(retainedNetworkWaitResult))).toMatchObject({
    matchedFrom: 'retained',
    waitedMs: 0,
    request: {
      status: 202,
      url: expect.stringContaining('sequence=retained')
    }
  })
  expect(text(retainedNetworkWaitResult)).not.toContain('network-wait-secret')
  const webSocketProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.runWebSocketProbe()' }
  }) as CallToolResult
  expect(JSON.parse(text(webSocketProbe))).toEqual([
    { event: 'welcome', token: 'server-secret', visible: 'server-kept' },
    { event: 'echo', received: 'client-kept', accessToken: 'server-secret', visible: 'echo-kept' },
    { binaryBytes: 4 }
  ])
  let webSocketRequest: Record<string, unknown> | undefined
  await expect.poll(async () => {
    const networkResult = await client.callTool({
      name: 'browser_network',
      arguments: { tabId, query: '/socket', resourceType: 'websocket' }
    }) as CallToolResult
    webSocketRequest = (JSON.parse(text(networkResult)) as Array<Record<string, unknown>>)[0]
    return webSocketRequest?.status === 101 && typeof webSocketRequest.completedAt === 'string'
  }).toBe(true)
  const webSocketDetailsResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: webSocketRequest?.id }
  }) as CallToolResult
  expect(webSocketDetailsResult.isError, text(webSocketDetailsResult)).not.toBe(true)
  const webSocketDetails = JSON.parse(text(webSocketDetailsResult)) as {
    resourceType: string
    status: number
    webSocket: {
      open: boolean
      messages: Array<{ direction: string; kind: string; sizeBytes: number; text?: string; redacted?: boolean }>
      droppedMessages: number
    }
  }
  expect(webSocketDetails).toMatchObject({
    resourceType: 'websocket',
    status: 101,
    webSocket: { open: false, droppedMessages: 0 }
  })
  expect(webSocketDetails.webSocket.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ direction: 'sent', kind: 'text', text: expect.stringContaining('client-kept'), redacted: true }),
    expect.objectContaining({ direction: 'received', kind: 'text', text: expect.stringContaining('server-kept'), redacted: true }),
    expect.objectContaining({ direction: 'received', kind: 'text', text: expect.stringContaining('echo-kept'), redacted: true }),
    expect.objectContaining({ direction: 'received', kind: 'binary', sizeBytes: 4 })
  ]))
  expect(text(webSocketDetailsResult)).toContain('[REDACTED]')
  expect(text(webSocketDetailsResult)).not.toContain('client-secret')
  expect(text(webSocketDetailsResult)).not.toContain('server-secret')
  const webSocketHarResult = await client.callTool({
    name: 'browser_network_har',
    arguments: { tabId, query: '/socket', resourceType: 'websocket', includeBodies: true }
  }) as CallToolResult
  expect(JSON.parse(text(webSocketHarResult))).toMatchObject({
    log: {
      entries: [expect.objectContaining({
        response: expect.objectContaining({ status: 101 }),
        _hronaut: expect.objectContaining({
          resourceType: 'websocket',
          webSocket: { open: false, messageCount: expect.any(Number), droppedMessages: 0 }
        })
      })]
    }
  })
  expect(text(webSocketHarResult)).not.toContain('client-kept')
  expect(text(webSocketHarResult)).not.toContain('server-kept')
  const eventSourceProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.runEventSourceProbe()' }
  }) as CallToolResult
  expect(JSON.parse(text(eventSourceProbe))).toEqual([
    { event: 'message', id: '', data: { state: 'ready', accessToken: 'sse-secret', visible: 'sse-kept' } },
    { event: 'progress', id: 'event-2', data: { state: 'complete', password: 'sse-secret', visible: 'progress-kept' } }
  ])
  let eventSourceRequest: Record<string, unknown> | undefined
  await expect.poll(async () => {
    const networkResult = await client.callTool({
      name: 'browser_network',
      arguments: { tabId, query: '/events', resourceType: 'eventsource' }
    }) as CallToolResult
    eventSourceRequest = (JSON.parse(text(networkResult)) as Array<Record<string, unknown>>)[0]
    return eventSourceRequest?.status === 200
  }).toBe(true)
  const eventSourceDetailsResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: eventSourceRequest?.id }
  }) as CallToolResult
  expect(eventSourceDetailsResult.isError, text(eventSourceDetailsResult)).not.toBe(true)
  const eventSourceDetails = JSON.parse(text(eventSourceDetailsResult)) as {
    resourceType: string
    eventSource: {
      open: boolean
      messages: Array<{ eventName: string; eventId?: string; data: string; redacted: boolean }>
      droppedMessages: number
    }
  }
  expect(eventSourceDetails).toMatchObject({
    resourceType: 'eventsource',
    eventSource: { droppedMessages: 0 }
  })
  expect(eventSourceDetails.eventSource.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'message', data: expect.stringContaining('sse-kept'), redacted: true }),
    expect.objectContaining({ eventName: 'progress', eventId: 'event-2', data: expect.stringContaining('progress-kept'), redacted: true })
  ]))
  expect(text(eventSourceDetailsResult)).toContain('[REDACTED]')
  expect(text(eventSourceDetailsResult)).not.toContain('sse-secret')
  const eventSourceSearchResult = await client.callTool({
    name: 'browser_network_search',
    arguments: { tabId, query: 'progress-kept' }
  }) as CallToolResult
  expect(JSON.parse(text(eventSourceSearchResult))).toMatchObject({
    matches: [expect.objectContaining({
      requestId: eventSourceRequest?.id,
      field: 'eventsource-message',
      label: 'progress event'
    })]
  })
  const eventSourceHarResult = await client.callTool({
    name: 'browser_network_har',
    arguments: { tabId, query: '/events', resourceType: 'eventsource', includeBodies: true }
  }) as CallToolResult
  expect(JSON.parse(text(eventSourceHarResult))).toMatchObject({
    log: {
      entries: [expect.objectContaining({
        _hronaut: expect.objectContaining({
          resourceType: 'eventsource',
          eventSource: { open: expect.any(Boolean), messageCount: 2, droppedMessages: 0 }
        })
      })]
    }
  })
  expect(text(eventSourceHarResult)).not.toContain('sse-kept')
  expect(text(eventSourceHarResult)).not.toContain('progress-kept')
  const diagnosticFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: 'window.runDelayedNetworkProbe()'
    }
  }) as CallToolResult
  expect(JSON.parse(text(diagnosticFetch))).toMatchObject({ ok: true, receivedQuery: 'diagnose-me' })
  const redirectFetch = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: 'window.runRedirectProbe()'
    }
  }) as CallToolResult
  expect(JSON.parse(text(redirectFetch))).toEqual({ redirected: true, visible: 'redirect-kept' })
  let networkRequests: Array<Record<string, unknown>> = []
  await expect.poll(async () => {
    const networkResult = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
    networkRequests = JSON.parse(text(networkResult)) as Array<Record<string, unknown>>
    return networkRequests.some((request) => (
      String(request.url).includes('/api-details') && request.detailsAvailable === true && request.status === 200
    ))
  }).toBe(true)
  expect(networkRequests).toEqual(
    expect.arrayContaining([expect.objectContaining({ url: `http://127.0.0.1:${address.port}/api`, status: 200 })])
  )
  const detailedRequest = [...networkRequests].reverse().find((request) => (
    String(request.url).includes('/api-details') && request.detailsAvailable === true
  ))
  expect(detailedRequest).toMatchObject({
    method: 'POST',
    status: 200,
    detailsAvailable: true,
    durationMs: expect.any(Number),
    waitingForResponseMs: expect.any(Number)
  })
  expect(String(detailedRequest?.url)).toContain('view=compact')
  expect(String(detailedRequest?.url)).not.toContain('url-secret')
  const redirectRequest = [...networkRequests].reverse().find((request) => (
    String(request.url).includes('/redirect-final') && request.status === 200
  ))
  expect(redirectRequest).toMatchObject({ method: 'GET', resourceType: 'fetch', status: 200 })
  expect(String(redirectRequest?.url)).toContain('view=final')
  expect(String(redirectRequest?.url)).not.toContain('redirect-final-secret')
  const redirectDetailsResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: redirectRequest?.id }
  }) as CallToolResult
  expect(redirectDetailsResult.isError, text(redirectDetailsResult)).not.toBe(true)
  const redirectDetails = JSON.parse(text(redirectDetailsResult)) as {
    relationships: {
      redirectChain: Array<{ id: string; url: string; status: number }>
      dependents: unknown[]
      truncated: boolean
    }
  }
  expect(redirectDetails.relationships).toMatchObject({ dependents: [], truncated: false })
  expect(redirectDetails.relationships.redirectChain).toHaveLength(3)
  expect(redirectDetails.relationships.redirectChain.map((request) => request.status)).toEqual([302, 307, 200])
  expect(redirectDetails.relationships.redirectChain.map((request) => request.url)).toEqual([
    expect.stringContaining('/redirect-start'),
    expect.stringContaining('/redirect-middle'),
    expect.stringContaining('/redirect-final')
  ])
  expect(text(redirectDetailsResult)).not.toContain('redirect-start-secret')
  expect(text(redirectDetailsResult)).not.toContain('redirect-middle-secret')
  expect(text(redirectDetailsResult)).not.toContain('redirect-final-secret')
  expect(text(redirectDetailsResult)).not.toContain('cdpRequestId')
  expect(text(redirectDetailsResult)).not.toContain('initiatorRequestCdpId')
  const durationSortedFetchResult = await client.callTool({
    name: 'browser_network',
    arguments: {
      tabId,
      query: 'api-details',
      resourceType: 'fetch/xhr',
      sortBy: 'duration',
      sortDirection: 'desc',
      limit: 10
    }
  }) as CallToolResult
  const durationSortedFetches = JSON.parse(text(durationSortedFetchResult)) as Array<Record<string, unknown>>
  expect(durationSortedFetches.length).toBeGreaterThan(1)
  for (const request of durationSortedFetches) {
    expect(['fetch', 'xhr']).toContain(request.resourceType)
  }
  const completedFetches = durationSortedFetches.filter((request) => typeof request.durationMs === 'number')
  expect(completedFetches.length).toBeGreaterThan(1)
  expect(durationSortedFetches.slice(completedFetches.length).every((request) => request.durationMs === undefined)).toBe(true)
  const sortedDurations = completedFetches.map((request) => Number(request.durationMs))
  expect(sortedDurations).toEqual([...sortedDurations].sort((left, right) => right - left))
  expect(completedFetches.find((request) => String(request.url).includes('timing=delayed'))).toMatchObject({
    durationMs: expect.any(Number)
  })
  const propertyFilteredNetworkResult = await client.callTool({
    name: 'browser_network',
    arguments: {
      tabId,
      query: 'method:POST status-code:200 scheme:http domain:127.0.0.1 resource-type:fetch/xhr larger-than:1 url:api-details'
    }
  }) as CallToolResult
  expect(propertyFilteredNetworkResult.isError, text(propertyFilteredNetworkResult)).not.toBe(true)
  const propertyFilteredNetwork = JSON.parse(text(propertyFilteredNetworkResult)) as Array<Record<string, unknown>>
  expect(propertyFilteredNetwork.length).toBeGreaterThan(0)
  expect(propertyFilteredNetwork).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: detailedRequest?.id, method: 'POST', status: 200, resourceType: 'fetch' })
  ]))
  expect(propertyFilteredNetwork.every((request) => String(request.url).includes('/api-details'))).toBe(true)
  const networkDetailsResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: detailedRequest?.id }
  }) as CallToolResult
  const networkDetails = JSON.parse(text(networkDetailsResult)) as {
    request: { headers: Record<string, string>; body: { text: string; redacted: boolean } }
    response: {
      headers: Record<string, string>
      body: { available: boolean; text: string; redacted: boolean }
      serverTiming: Array<{ name: string; durationMs?: number; description?: string }>
    }
    timing: {
      totalMs: number
      queuedAndConnectingMs: number
      requestSentMs: number
      waitingForResponseMs: number
      responseHeadersMs: number
      contentDownloadMs: number
    }
    initiator: {
      type: string
      stack: Array<{ functionName?: string; url?: string; lineNumber: number; columnNumber: number }>
    }
  }
  const header = (headers: Record<string, string>, name: string): string | undefined => (
    Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name)?.[1]
  )
  expect(header(networkDetails.request.headers, 'authorization')).toBe('[REDACTED]')
  expect(header(networkDetails.request.headers, 'x-api-key')).toBe('[REDACTED]')
  expect(header(networkDetails.request.headers, 'x-visible')).toBe('request-kept')
  expect(header(networkDetails.response.headers, 'x-auth-token')).toBe('[REDACTED]')
  expect(header(networkDetails.response.headers, 'x-request-id')).toBe('network-detail-42')
  expect(JSON.parse(networkDetails.request.body.text)).toEqual({ query: 'diagnose-me', password: '[REDACTED]' })
  expect(networkDetails.request.body.redacted).toBe(true)
  expect(networkDetails.response.body.available).toBe(true)
  expect(JSON.parse(networkDetails.response.body.text)).toEqual({
    ok: true,
    receivedQuery: 'diagnose-me',
    accessToken: '[REDACTED]',
    visible: 'response-kept'
  })
  expect(networkDetails.response.body.redacted).toBe(true)
  expect(networkDetails.response.serverTiming).toEqual([
    { name: 'db', durationMs: 72.5, description: 'Primary, lookup token=[REDACTED]' },
    { name: 'cache', description: 'Miss; cold' },
    { name: 'app', durationMs: 36.2 }
  ])
  expect(networkDetails.timing.totalMs).toBeGreaterThanOrEqual(100)
  expect(networkDetails.timing.waitingForResponseMs).toBeGreaterThanOrEqual(90)
  expect(networkDetails.timing.queuedAndConnectingMs).toBeGreaterThanOrEqual(0)
  expect(networkDetails.timing.requestSentMs).toBeGreaterThanOrEqual(0)
  expect(networkDetails.timing.responseHeadersMs).toBeGreaterThanOrEqual(0)
  expect(networkDetails.timing.contentDownloadMs).toBeGreaterThanOrEqual(0)
  expect(networkDetails.initiator.type).toBe('script')
  expect(networkDetails.initiator.stack).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: redactedFixtureUrl, lineNumber: expect.any(Number) })
  ]))
  expect(JSON.stringify(networkDetails.initiator)).not.toContain('url-secret')

  const networkSearchResult = await client.callTool({
    name: 'browser_network_search',
    arguments: { tabId, query: 'network-detail-42', maxRequests: 50, maxResults: 10 }
  }) as CallToolResult
  expect(networkSearchResult.isError, text(networkSearchResult)).not.toBe(true)
  const parsedNetworkSearch = JSON.parse(text(networkSearchResult))
  expect(parsedNetworkSearch).toMatchObject({
    query: 'network-detail-42',
    matches: expect.arrayContaining([expect.objectContaining({
      requestId: detailedRequest?.id,
      field: 'response-header',
      label: 'x-request-id',
      snippet: expect.stringContaining('network-detail-42')
    })])
  })
  expect(parsedNetworkSearch.matchingRequestCount).toBeGreaterThanOrEqual(1)
  expect(text(networkSearchResult)).not.toContain('request-secret')
  expect(text(networkSearchResult)).not.toContain('response-secret')
  expect(text(networkSearchResult)).not.toContain('url-secret')

  const networkCurlResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: detailedRequest?.id, copyAs: 'curl' }
  }) as CallToolResult
  expect(networkCurlResult.isError, text(networkCurlResult)).not.toBe(true)
  expect(text(networkCurlResult)).toContain("curl --request 'POST'")
  expect(text(networkCurlResult)).toContain("--header 'x-visible: request-kept'")
  expect(text(networkCurlResult)).toContain('"query": "diagnose-me"')
  expect(text(networkCurlResult)).toContain('Review before sharing or running.')
  expect(text(networkCurlResult)).toContain('arbitrary URL paths and body text can remain')
  expect(text(networkCurlResult)).not.toContain('Authorization:')
  expect(text(networkCurlResult)).not.toContain('x-api-key:')
  expect(text(networkCurlResult)).not.toContain('request-secret')
  expect(text(networkCurlResult)).not.toContain('url-secret')

  const networkFetchResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: detailedRequest?.id, copyAs: 'fetch' }
  }) as CallToolResult
  expect(networkFetchResult.isError, text(networkFetchResult)).not.toBe(true)
  expect(text(networkFetchResult)).toContain('fetch("http://127.0.0.1:')
  expect(text(networkFetchResult)).toContain('method: "POST"')
  expect(text(networkFetchResult)).toContain('"x-visible"')
  expect(text(networkFetchResult)).toContain('request-kept')
  expect(text(networkFetchResult)).not.toContain('request-secret')
  expect(text(networkFetchResult)).not.toContain('url-secret')

  const webSocketCurlResult = await client.callTool({
    name: 'browser_network_request',
    arguments: { tabId, requestId: webSocketRequest?.id, copyAs: 'curl' }
  }) as CallToolResult
  expect(webSocketCurlResult.isError, text(webSocketCurlResult)).toBe(true)
  expect(text(webSocketCurlResult)).toContain('only for HTTP(S) requests')

  const networkHarResult = await client.callTool({
    name: 'browser_network_har',
    arguments: {
      tabId,
      query: 'method:POST status-code:200 domain:127.0.0.1 url:api-details',
      resourceType: 'fetch/xhr',
      includeBodies: true,
      maxRequests: 10,
      maxBodyChars: 5_000
    }
  }) as CallToolResult
  expect(networkHarResult.isError, text(networkHarResult)).not.toBe(true)
  const networkHar = JSON.parse(text(networkHarResult))
  expect(networkHar).toMatchObject({
    log: {
      version: '1.2',
      creator: { name: 'Hronaut' },
      entries: expect.arrayContaining([expect.objectContaining({
        request: expect.objectContaining({ method: 'POST', cookies: [] }),
        response: expect.objectContaining({ status: 200, cookies: [] }),
        _hronaut: expect.objectContaining({
          resourceType: 'fetch',
          initiator: expect.objectContaining({ type: 'script' }),
          serverTiming: expect.arrayContaining([expect.objectContaining({ name: 'db', durationMs: 72.5 })])
        })
      })])
    },
    _hronaut: {
      tabId,
      sanitized: true,
      includesBodies: true,
      requestCount: expect.any(Number)
    }
  })
  expect(text(networkHarResult)).toContain('[REDACTED]')
  expect(text(networkHarResult)).not.toContain('url-secret')
  expect(text(networkHarResult)).not.toContain('request-secret')
  expect(text(networkHarResult)).not.toContain('response-secret')

  const savedNetworkHarResult = await client.callTool({
    name: 'browser_network_har',
    arguments: {
      tabId,
      query: 'method:POST status-code:200 domain:127.0.0.1 url:api-details',
      resourceType: 'fetch/xhr',
      maxRequests: 10,
      saveToDownloads: true,
      filename: 'fixture-network.har'
    }
  }) as CallToolResult
  expect(savedNetworkHarResult.isError, text(savedNetworkHarResult)).not.toBe(true)
  const savedNetworkHar = JSON.parse(text(savedNetworkHarResult))
  expect(savedNetworkHar).toMatchObject({
    filename: 'fixture-network.har',
    path: join(profileDirectory, 'fixture-network.har'),
    bytes: expect.any(Number),
    requestCount: expect.any(Number),
    sanitized: true,
    includesBodies: false
  })
  const savedNetworkHarText = await readFile(savedNetworkHar.path, 'utf8')
  expect(JSON.parse(savedNetworkHarText)).toMatchObject({
    log: { version: '1.2' },
    _hronaut: { tabId, sanitized: true, includesBodies: false }
  })
  expect(savedNetworkHarText).not.toContain('request-secret')
  expect(savedNetworkHarText).not.toContain('response-secret')

  await openPageTool('Open network monitor')
  const networkPanel = appWindow.getByRole('dialog', { name: 'Network' })
  await expect(networkPanel).toBeVisible()
  await expect(networkPanel.getByRole('combobox', { name: 'Dock network monitor' })).toHaveValue('right')
  const networkSort = networkPanel.getByRole('combobox', { name: 'Sort network requests' })
  await expect(networkSort).toHaveValue('start-time')
  await networkSort.selectOption('duration')
  await expect(networkPanel.getByRole('button', { name: 'Sort network requests descending' })).toBeVisible()
  await networkPanel.getByRole('button', { name: 'Search request content' }).click()
  const networkContentSearch = networkPanel.getByRole('region', { name: 'Search request content' })
  await expect(networkContentSearch).toBeVisible()
  await networkContentSearch.getByRole('searchbox', { name: 'Search headers, payloads, responses, WebSocket text, and event streams' }).fill('network-detail-42')
  await networkContentSearch.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(networkContentSearch).toContainText('matching fields')
  await expect(networkContentSearch.getByText('x-request-id', { exact: true }).first()).toBeVisible()
  await expect(networkContentSearch).not.toContainText('request-secret')
  await networkContentSearch.getByRole('button', { name: /Inspect matching request .*x-request-id/ }).first().click()
  await expect(networkPanel).toContainText('network-detail-42')
  await networkContentSearch.getByRole('button', { name: 'Close request content search' }).click()
  await expect(networkContentSearch).toHaveCount(0)
  await networkPanel.getByRole('searchbox', { name: 'Filter network requests' }).fill('/socket')
  const webSocketRow = networkPanel.locator(`[data-request-id="${String(webSocketRequest?.id)}"]`)
  await expect(webSocketRow).toBeVisible()
  await webSocketRow.click()
  await expect(networkPanel.locator('summary').filter({ hasText: 'Messages' })).toBeVisible()
  await expect(networkPanel.getByText('Connection closed', { exact: true })).toBeVisible()
  await expect(networkPanel).toContainText('client-kept')
  await expect(networkPanel).toContainText('server-kept')
  await expect(networkPanel).toContainText('echo-kept')
  await expect(networkPanel).toContainText('binary')
  await expect(networkPanel).not.toContainText('client-secret')
  await expect(networkPanel).not.toContainText('server-secret')
  await expect(networkPanel.getByRole('button', { name: 'Copy sanitized cURL' })).toHaveCount(0)
  await expect(networkPanel.getByRole('button', { name: 'Copy sanitized fetch' })).toHaveCount(0)
  await networkPanel.getByRole('searchbox', { name: 'Filter network requests' }).fill('/events')
  const eventSourceRow = networkPanel.locator(`[data-request-id="${String(eventSourceRequest?.id)}"]`)
  await expect(eventSourceRow).toBeVisible()
  await eventSourceRow.click()
  await expect(networkPanel.locator('summary').filter({ hasText: 'Event stream' })).toBeVisible()
  await expect(networkPanel).toContainText('progress')
  await expect(networkPanel).toContainText('event-2')
  await expect(networkPanel).toContainText('sse-kept')
  await expect(networkPanel).toContainText('progress-kept')
  await expect(networkPanel).not.toContainText('sse-secret')
  await networkPanel.getByRole('searchbox', { name: 'Filter network requests' }).fill('redirect-final')
  const redirectRow = networkPanel.locator(`[data-request-id="${String(redirectRequest?.id)}"]`)
  await expect(redirectRow).toBeVisible()
  await redirectRow.click()
  await expect(networkPanel.locator('summary').filter({ hasText: 'Request relationships' })).toBeVisible()
  await expect(networkPanel.getByText('3 retained hops', { exact: true })).toBeVisible()
  await expect(networkPanel).toContainText('redirect-start')
  await expect(networkPanel).toContainText('redirect-middle')
  await networkPanel.getByRole('button', { name: /Inspect redirect hop 1 redirect-start/ }).click()
  await expect(networkPanel.locator('.network-detail-url')).toContainText('/redirect-start')
  await expect(networkPanel.getByRole('searchbox', { name: 'Filter network requests' })).toHaveValue('')
  await networkPanel.getByRole('searchbox', { name: 'Filter network requests' })
    .fill('method:POST status-code:200 domain:127.0.0.1 larger-than:1 url:api-details')
  await expect(networkPanel.locator('.network-request-list > button').filter({ hasText: 'timing=delayed' })).toBeVisible()
  const apiRequest = networkPanel.locator(`[data-request-id="${String(detailedRequest?.id)}"]`)
  await expect(apiRequest).toBeVisible()
  const apiWaterfall = apiRequest.locator('.network-request-waterfall')
  await expect(apiWaterfall).toBeVisible()
  await expect(apiWaterfall).toHaveAttribute('role', 'img')
  await expect(apiWaterfall).toHaveAttribute('aria-label', /Started .*; .* total/)
  await expect(apiWaterfall.locator('i')).toHaveAttribute(
    'style',
    /--network-waterfall-left: [\d.]+%; --network-waterfall-width: [\d.]+%;/
  )
  await apiRequest.click()
  await expect(networkPanel.locator('summary').filter({ hasText: 'Initiator' })).toBeVisible()
  await expect(networkPanel.getByText('Script', { exact: true })).toBeVisible()
  await expect(networkPanel.locator('.network-timing-list').getByText('Waiting (TTFB)', { exact: true })).toBeVisible()
  await expect(networkPanel.getByText('Content download')).toBeVisible()
  await expect(networkPanel.getByText('Server timing', { exact: true })).toBeVisible()
  await expect(networkPanel.getByText('Primary, lookup token=[REDACTED]', { exact: true })).toBeVisible()
  await expect(networkPanel.getByText('72.5 ms', { exact: true })).toBeVisible()
  await expect(networkPanel).toContainText('request-kept')
  await expect(networkPanel).toContainText('network-detail-42')
  await expect(networkPanel).not.toContainText('request-secret')
  await networkPanel.getByRole('button', { name: 'Copy JSON' }).click()
  await expect(networkPanel.getByRole('button', { name: 'Copied JSON' })).toBeVisible()
  const copiedDetails = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedDetails)).toMatchObject({
    id: detailedRequest?.id,
    initiator: { type: 'script' },
    timing: { waitingForResponseMs: expect.any(Number) },
    response: { serverTiming: expect.arrayContaining([expect.objectContaining({ name: 'db', durationMs: 72.5 })]) }
  })
  expect(copiedDetails).not.toContain('request-secret')
  expect(copiedDetails).not.toContain('server-timing-secret')
  await networkPanel.getByRole('button', { name: 'Copy sanitized cURL' }).click()
  await expect(networkPanel.getByRole('button', { name: 'Copied cURL' })).toBeVisible()
  const copiedCurl = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(copiedCurl).toContain("curl --request 'POST'")
  expect(copiedCurl).toContain("--header 'x-visible: request-kept'")
  expect(copiedCurl).toContain('"query": "diagnose-me"')
  expect(copiedCurl).not.toContain('Authorization:')
  expect(copiedCurl).not.toContain('request-secret')
  expect(copiedCurl).not.toContain('url-secret')
  await networkPanel.getByRole('button', { name: 'Copy sanitized fetch' }).click()
  await expect(networkPanel.getByRole('button', { name: 'Copied fetch' })).toBeVisible()
  const copiedFetch = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(copiedFetch).toContain('fetch("http://127.0.0.1:')
  expect(copiedFetch).toContain('method: "POST"')
  expect(copiedFetch).toContain('request-kept')
  expect(copiedFetch).not.toContain('request-secret')
  expect(copiedFetch).not.toContain('url-secret')
  await networkPanel.getByRole('button', { name: 'Copy sanitized HAR' }).click()
  await expect(networkPanel.locator('footer').getByRole('button', { name: 'Copied' })).toBeVisible()
  const copiedHar = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedHar)).toMatchObject({
    log: { version: '1.2' },
    _hronaut: { tabId, sanitized: true, includesBodies: false }
  })
  expect(copiedHar).not.toContain('request-secret')
  await networkPanel.getByRole('button', { name: 'Save sanitized HAR' }).click()
  const savedHarButton = networkPanel.locator('footer').getByRole('button', { name: 'Saved' })
  await expect(savedHarButton).toBeVisible()
  const savedHarPath = await savedHarButton.getAttribute('title')
  expect(savedHarPath).toBeTruthy()
  const savedHarText = await readFile(savedHarPath!, 'utf8')
  expect(JSON.parse(savedHarText)).toMatchObject({
    log: { version: '1.2' },
    _hronaut: { tabId, sanitized: true, includesBodies: false }
  })
  expect(savedHarText).not.toContain('request-secret')
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const ukrainianNetworkPanel = appWindow.getByRole('dialog', { name: 'Мережа' })
  await expect(ukrainianNetworkPanel.getByRole('searchbox', { name: 'Фільтрувати мережеві запити' }))
    .toHaveValue('method:POST status-code:200 domain:127.0.0.1 larger-than:1 url:api-details')
  await expect(ukrainianNetworkPanel).toContainText('Часові показники сервера')
  await expect(ukrainianNetworkPanel).toContainText('request-kept')
  await ukrainianNetworkPanel.getByRole('button', { name: 'Закрити монітор мережі' }).click()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "console.error('first-tab-console-only')" }
  })
  await openPageTool('Open Console')
  const isolatedConsolePanel = appWindow.getByRole('dialog', { name: 'Console' })
  await expect(isolatedConsolePanel).toContainText('first-tab-console-only')
  const diagnosticsIsolationTabResult = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
  }) as CallToolResult
  expect(diagnosticsIsolationTabResult.isError, text(diagnosticsIsolationTabResult)).not.toBe(true)
  const diagnosticsIsolationTabId = JSON.parse(text(diagnosticsIsolationTabResult)).activeTabId as string
  await client.callTool({ name: 'browser_wait', arguments: { tabId: diagnosticsIsolationTabId } })
  await expect(isolatedConsolePanel).toBeHidden()
  await openPageTool('Open Console')
  await expect(isolatedConsolePanel).not.toContainText('first-tab-console-only')
  await isolatedConsolePanel.getByRole('button', { name: 'Close Console' }).click()

  await openPageTool('Open network monitor')
  expect(await networkPanel.getByText('network-detail-42', { exact: true }).count()).toBe(0)
  await expect(networkPanel).not.toContainText('network-detail-42')
  await networkPanel.getByRole('button', { name: 'Close network monitor' }).click()
  await client.callTool({ name: 'browser_close_tab', arguments: { tabId: diagnosticsIsolationTabId } })
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

  // Seed a failed response for the debug report independently of the routing case.
  await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'add', tabId, urlPattern: `${fixtureOrigin}/route-target`, times: 1,
      response: { status: 503, body: '{"source":"debug-report"}' } }
  })
  await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: "fetch('/route-target').then(response => response.text())" } })

  const debugReportResult = await client.callTool({
    name: 'browser_debug_report',
    arguments: { tabId, maxConsoleMessages: 20, maxNetworkRequests: 20 }
  }) as CallToolResult
  expect(debugReportResult.isError, text(debugReportResult)).not.toBe(true)
  const debugReport = JSON.parse(text(debugReportResult))
  expect(debugReport).toMatchObject({
    tabId,
    summary: {
      consoleErrors: expect.any(Number),
      networkRequests: expect.any(Number),
      failedRequests: expect.any(Number)
    },
    networkRouteCount: 0
  })
  expect(debugReport.summary.consoleErrors).toBeGreaterThan(0)
  expect(debugReport.summary.failedRequests).toBeGreaterThan(0)
  expect(debugReport.console).toEqual(expect.arrayContaining([
    expect.objectContaining({ level: 'error', message: 'hronaut-console-marker' })
  ]))
  expect(debugReport.network).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 503, issue: true })
  ]))
  expect(text(debugReportResult)).not.toContain('url-secret')
  expect(text(debugReportResult)).not.toContain('request-secret')
  expect(text(debugReportResult)).not.toContain('response-secret')

  await openPageTool('Create debug report')
  const debugReportPanel = appWindow.getByRole('dialog', { name: 'Debug report' })
  await expect(debugReportPanel).toBeVisible()
  await expect(debugReportPanel).toContainText('hronaut-console-marker')
  await expect(debugReportPanel).toContainText('failed requests')
  await debugReportPanel.getByRole('button', { name: 'Copy report' }).click()
  await expect(debugReportPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copiedDebugReport = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedDebugReport)).toMatchObject({ tabId, summary: { failedRequests: expect.any(Number) } })
  expect(copiedDebugReport).not.toContain('url-secret')
  await debugReportPanel.getByRole('button', { name: 'Close debug report' }).click()
})
