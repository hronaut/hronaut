import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('uses bounded canvas coordinates and keeps horizontal scrolling horizontal', async ({
  mcpToken,
  mcpPort
}) => {
  const client = new Client({ name: 'hronaut-coordinate-click-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })

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
    await client.connect(transport)
    await useMcpWorkspace(client, 'Coordinate click tests')
    const tools = await client.listTools()
    expect(tools.tools.find((tool) => tool.name === 'browser_click')?.description).toContain('viewport coordinates')
    expect(tools.tools.find((tool) => tool.name === 'browser_hover')?.description).toContain('viewport coordinates')
    const html = `<!doctype html><title>Coordinate click fixture</title>
      <canvas id="surface" width="240" height="120" style="display:block;width:240px;height:120px;border:1px solid black"></canvas>
      <div id="scrollbox" style="width:120px;height:60px;overflow:auto"><div style="width:400px;height:300px"></div></div>
      <p>Canvas target ready</p>
      <script>
        const surface = document.querySelector('#surface');
        const record = (event) => {
          const rect = surface.getBoundingClientRect();
          surface.dataset.lastPointer = JSON.stringify({
            type: event.type,
            x: Math.round(event.clientX - rect.left),
            y: Math.round(event.clientY - rect.top)
          });
          if (['mousedown', 'mousemove', 'mouseup'].includes(event.type)) {
            const sequence = JSON.parse(surface.dataset.pointerSequence || '[]');
            sequence.push(event.type);
            surface.dataset.pointerSequence = JSON.stringify(sequence);
          }
          if (event.type === 'click' && event.clientX - rect.left > 180) {
            surface.dataset.dialogResult = String(confirm('Coordinate confirm'));
          }
        };
        surface.addEventListener('click', record);
        surface.addEventListener('dblclick', record);
        surface.addEventListener('mousedown', record);
        surface.addEventListener('mousemove', record);
        surface.addEventListener('mouseup', record);
      </script>`
    const created = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `data:text/html,${encodeURIComponent(html)}`, active: true }
    }) as CallToolResult
    expect(created.isError, text(created)).not.toBe(true)
    const tabId = JSON.parse(text(created)).activeTabId as string
    await client.callTool({
      name: 'browser_wait',
      arguments: { tabId, text: 'Canvas target ready' }
    })

    const pointResult = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(() => {
          const rect = document.querySelector('#surface').getBoundingClientRect();
          return { x: rect.left + 73, y: rect.top + 41, width: innerWidth, height: innerHeight };
        })()`
      }
    }) as CallToolResult
    const point = JSON.parse(text(pointResult)) as { x: number; y: number; width: number; height: number }

    const hovered = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, x: point.x + 20, y: point.y + 10 }
    }) as CallToolResult
    expect(hovered.isError, text(hovered)).not.toBe(true)
    expect(JSON.parse(text(hovered))).toMatchObject({ ok: true, x: point.x + 20, y: point.y + 10 })
    const hoverState = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#surface').dataset.lastPointer" }
    }) as CallToolResult
    expect(JSON.parse(text(hoverState))).toEqual({ type: 'mousemove', x: 93, y: 51 })

    const horizontalScroll = await client.callTool({
      name: 'browser_scroll',
      arguments: { tabId, selector: '#scrollbox', deltaX: 80 }
    }) as CallToolResult
    expect(horizontalScroll.isError, text(horizontalScroll)).not.toBe(true)
    expect(JSON.parse(text(horizontalScroll))).toEqual({ x: 80, y: 0 })

    await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#surface').dataset.pointerSequence = '[]'" }
    })
    const dragged = await client.callTool({
      name: 'browser_drag',
      arguments: {
        tabId,
        startX: point.x - 43,
        startY: point.y - 21,
        endX: point.x + 87,
        endY: point.y + 29
      }
    }) as CallToolResult
    expect(dragged.isError, text(dragged)).not.toBe(true)
    expect(JSON.parse(text(dragged))).toMatchObject({
      ok: true,
      from: { x: point.x - 43, y: point.y - 21 },
      to: { x: point.x + 87, y: point.y + 29 }
    })
    const dragState = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#surface').dataset.pointerSequence" }
    }) as CallToolResult
    expect(JSON.parse(text(dragState))).toEqual([
      'mousemove',
      'mousedown',
      'mousemove',
      'mousemove',
      'mousemove',
      'mousemove',
      'mousemove',
      'mousemove',
      'mousemove',
      'mousemove',
      'mouseup'
    ])

    expect(tools.tools.find((tool) => tool.name === 'browser_drag')?.description).toContain('viewport coordinates')

    const clicked = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, x: point.x, y: point.y }
    }) as CallToolResult
    expect(clicked.isError, text(clicked)).not.toBe(true)
    expect(JSON.parse(text(clicked))).toMatchObject({ ok: true, x: point.x, y: point.y })
    const singleState = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#surface').dataset.lastPointer" }
    }) as CallToolResult
    expect(JSON.parse(text(singleState))).toEqual({ type: 'click', x: 73, y: 41 })

    const doubleClicked = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, x: point.x + 12, y: point.y + 9, doubleClick: true }
    }) as CallToolResult
    expect(doubleClicked.isError, text(doubleClicked)).not.toBe(true)
    expect(JSON.parse(text(doubleClicked))).toMatchObject({
      ok: true,
      x: point.x + 12,
      y: point.y + 9,
      doubleClick: true
    })
    const doubleState = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#surface').dataset.lastPointer" }
    }) as CallToolResult
    expect(JSON.parse(text(doubleState))).toEqual({ type: 'dblclick', x: 85, y: 50 })

    const dialogClicked = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, x: point.x + 127, y: point.y + 19, dialogAction: 'dismiss' }
    }) as CallToolResult
    expect(dialogClicked.isError, text(dialogClicked)).not.toBe(true)
    const dialogState = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#surface').dataset.dialogResult" }
    }) as CallToolResult
    expect(text(dialogState)).toBe('false')

    const incomplete = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, x: point.x }
    }) as CallToolResult
    expect(incomplete.isError).toBe(true)
    expect(text(incomplete)).toContain('Provide both x and y')

    const ambiguous = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#surface', x: point.x, y: point.y }
    }) as CallToolResult
    expect(ambiguous.isError).toBe(true)
    expect(text(ambiguous)).toContain('Provide a target or coordinates, not both')

    const offscreen = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, x: point.width, y: point.height }
    }) as CallToolResult
    expect(offscreen.isError).toBe(true)
    expect(text(offscreen)).toContain('inside the visible viewport')

    const incompleteHover = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, x: point.x }
    }) as CallToolResult
    expect(incompleteHover.isError).toBe(true)
    expect(text(incompleteHover)).toContain('Provide both x and y')

    const ambiguousHover = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, selector: '#surface', x: point.x, y: point.y }
    }) as CallToolResult
    expect(ambiguousHover.isError).toBe(true)
    expect(text(ambiguousHover)).toContain('Provide a target or coordinates, not both')

    const offscreenHover = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, x: point.width, y: point.height }
    }) as CallToolResult
    expect(offscreenHover.isError).toBe(true)
    expect(text(offscreenHover)).toContain('inside the visible viewport')

    const incompleteDrag = await client.callTool({
      name: 'browser_drag',
      arguments: { tabId, startX: point.x, startY: point.y, endX: point.x + 10 }
    }) as CallToolResult
    expect(incompleteDrag.isError).toBe(true)
    expect(text(incompleteDrag)).toContain('Provide all four drag coordinates')

    const ambiguousDrag = await client.callTool({
      name: 'browser_drag',
      arguments: {
        tabId,
        sourceSelector: '#surface',
        targetSelector: '#scrollbox',
        startX: point.x,
        startY: point.y,
        endX: point.x + 10,
        endY: point.y + 10
      }
    }) as CallToolResult
    expect(ambiguousDrag.isError).toBe(true)
    expect(text(ambiguousDrag)).toContain('Provide element targets or drag coordinates, not both')

    const offscreenDrag = await client.callTool({
      name: 'browser_drag',
      arguments: {
        tabId,
        startX: point.x,
        startY: point.y,
        endX: point.width,
        endY: point.height
      }
    }) as CallToolResult
    expect(offscreenDrag.isError).toBe(true)
    expect(text(offscreenDrag)).toContain('inside the visible viewport')
  } finally {
    await client.close().catch(() => undefined)
  }
})
