import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserReproRecording, BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reviews reproduction steps with keyboard navigation and resets selection for a new recording', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html lang="en"><title>Repro timeline fixture</title><main><button id="save">Save</button></main></html>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Repro timeline fixture did not expose a port')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'repro-timeline-navigation', version: '1' })
  const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> => (
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  )
  const decode = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', {
      action: 'create', storage: 'scratch', name: 'Repro timeline navigation'
    }))
    const state = decode<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: origin }))
    const tabId = state.activeTabId!
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)'))
      .toBe('Repro timeline fixture')

    decode<BrowserReproRecording>(await call('browser_repro', {
      workspaceId: workspace.id, tabId, action: 'start'
    }))
    await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      const view = BrowserWindow.getAllWindows()
        .flatMap(window => window.contentView.children)
        .find((candidate): candidate is InstanceType<typeof WebContentsView> => (
          candidate instanceof WebContentsView && candidate.webContents.getTitle() === 'Repro timeline fixture'
        ))
      if (!view) throw new Error('Repro timeline fixture view was not found')
      const point = await view.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#save').getBoundingClientRect();
        return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
      })()`) as { x: number; y: number }
      view.webContents.focus()
      view.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      view.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    })
    await expect.poll(async () => decode<BrowserReproRecording>(await call('browser_repro', {
      workspaceId: workspace.id, tabId, action: 'get'
    })).stepCount).toBe(2)
    const stopped = decode<BrowserReproRecording>(await call('browser_repro', {
      workspaceId: workspace.id, tabId, action: 'stop'
    }))
    expect(stopped.stepCount).toBe(2)
    expect(stopped.steps.map(step => step.kind)).toEqual(['navigate', 'click'])

    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /Repro recorder:/ }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Repro recorder' })
    const timeline = panel.getByRole('listbox', { name: 'Recorded reproduction steps' })
    const options = timeline.getByRole('option')
    await expect(options).toHaveCount(stopped.stepCount)
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    await options.first().press('End')
    await expect(options.last()).toBeFocused()
    await expect(options.last()).toHaveAttribute('aria-selected', 'true')
    const detail = panel.getByRole('region', { name: 'Selected reproduction step' })
    await expect(detail).toContainText(`Step ${stopped.stepCount}`)
    const clickStep = stopped.steps.find(step => step.kind === 'click' && step.target)
    expect(clickStep).toBeDefined()
    await options.nth(clickStep!.index - 1).click()
    await expect(detail).toContainText(clickStep!.target!.selector)

    await panel.getByRole('button', { name: 'Record again' }).click()
    await expect(timeline.getByRole('option')).toHaveCount(1)
    await expect(timeline.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    await expect(detail).toContainText('Step 1')
    await panel.getByRole('button', { name: 'Stop' }).click()
    await panel.getByRole('button', { name: 'Clear' }).click()
    await expect(panel).toContainText('Show the issue once')
    await expect(panel.getByRole('listbox', { name: 'Recorded reproduction steps' })).toHaveCount(0)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
