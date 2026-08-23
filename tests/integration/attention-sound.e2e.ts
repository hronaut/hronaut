import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('previews and plays the selected Foley cue for user attention', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const authorization = `Bearer ${mcpToken}`
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    })
    .toBe(true)

  await appWindow.evaluate(`(() => {
    const audioContext = window.AudioContext
    const originalCreateOscillator = audioContext.prototype.createOscillator
    Object.defineProperty(window, '__hronautFoleyOscillators', { value: 0, writable: true })
    audioContext.prototype.createOscillator = function () {
      window.__hronautFoleyOscillators += 1
      return originalCreateOscillator.call(this)
    }
  })()`)
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('combobox', { name: 'Attention sound' }).selectOption('bell')
  await appWindow.getByRole('button', { name: 'Test sound' }).click()
  await expect.poll(() => appWindow.evaluate('window.__hronautFoleyOscillators')).toBeGreaterThan(0)
  const previewOscillators = await appWindow.evaluate('window.__hronautFoleyOscillators') as number
  await appWindow.waitForTimeout(100)

  const client = new Client({ name: 'hronaut-attention-sound-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    await client.connect(transport)
    await useMcpWorkspace(client, 'Attention sound tests')
    await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please complete this manual step.' }
    })
    await expect.poll(() => appWindow.evaluate('window.__hronautFoleyOscillators')).toBeGreaterThan(previewOscillators)
  } finally {
    await client.close()
  }
})

test('clears tab-scoped user attention when the requested tab closes', async ({
  mcpPort,
  mcpToken
}) => {
  const authorization = `Bearer ${mcpToken}`
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    })
    .toBe(true)

  const client = new Client({ name: 'hronaut-attention-lifecycle-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    await client.connect(transport)
    await useMcpWorkspace(client, 'Attention lifecycle tests')
    const initialStatus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    const requestedTabId = JSON.parse(text(initialStatus)).activeTabId as string

    await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please review this expiring tab.', tabId: requestedTabId }
    })
    const requestedStatus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(requestedStatus)).userAttention).toMatchObject({ tabId: requestedTabId })

    await client.callTool({ name: 'browser_close_tab', arguments: { tabId: requestedTabId } })
    await expect.poll(async () => {
      const status = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
      return JSON.parse(text(status)).userAttention
    }).toBeNull()
  } finally {
    await client.close()
  }
})
