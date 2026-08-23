import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function connectClient(port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { authorization: `Bearer ${token}` }
      })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'network-replay-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

test('replays retained XHRs for people and agents with explicit side-effect confirmation', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  let getCount = 0
  let postCount = 0
  const postBodies: string[] = []
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/xhr-get')) {
      getCount += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ count: getCount }))
      return
    }
    if (request.url === '/xhr-post') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        postCount += 1
        postBodies.push(body)
        response.writeHead(201, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ count: postCount }))
      })
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><head><title>XHR replay fixture</title></head><body>
      <h1>XHR replay fixture</h1>
      <script>
        window.sendReplayXhr = (method) => new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const url = method === 'GET'
            ? '/xhr-get?token=replay-secret-query&view=visible'
            : '/xhr-post';
          xhr.open(method, url);
          xhr.setRequestHeader('x-auth-token', 'replay-secret-header');
          if (method !== 'GET') xhr.setRequestHeader('content-type', 'application/json');
          xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
          xhr.onerror = () => reject(new Error('XHR failed'));
          xhr.send(method === 'GET' ? null : JSON.stringify({ visible: 'kept', accessToken: 'replay-secret-body' }));
        });
      </script>
    </body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const client = await connectClient(mcpPort, mcpToken)
  try {
    const tools = await client.listTools()
    expect(tools.tools.find((tool) => tool.name === 'browser_network_replay')?.description).toContain('confirmSideEffects: true')

    const groupResult = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'XHR replay' }
    }) as CallToolResult
    const workspaceId = (JSON.parse(text(groupResult)) as { id: string }).id
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: `http://127.0.0.1:${address.port}/` }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId } })
    const armedNetwork = await client.callTool({
      name: 'browser_network',
      arguments: { workspaceId, tabId }
    }) as CallToolResult
    expect(armedNetwork.isError, text(armedNetwork)).not.toBe(true)

    const getSent = await client.callTool({
      name: 'browser_evaluate',
      arguments: { workspaceId, tabId, script: "window.sendReplayXhr('GET')" }
    }) as CallToolResult
    expect(getSent.isError, text(getSent)).not.toBe(true)
    let getRequestId = ''
    await expect.poll(async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { workspaceId, tabId } }) as CallToolResult
      const requests = JSON.parse(text(result)) as Array<{ id: string; url: string; resourceType: string }>
      getRequestId = requests.find((request) => request.resourceType === 'xhr' && request.url.includes('/xhr-get'))?.id ?? ''
      return getRequestId
    }).not.toBe('')

    const replayedGet = await client.callTool({
      name: 'browser_network_replay',
      arguments: { workspaceId, tabId, requestId: getRequestId }
    }) as CallToolResult
    expect(replayedGet.isError, text(replayedGet)).not.toBe(true)
    const getReplayResult = JSON.parse(text(replayedGet)) as {
      originalRequestId: string
      confirmationRequired: boolean
      replayedRequest: { id: string; resourceType: string }
    }
    expect(getReplayResult).toMatchObject({
      originalRequestId: getRequestId,
      confirmationRequired: false,
      replayedRequest: { resourceType: 'xhr' }
    })
    expect(getReplayResult.replayedRequest.id).not.toBe(getRequestId)
    expect(getCount).toBe(2)
    expect(text(replayedGet)).not.toContain('replay-secret-query')
    expect(text(replayedGet)).not.toContain('replay-secret-header')

    await client.callTool({
      name: 'browser_evaluate',
      arguments: { workspaceId, tabId, script: "fetch('/xhr-get?view=fetch-only').then((response) => response.status)" }
    })
    let fetchRequestId = ''
    await expect.poll(async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { workspaceId, tabId } }) as CallToolResult
      const requests = JSON.parse(text(result)) as Array<{ id: string; url: string; resourceType: string }>
      fetchRequestId = [...requests].reverse().find((request) => (
        request.resourceType === 'fetch' && request.url.includes('view=fetch-only')
      ))?.id ?? ''
      return fetchRequestId
    }).not.toBe('')
    const rejectedFetch = await client.callTool({
      name: 'browser_network_replay',
      arguments: { workspaceId, tabId, requestId: fetchRequestId }
    }) as CallToolResult
    expect(rejectedFetch.isError).toBe(true)
    expect(text(rejectedFetch)).toContain('Only captured XMLHttpRequest')

    const postSent = await client.callTool({
      name: 'browser_evaluate',
      arguments: { workspaceId, tabId, script: "window.sendReplayXhr('POST')" }
    }) as CallToolResult
    expect(postSent.isError, text(postSent)).not.toBe(true)
    let postRequestId = ''
    await expect.poll(async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { workspaceId, tabId } }) as CallToolResult
      const requests = JSON.parse(text(result)) as Array<{ id: string; url: string; method: string; resourceType: string }>
      postRequestId = [...requests].reverse().find((request) => (
        request.resourceType === 'xhr' && request.method === 'POST' && request.url.endsWith('/xhr-post')
      ))?.id ?? ''
      return postRequestId
    }).not.toBe('')

    const rejectedPost = await client.callTool({
      name: 'browser_network_replay',
      arguments: { workspaceId, tabId, requestId: postRequestId }
    }) as CallToolResult
    expect(rejectedPost.isError).toBe(true)
    expect(text(rejectedPost)).toContain('confirmSideEffects: true')
    expect(postCount).toBe(1)

    const replayedPost = await client.callTool({
      name: 'browser_network_replay',
      arguments: { workspaceId, tabId, requestId: postRequestId, confirmSideEffects: true }
    }) as CallToolResult
    expect(replayedPost.isError, text(replayedPost)).not.toBe(true)
    expect(JSON.parse(text(replayedPost))).toMatchObject({
      originalRequestId: postRequestId,
      confirmationRequired: true,
      confirmationAccepted: true,
      replayedRequest: { resourceType: 'xhr', method: 'POST' }
    })
    expect(postCount).toBe(2)
    expect(postBodies).toEqual([
      '{"visible":"kept","accessToken":"replay-secret-body"}',
      '{"visible":"kept","accessToken":"replay-secret-body"}'
    ])
    expect(text(replayedPost)).not.toContain('replay-secret-body')

    await client.callTool({
      name: 'browser_evaluate',
      arguments: { workspaceId, tabId, script: "window.sendReplayXhr('POST')" }
    })
    await expect.poll(() => postCount).toBe(3)
    const latestNetwork = await client.callTool({
      name: 'browser_network',
      arguments: { workspaceId, tabId }
    }) as CallToolResult
    const latestPost = [...JSON.parse(text(latestNetwork)) as Array<{ id: string; url: string; method: string; resourceType: string }>]
      .reverse()
      .find((request) => request.resourceType === 'xhr' && request.method === 'POST' && request.url.endsWith('/xhr-post'))
    if (!latestPost) throw new Error('Latest POST XHR was not captured')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: 'Open network monitor' }).click()
    const networkPanel = appWindow.getByRole('dialog', { name: 'Network' })
    await expect(networkPanel).toBeVisible()
    await networkPanel.getByRole('button', { name: 'Refresh network requests' }).click()
    await networkPanel.locator(`[data-request-id="${latestPost.id}"]`).click()
    const replayButton = networkPanel.getByRole('button', { name: 'Replay XHR' })
    await expect(replayButton).toBeVisible()
    await replayButton.click()
    await expect(networkPanel.getByRole('button', { name: 'Confirm replay POST' })).toBeVisible()
    await expect(networkPanel).toContainText('can repeat writes or other side effects')
    expect(postCount).toBe(3)
    await networkPanel.getByRole('button', { name: 'Confirm replay POST' }).click()
    await expect.poll(() => postCount).toBe(4)
    await expect(networkPanel).toContainText('The new request is selected for inspection')
    await expect(networkPanel.getByRole('button', { name: 'Replayed XHR' })).toBeVisible()
  } finally {
    await client.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
