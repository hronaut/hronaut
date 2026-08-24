import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { BROWSER_TOOL_CATALOG } from '../../src/main/mcp/server.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

function webSocketServerFrame(payload: string | Buffer, opcode = 1): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  const header = data.length < 126
    ? Buffer.from([0x80 | opcode, data.length])
    : Buffer.from([0x80 | opcode, 126, (data.length >> 8) & 0xff, data.length & 0xff])
  return Buffer.concat([header, data])
}

function readWebSocketClientText(frame: Buffer): string | undefined {
  if (frame.length < 6 || (frame.readUInt8(0) & 0x0f) !== 1 || (frame.readUInt8(1) & 0x80) === 0) return undefined
  let payloadLength = frame.readUInt8(1) & 0x7f
  let offset = 2
  if (payloadLength === 126) {
    if (frame.length < 8) return undefined
    payloadLength = frame.readUInt16BE(offset)
    offset += 2
  }
  if (payloadLength === 127 || frame.length < offset + 4 + payloadLength) return undefined
  const mask = frame.subarray(offset, offset + 4)
  offset += 4
  const payload = Buffer.alloc(payloadLength)
  for (let index = 0; index < payloadLength; index += 1) {
    payload.writeUInt8(frame.readUInt8(offset + index) ^ mask.readUInt8(index % 4), index)
  }
  return payload.toString('utf8')
}

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('exposes production interaction and diagnostics capabilities over MCP', async ({
  electronApp,
  appWindow,
  mcpToken,
  mcpPort,
  profileDirectory
}) => {
  let memorySaverTicks = 0
  let cacheProbeRequests = 0
  const openPageTool = async (name: string | RegExp): Promise<void> => {
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(pageTools).toBeVisible()
    await pageTools.getByRole('button', { name }).click()
  }
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/cpu-profile.js')) {
      response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
      response.end(`
        window.runCpuProfileProbe = function cpuProfileBusyLoop() {
          const deadline = performance.now() + 120;
          let checksum = 0;
          while (performance.now() < deadline) checksum = (checksum + Math.sqrt(checksum + 17)) % 1000003;
          return checksum;
        };
      `)
      return
    }
    if (request.url === '/headers') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        marker: request.headers['x-hronaut-test'] ?? null,
        language: request.headers['accept-language'] ?? null
      }))
      return
    }
    if (request.url === '/api') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
      return
    }
    if (request.url?.startsWith('/cache-probe')) {
      cacheProbeRequests += 1
      response.writeHead(200, {
        'cache-control': 'public, max-age=3600',
        'content-type': 'application/json'
      })
      response.end(JSON.stringify({ requestCount: cacheProbeRequests }))
      return
    }
    if (request.url === '/sw.js') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/javascript; charset=utf-8',
        'service-worker-allowed': '/'
      })
      response.end(`
        self.addEventListener('install', (event) => {
          event.waitUntil(caches.open('hronaut-capability-cache').then((cache) => cache.put(
            '/sw-probe',
            new Response(JSON.stringify({ source: 'service-worker' }), {
              headers: { 'content-type': 'application/json' }
            })
          )).then(() => self.skipWaiting()));
        });
        self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', (event) => {
          if (new URL(event.request.url).pathname !== '/sw-probe') return;
          event.respondWith(caches.match(event.request));
        });
      `)
      return
    }
    if (request.url === '/sw-probe') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"source":"network"}')
      return
    }
    if (request.url?.startsWith('/wait-probe')) {
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ accepted: true, url: request.url }))
      return
    }
    if (request.url === '/events') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive'
      })
      response.write(`data: ${JSON.stringify({ state: 'ready', accessToken: 'sse-secret', visible: 'sse-kept' })}\n\n`)
      setTimeout(() => {
        response.write('event: progress\n')
        response.write('id: event-2\n')
        response.end(`data: ${JSON.stringify({ state: 'complete', password: 'sse-secret', visible: 'progress-kept' })}\n\n`)
      }, 50)
      return
    }
    if (request.url?.startsWith('/redirect-start')) {
      response.writeHead(302, {
        location: '/redirect-middle?access_token=redirect-middle-secret&view=middle'
      })
      response.end()
      return
    }
    if (request.url?.startsWith('/redirect-middle')) {
      response.writeHead(307, {
        location: '/redirect-final?password=redirect-final-secret&view=final'
      })
      response.end()
      return
    }
    if (request.url?.startsWith('/redirect-final')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"redirected":true,"visible":"redirect-kept"}')
      return
    }
    if (request.url === '/no-js') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>Static fallback</title></head><body>
        <main><h1 id="runtime-state">Static fallback</h1><noscript>JavaScript is unavailable</noscript></main>
        <script>document.title = 'Enhanced page'; document.querySelector('#runtime-state').textContent = 'JavaScript enhanced';</script>
      </body></html>`)
      return
    }
    if (request.url === '/memory-saver-tick') {
      memorySaverTicks += 1
      response.writeHead(204)
      response.end()
      return
    }
    if (request.url === '/route-target') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"source":"real"}')
      return
    }
    if (request.url?.startsWith('/api-details')) {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        const finish = (): void => {
          response.writeHead(200, {
            'content-type': 'application/json',
            'x-request-id': 'network-detail-42',
            'x-auth-token': 'response-secret',
            'server-timing': 'db;dur=72.5;desc="Primary, lookup token=server-timing-secret", cache;desc="Miss; cold", app;dur=36.2'
          })
          response.end(JSON.stringify({
            ok: true,
            receivedQuery: JSON.parse(body).query,
            accessToken: 'response-secret',
            visible: 'response-kept'
          }))
        }
        if (request.url?.includes('timing=delayed')) setTimeout(finish, 120)
        else finish()
      })
      return
    }
    if (request.url === '/download') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="capability.txt"'
      })
      response.end('Hronaut download fixture')
      return
    }
    if (request.url === '/http-only-cookie') {
      response.writeHead(204, {
        'set-cookie': 'hronaut-protected=server-secret; HttpOnly; SameSite=Lax; Path=/'
      })
      response.end()
      return
    }
    if (request.url === '/issues') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<title>Browser issues fixture</title><main>Intentionally missing a doctype.</main>')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Capability fixture</title>
      <meta name="description" content="Capability metadata description">
      <meta name="csrf-token" content="page-metadata-secret-meta">
      <link rel="canonical" href="/canonical?token=page-metadata-secret-url&view=metadata">
      <link rel="alternate" hreflang="uk" href="/uk?view=metadata">
      <link rel="icon" href="/favicon.png?token=page-metadata-secret-icon">
      <meta property="og:title" content="Capability social title">
      <meta property="og:type" content="website">
      <meta property="og:url" content="/canonical?token=page-metadata-secret-og-url">
      <meta property="og:image" content="/social.png?token=page-metadata-secret-image">
      <meta property="og:image:alt" content="Capability social image">
      <meta property="og:description" content="Capability social description">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Capability Twitter title">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":["WebPage","SoftwareApplication"],"name":"page-metadata-secret-structured-value"}</script>
      <style>
        body { color: rgb(34, 34, 34); background: rgb(250, 250, 250); font: 16px/1.5 sans-serif; }
        .contrast-probe { color: rgb(125, 125, 125); background: rgb(135, 135, 135); }
        #animation-probe { width: 20px; height: 20px; background: rebeccapurple; animation: hronaut-probe 60s linear infinite; }
        @keyframes hronaut-probe { from { transform: translateX(0); } to { transform: translateX(200px); } }
        @media (max-width: 900px) { .contrast-probe { font-weight: 700; } }
      </style>
      </head><body>
      <h1>Capability test page</h1>
      <p class="contrast-probe">design-overview-secret-body-copy</p>
      <input id="name" aria-label="Name">
      <input id="agree" aria-label="Agree" type="checkbox">
      <select id="choice" aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select>
      <button id="hover" onmouseenter="this.dataset.hovered='true'">Hover target</button>
      <button id="alert" onclick="alert('Agent alert'); this.dataset.result='continued'">Open alert</button>
      <button id="prompt" onclick="this.dataset.result=prompt('Agent prompt', 'default')">Open prompt</button>
      <button id="double-click" onclick="this.dataset.clicks=String(Number(this.dataset.clicks || 0) + 1)" ondblclick="this.dataset.doubleClicks=String(Number(this.dataset.doubleClicks || 0) + 1)">Double-click target</button>
      <button id="throw" onclick="window.runConsoleExceptionProbe()">Throw error</button>
      <section id="audit-scope"><button id="unnamed-button"></button></section>
      <div id="drag" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', 'dragged')">Drag me</div>
      <div id="drop" ondragover="event.preventDefault()" ondrop="event.preventDefault(); this.textContent=event.dataTransfer.getData('text/plain')">Drop here</div>
      <input id="upload" aria-label="Upload" type="file">
      <a id="download" href="/download" download="capability.txt">Download</a>
      <div id="animation-probe" aria-label="Animation probe"></div>
      <div style="height:2200px">Tall page</div>
      <button id="capture-target" value="element-inspection-secret" style="box-sizing:border-box;width:240px;height:120px;background:rgb(103,87,232);color:rgb(255,255,255)">Capture this area</button>
      <script src="/cpu-profile.js?token=cpu-profile-secret"></script>
      <script>
        window.hronautKeyboardEvents = [];
        for (const eventName of ['keydown', 'keyup']) {
          window.addEventListener(eventName, (event) => {
            window.hronautKeyboardEvents.push({
              type: event.type,
              key: event.key,
              control: event.ctrlKey,
              shift: event.shiftKey,
              alt: event.altKey,
              meta: event.metaKey
            });
          });
        }
        localStorage.setItem('hronaut-mcp-site-data', 'stored');
        document.cookie = 'hronaut-mcp-site-data=stored; SameSite=Lax';
        console.error('hronaut-console-marker');
        fetch('/api');
        fetch('/api-details?token=url-secret&view=compact', {
          method: 'POST',
          headers: {
            'authorization': 'Bearer request-secret',
            'content-type': 'application/json',
            'x-api-key': 'request-secret',
            'x-visible': 'request-kept'
          },
          body: JSON.stringify({ query: 'diagnose-me', password: 'request-secret' })
        });
        window.runDelayedNetworkProbe = () => fetch('/api-details?token=url-secret&view=compact&timing=delayed', {
          method: 'POST',
          headers: {
            'authorization': 'Bearer request-secret',
            'content-type': 'application/json',
            'x-api-key': 'request-secret',
            'x-visible': 'request-kept'
          },
          body: JSON.stringify({ query: 'diagnose-me', password: 'request-secret' })
        }).then((response) => response.json());
        window.runRedirectProbe = () => fetch('/redirect-start?token=redirect-start-secret&view=start')
          .then((response) => response.json());
        window.runNetworkWaitProbe = (sequence) => fetch('/wait-probe?token=network-wait-secret&sequence=' + encodeURIComponent(sequence))
          .then((response) => response.json());
        window.scheduleNetworkWaitProbe = (sequence, delay) => {
          setTimeout(() => { void window.runNetworkWaitProbe(sequence); }, delay);
          return 'scheduled';
        };
        window.runWebSocketProbe = () => new Promise((resolve, reject) => {
          const socket = new WebSocket('ws://' + location.host + '/socket');
          socket.binaryType = 'arraybuffer';
          const received = [];
          const timeout = setTimeout(() => { socket.close(); reject(new Error('WebSocket fixture timed out')); }, 3000);
          socket.onopen = () => socket.send(JSON.stringify({ action: 'subscribe', token: 'client-secret', visible: 'client-kept' }));
          socket.onmessage = (event) => {
            received.push(typeof event.data === 'string' ? JSON.parse(event.data) : { binaryBytes: event.data.byteLength });
            if (received.length < 3) return;
            clearTimeout(timeout);
            socket.close();
          };
          socket.onclose = () => { clearTimeout(timeout); resolve(received); };
          socket.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket fixture failed')); };
        });
        window.runEventSourceProbe = () => new Promise((resolve, reject) => {
          const source = new EventSource('/events');
          const received = [];
          const timeout = setTimeout(() => { source.close(); reject(new Error('EventSource fixture timed out')); }, 3000);
          source.onmessage = (event) => received.push({ event: 'message', id: event.lastEventId, data: JSON.parse(event.data) });
          source.addEventListener('progress', (event) => {
            received.push({ event: 'progress', id: event.lastEventId, data: JSON.parse(event.data) });
            clearTimeout(timeout);
            source.close();
            resolve(received);
          });
          source.onerror = () => {
            clearTimeout(timeout);
            source.close();
            reject(new Error('EventSource fixture failed'));
          };
        });
        window.runConsoleExceptionProbe = () => {
          function innerConsoleFailure() { throw new TypeError('console-stack-kept token=console-stack-secret'); }
          function outerConsoleFailure() { innerConsoleFailure(); }
          setTimeout(outerConsoleFailure, 0);
        };
        window.runConsoleWarningProbe = () => {
          function innerConsoleWarning() { console.warn('human-console-warning token=human-console-secret https://example.test/?token=console-url-secret&view=kept'); }
          function outerConsoleWarning() { for (let index = 0; index < 3; index += 1) innerConsoleWarning(); }
          outerConsoleWarning();
        };
        window.runConsoleStackKindsProbe = () => {
          function innerConsoleError() { console.error('console-error-stack-kept token=console-error-secret'); }
          function outerConsoleError() { innerConsoleError(); }
          function innerConsoleTrace() { console.trace('console-trace-stack-kept token=console-trace-secret'); }
          function outerConsoleTrace() { innerConsoleTrace(); }
          function innerConsoleAssert() { console.assert(false, 'console-assert-stack-kept token=console-assert-secret'); }
          function outerConsoleAssert() { innerConsoleAssert(); }
          outerConsoleError();
          outerConsoleTrace();
          outerConsoleAssert();
        };
        window.runLongAnimationFrameProbe = () => new Promise((resolve) => {
          performance.mark('probe-start token=user-timing-secret');
          requestAnimationFrame(() => {
            const probe = document.querySelector('#capture-target');
            const deadline = performance.now() + 90;
            let iteration = 0;
            while (performance.now() < deadline) {
              probe.style.width = (240 + (iteration % 2)) + 'px';
              void probe.offsetWidth;
              iteration += 1;
            }
            requestAnimationFrame(() => {
              performance.mark('probe-finished');
              performance.measure('Long frame probe kept', 'probe-start token=user-timing-secret', 'probe-finished');
              resolve(iteration);
            });
          });
        });
        window.runLayoutShiftProbe = () => new Promise((resolve) => {
          document.documentElement.style.overflowAnchor = 'none';
          window.scrollTo(0, 0);
          setTimeout(() => requestAnimationFrame(() => {
              const spacer = document.createElement('div');
              spacer.id = 'layout-shift-probe';
              spacer.style.height = '120px';
              document.body.prepend(spacer);
              requestAnimationFrame(() => resolve(spacer.getBoundingClientRect().height));
            }), 600);
        });
        window.startMemorySaverProbe = () => setInterval(() => fetch('/memory-saver-tick'), 40);
      </script></body></html>`)
  })
  server.on('upgrade', (request, socket) => {
    if (request.url !== '/socket') {
      socket.destroy()
      return
    }
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n'))
    socket.write(webSocketServerFrame(JSON.stringify({ event: 'welcome', token: 'server-secret', visible: 'server-kept' })))
    socket.once('data', (frame) => {
      const received = readWebSocketClientText(frame)
      socket.write(webSocketServerFrame(JSON.stringify({
        event: 'echo',
        received: received ? JSON.parse(received).visible : null,
        accessToken: 'server-secret',
        visible: 'echo-kept'
      })))
      socket.write(webSocketServerFrame(Buffer.from([1, 2, 3, 4]), 2))
      socket.once('data', () => socket.end(webSocketServerFrame(Buffer.alloc(0), 8)))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const client = new Client({ name: 'hronaut-capabilities-test', version: '1.0.0' })
  const authorization = `Bearer ${mcpToken}`
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a port')
    await expect
      .poll(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
        } catch {
          return false
        }
      })
      .toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Capability tests')
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

    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
    }) as CallToolResult
    const state = JSON.parse(text(opened)) as { activeTabId: string }
    const tabId = state.activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    await electronApp.evaluate(async ({ webContents }, fixtureTabId) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1') && contents.getURL().endsWith('/'))
      if (!page) throw new Error(`Memory Saver fixture tab was not found: ${fixtureTabId}`)
      await page.executeJavaScript('window.startMemorySaverProbe()')
    }, tabId)
    await expect.poll(() => memorySaverTicks).toBeGreaterThan(1)
    await appWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: true })`)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((value) => value.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(true)
    const ticksBeforeSleep = memorySaverTicks
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(memorySaverTicks).toBeLessThanOrEqual(ticksBeforeSleep + 1)
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
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1') && contents.getURL().endsWith('/'))
      if (!page) throw new Error('Woken Memory Saver fixture tab was not found')
      await page.executeJavaScript('window.startMemorySaverProbe()')
    })
    await expect.poll(() => memorySaverTicks).toBeGreaterThan(ticksBeforeSleep + 1)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1') && contents.getURL().endsWith('/'))
      if (!page) throw new Error('Memory Saver form-protection fixture tab was not found')
      await page.executeJavaScript(`(() => {
        const input = document.querySelector('#name');
        input.value = 'unsaved draft';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
    })
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

    const accessibilityResult = await client.callTool({
      name: 'browser_accessibility_audit',
      arguments: {
        tabId,
        selector: '#audit-scope',
        standard: 'wcag-aa',
        maxViolations: 5,
        maxNodesPerViolation: 2
      }
    }) as CallToolResult
    expect(accessibilityResult.isError, text(accessibilityResult)).not.toBe(true)
    const accessibilityAudit = JSON.parse(text(accessibilityResult))
    expect(accessibilityAudit).toMatchObject({
      tabId,
      standard: 'wcag-aa',
      engine: { name: 'axe-core', version: '4.12.1' }
    })
    expect(accessibilityAudit.violationCount).toBeGreaterThan(0)
    expect(accessibilityAudit.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'button-name',
        impact: 'critical',
        nodes: [expect.objectContaining({ targets: expect.arrayContaining(['#unnamed-button']) })]
      })
    ]))
    expect(JSON.stringify(accessibilityAudit)).not.toContain('<button')
    const pageAuditGlobal = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'typeof window.axe' }
    }) as CallToolResult
    expect(text(pageAuditGlobal)).toBe('undefined')

    await openPageTool('Run accessibility audit')
    const accessibilityPanel = appWindow.getByRole('dialog', { name: 'Accessibility' })
    await expect(accessibilityPanel).toBeVisible()
    await expect(accessibilityPanel).toContainText('button-name')
    await expect(accessibilityPanel).toContainText('critical')
    await accessibilityPanel.getByRole('button', { name: 'Close accessibility audit' }).click()
    await expect(accessibilityPanel).toBeHidden()
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageToolsAfterAudit = appWindow.getByRole('dialog', { name: 'Page tools' })
    const storageAction = pageToolsAfterAudit.getByRole('button', { name: 'Site storage for 127.0.0.1' })
    const accessibilityAction = pageToolsAfterAudit.getByRole('button', { name: /Accessibility audit:/ })
    await expect(accessibilityAction).toHaveClass(/warning/)
    await expect(storageAction).not.toHaveClass(/warning|complete|error|running/)
    await pageToolsAfterAudit.getByRole('button', { name: 'Close page tools' }).click()

    const qualityResult = await client.callTool({
      name: 'browser_quality_audit',
      arguments: { tabId }
    }) as CallToolResult
    expect(qualityResult.isError, text(qualityResult)).not.toBe(true)
    const qualityAudit = JSON.parse(text(qualityResult))
    expect(qualityAudit).toMatchObject({
      tabId,
      status: 'error',
      categories: expect.arrayContaining([
        expect.objectContaining({ id: 'accessibility' }),
        expect.objectContaining({ id: 'performance' }),
        expect.objectContaining({ id: 'metadata' }),
        expect.objectContaining({ id: 'security', status: 'error' }),
        expect.objectContaining({ id: 'pwa' }),
        expect.objectContaining({ id: 'browser-issues' })
      ]),
      caveats: expect.arrayContaining([expect.stringContaining('not a Lighthouse score')])
    })
    expect(qualityAudit.categories).toHaveLength(6)
    expect(JSON.stringify(qualityAudit)).not.toContain('element-inspection-secret')

    await openPageTool(/Quality audit:/)
    const qualityPanel = appWindow.getByRole('dialog', { name: 'Quality audit' })
    await expect(qualityPanel).toBeVisible()
    await expect(qualityPanel).toContainText('Accessibility')
    await expect(qualityPanel).toContainText('Metadata & SEO')
    await expect(qualityPanel.getByRole('button', { name: 'Copy report' })).toBeVisible()
    await qualityPanel.getByRole('button', { name: 'Close quality audit' }).click()

    const performanceWarmup = await client.callTool({
      name: 'browser_performance',
      arguments: { tabId, settleMs: 0, action: 'set-baseline' }
    }) as CallToolResult
    expect(performanceWarmup.isError, text(performanceWarmup)).not.toBe(true)
    const performanceBaseline = JSON.parse(text(performanceWarmup))
    expect(performanceBaseline).toMatchObject({
      tabId,
      action: 'set-baseline',
      baseline: {
        measuredAt: expect.any(String),
        url: expect.stringContaining('127.0.0.1'),
        environment: {
          network: 'none',
          cacheDisabled: false,
          viewport: { width: expect.any(Number), height: expect.any(Number) },
          zoomPercent: 100
        }
      }
    })
    expect(performanceBaseline.comparison).toBeUndefined()
    const longAnimationFrameProbe = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'window.runLongAnimationFrameProbe()' }
    }) as CallToolResult
    expect(longAnimationFrameProbe.isError, text(longAnimationFrameProbe)).not.toBe(true)
    const layoutShiftProbe = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'window.runLayoutShiftProbe()' }
    }) as CallToolResult
    expect(layoutShiftProbe.isError, text(layoutShiftProbe)).not.toBe(true)

    const performanceResult = await client.callTool({
      name: 'browser_performance',
      arguments: { tabId, settleMs: 100 }
    }) as CallToolResult
    expect(performanceResult.isError, text(performanceResult)).not.toBe(true)
    const performanceReport = JSON.parse(text(performanceResult))
    expect(performanceReport).toMatchObject({
      tabId,
      action: 'measure',
      scope: 'current-visit',
      engine: { name: 'web-vitals', version: '6.1.0' },
      resources: { count: expect.any(Number) },
      longTasks: { count: expect.any(Number) },
      longAnimationFrames: {
        supported: true,
        count: expect.any(Number),
        frames: expect.any(Array),
        contributors: expect.any(Array)
      },
      userTimings: {
        count: expect.any(Number),
        entries: expect.any(Array),
        truncated: false
      },
      layoutShifts: {
        supported: true,
        count: expect.any(Number),
        scoreSum: expect.any(Number),
        recentInputCount: expect.any(Number),
        entries: expect.any(Array)
      },
      baseline: { measuredAt: performanceBaseline.measuredAt },
      comparison: {
        sameUrl: true,
        sameEnvironment: true,
        metrics: expect.any(Array)
      }
    })
    expect(performanceReport.longAnimationFrames.count).toBeGreaterThan(0)
    expect(performanceReport.longAnimationFrames.longestDurationMs).toBeGreaterThanOrEqual(50)
    expect(performanceReport.longAnimationFrames.contributors.length).toBeGreaterThan(0)
    expect(performanceReport.userTimings.count).toBeGreaterThanOrEqual(3)
    expect(performanceReport.userTimings.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'measure', name: 'Long frame probe kept', durationMs: expect.any(Number) })
    ]))
    expect(JSON.stringify(performanceReport.userTimings)).not.toContain('user-timing-secret')
    expect(performanceReport.layoutShifts.count).toBeGreaterThan(0)
    expect(performanceReport.layoutShifts.scoreSum).toBeGreaterThan(0)
    expect(performanceReport.layoutShifts.entries.length).toBeGreaterThan(0)
    expect(performanceReport.comparison.metrics.find((metric: { name: string }) => metric.name === 'LOAF_BLOCKING')).toMatchObject({
      unit: 'ms',
      direction: 'regressed',
      baselineValue: expect.any(Number),
      currentValue: expect.any(Number),
      delta: expect.any(Number)
    })
    expect(performanceReport.comparison.metrics[0]).not.toHaveProperty('value')
    expect(performanceReport.comparison.metrics[0]).not.toHaveProperty('tolerance')
    expect(performanceReport.caveats).toEqual(expect.arrayContaining([
      expect.stringContaining('local current-visit sample')
    ]))
    expect(JSON.stringify(performanceReport)).not.toContain('/api-details')
    const pagePerformanceGlobal = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'typeof window.__hronautPerformanceCollector + ":" + typeof window.webVitals' }
    }) as CallToolResult
    expect(text(pagePerformanceGlobal)).toBe('undefined:undefined')

    await openPageTool('Measure page performance')
    const performancePanel = appWindow.getByRole('dialog', { name: 'Page performance' })
    await expect(performancePanel).toBeVisible()
    await expect(performancePanel).toContainText('Current visit')
    await expect(performancePanel).toContainText('Resources')
    await expect(performancePanel).toContainText('Long animation frames')
    await expect(performancePanel).toContainText('Top script contributors')
    await expect(performancePanel).toContainText('Layout shifts')
    await expect(performancePanel).toContainText('Largest unexpected shifts')
    await expect(performancePanel).toContainText('User timing')
    await expect(performancePanel).toContainText('Long frame probe kept')
    await expect(performancePanel).toContainText('local sample')
    await expect(performancePanel).toContainText('Compared with baseline')
    await expect(performancePanel.getByRole('button', { name: 'Clear baseline' })).toBeVisible()
    await expect(performancePanel.getByRole('button', { name: 'Replace baseline' })).toBeVisible()
    await performancePanel.getByRole('button', { name: 'Clear baseline' }).click()
    await expect(performancePanel.getByRole('button', { name: 'Save baseline' })).toBeVisible()
    await expect(performancePanel.getByRole('button', { name: 'Clear baseline' })).toBeHidden()
    await performancePanel.getByRole('button', { name: 'Close performance report' }).click()
    await expect(performancePanel).toBeHidden()

    const designResult = await client.callTool({
      name: 'browser_design_overview',
      arguments: { tabId }
    }) as CallToolResult
    expect(designResult.isError, text(designResult)).not.toBe(true)
    const designReport = JSON.parse(text(designResult))
    expect(designReport).toMatchObject({
      tabId,
      summary: {
        visibleElements: expect.any(Number),
        textColorCount: expect.any(Number),
        fontCombinationCount: expect.any(Number),
        contrastIssueCount: expect.any(Number)
      },
      colors: { text: expect.any(Array), background: expect.any(Array), border: expect.any(Array) },
      fonts: expect.any(Array),
      mediaQueries: expect.arrayContaining([expect.objectContaining({ query: '(max-width: 900px)' })]),
      caveats: expect.arrayContaining([expect.stringContaining('bounded current-rendering sample')])
    })
    expect(designReport.summary.visibleElements).toBeGreaterThan(0)
    expect(designReport.summary.contrastIssueCount).toBeGreaterThan(0)
    expect(designReport.contrastIssues.length).toBeGreaterThan(0)
    expect(JSON.stringify(designReport)).not.toContain('design-overview-secret-body-copy')
    expect(JSON.stringify(designReport)).not.toContain('contrast-probe')

    await openPageTool(/Design overview:/)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const designPanel = appWindow.getByRole('dialog', { name: 'Огляд дизайну' })
    await expect(designPanel).toBeVisible()
    await expect(designPanel).toContainText('Обчислені кольори')
    await expect(designPanel).toContainText('Типографіка')
    await expect(designPanel).toContainText('Ймовірні проблеми контрасту тексту')
    await designPanel.getByRole('button', { name: 'Закрити огляд дизайну' }).click()
    await expect(designPanel).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    const metadataResult = await client.callTool({
      name: 'browser_page_metadata',
      arguments: { tabId }
    }) as CallToolResult
    expect(metadataResult.isError, text(metadataResult)).not.toBe(true)
    const metadataReport = JSON.parse(text(metadataResult))
    expect(metadataReport).toMatchObject({
      tabId,
      title: 'Capability fixture',
      document: {
        language: 'en',
        description: 'Capability metadata description',
        titleElementCount: 1,
        descriptionCount: 1,
        headingCounts: { h1: 1 }
      },
      openGraph: {
        title: 'Capability social title',
        type: 'website',
        images: [expect.objectContaining({ alt: 'Capability social image' })]
      },
      twitter: { card: 'summary_large_image', title: 'Capability Twitter title' },
      alternateLinks: [expect.objectContaining({ language: 'uk' })],
      structuredData: {
        blockCount: 1,
        validBlockCount: 1,
        invalidBlockCount: 0,
        types: expect.arrayContaining(['WebPage', 'SoftwareApplication'])
      }
    })
    expect(metadataReport.document.canonicalUrls[0]).toContain('token=%5BREDACTED%5D')
    const serializedMetadata = JSON.stringify(metadataReport)
    expect(serializedMetadata).not.toContain('page-metadata-secret-meta')
    expect(serializedMetadata).not.toContain('page-metadata-secret-url')
    expect(serializedMetadata).not.toContain('page-metadata-secret-icon')
    expect(serializedMetadata).not.toContain('page-metadata-secret-og-url')
    expect(serializedMetadata).not.toContain('page-metadata-secret-image')
    expect(serializedMetadata).not.toContain('page-metadata-secret-structured-value')
    expect(serializedMetadata).not.toContain('design-overview-secret-body-copy')

    await openPageTool(/Page metadata:/)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const metadataPanel = appWindow.getByRole('dialog', { name: 'Метадані сторінки' })
    await expect(metadataPanel).toBeVisible()
    await expect(metadataPanel).toContainText('Дані для результату пошуку')
    await expect(metadataPanel).toContainText('Соціальні картки')
    await expect(metadataPanel).toContainText('WebPage')
    await metadataPanel.getByRole('button', { name: 'Закрити метадані сторінки' }).click()
    await expect(metadataPanel).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    const securityResult = await client.callTool({
      name: 'browser_security',
      arguments: { tabId }
    }) as CallToolResult
    expect(securityResult.isError, text(securityResult)).not.toBe(true)
    const securityReport = JSON.parse(text(securityResult))
    expect(securityReport).toMatchObject({
      tabId,
      origin: `http://127.0.0.1:${address.port}`,
      secureTransport: false,
      caveats: expect.arrayContaining([expect.stringContaining('main document')])
    })
    expect(['insecure', 'neutral']).toContain(securityReport.state)
    expect(JSON.stringify(securityReport)).not.toContain('response-secret')

    await openPageTool(/Security:/)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const securityPanel = appWindow.getByRole('dialog', { name: 'Безпека з’єднання' })
    await expect(securityPanel).toBeVisible()
    await expect(securityPanel).toContainText('Зашифрований транспорт')
    await expect(securityPanel).toContainText('Відомості сертифіката TLS недоступні')
    await securityPanel.getByRole('button', { name: 'Закрити звіт безпеки' }).click()
    await expect(securityPanel).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    const coverageStarted = await client.callTool({
      name: 'browser_code_coverage',
      arguments: { tabId, action: 'start', mode: 'function', reload: true }
    }) as CallToolResult
    expect(coverageStarted.isError, text(coverageStarted)).not.toBe(true)
    expect(JSON.parse(text(coverageStarted))).toMatchObject({
      tabId,
      status: 'recording',
      recording: { mode: 'function' }
    })
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    const coverageStopped = await client.callTool({
      name: 'browser_code_coverage',
      arguments: { tabId, action: 'stop' }
    }) as CallToolResult
    expect(coverageStopped.isError, text(coverageStopped)).not.toBe(true)
    const coverageReport = JSON.parse(text(coverageStopped))
    expect(coverageReport).toMatchObject({
      tabId,
      status: 'complete',
      report: {
        mode: 'function',
        totalBytes: expect.any(Number),
        usedBytes: expect.any(Number),
        unusedBytes: expect.any(Number),
        resources: expect.any(Array)
      }
    })
    expect(coverageReport.report.totalBytes).toBeGreaterThan(0)
    expect(coverageReport.report.usedBytes).toBeLessThanOrEqual(coverageReport.report.totalBytes)
    expect(JSON.stringify(coverageReport)).not.toContain('hronaut-console-marker')

    await openPageTool(/Code coverage:/)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const coveragePanel = appWindow.getByRole('dialog', { name: 'Покриття коду' })
    await expect(coveragePanel).toBeVisible()
    await expect(coveragePanel).toContainText('Не використано')
    await expect(coveragePanel).toContainText('Ресурси')
    await coveragePanel.getByRole('button', { name: 'Закрити покриття коду' }).click()
    await expect(coveragePanel).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    const cpuProfileStarted = await client.callTool({
      name: 'browser_cpu_profile',
      arguments: { tabId, action: 'start' }
    }) as CallToolResult
    expect(cpuProfileStarted.isError, text(cpuProfileStarted)).not.toBe(true)
    expect(JSON.parse(text(cpuProfileStarted))).toMatchObject({ tabId, status: 'recording' })
    const cpuProbe = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'window.runCpuProfileProbe()' }
    }) as CallToolResult
    expect(cpuProbe.isError, text(cpuProbe)).not.toBe(true)
    const cpuProfileStopped = await client.callTool({
      name: 'browser_cpu_profile',
      arguments: { tabId, action: 'stop' }
    }) as CallToolResult
    expect(cpuProfileStopped.isError, text(cpuProfileStopped)).not.toBe(true)
    const cpuProfile = JSON.parse(text(cpuProfileStopped))
    expect(cpuProfile).toMatchObject({
      tabId,
      status: 'complete',
      report: {
        durationMs: expect.any(Number),
        sampledTimeMs: expect.any(Number),
        sampleCount: expect.any(Number),
        hotspots: expect.any(Array)
      }
    })
    expect(cpuProfile.report.sampleCount).toBeGreaterThan(0)
    expect(cpuProfile.report.hotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        functionName: 'cpuProfileBusyLoop',
        url: expect.stringContaining('token=%5BREDACTED%5D'),
        selfTimeMs: expect.any(Number),
        samples: expect.any(Number)
      })
    ]))
    expect(JSON.stringify(cpuProfile)).not.toContain('cpu-profile-secret')

    await openPageTool(/JavaScript CPU profile:/)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const cpuProfilePanel = appWindow.getByRole('dialog', { name: 'Профіль CPU JavaScript' })
    await expect(cpuProfilePanel).toBeVisible()
    await expect(cpuProfilePanel).toContainText('cpuProfileBusyLoop')
    await expect(cpuProfilePanel).toContainText('Вибраний час')
    await cpuProfilePanel.getByRole('button', { name: 'Записати знову' }).click()
    await expect(cpuProfilePanel).toContainText('Запис активності CPU триває')
    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(true)
    await expect(cpuProfilePanel).toContainText('Знайдіть гарячі функції JavaScript')
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
      return webContents.getAllWebContents().some((contents) => (
        contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
      ))
    }, `http://127.0.0.1:${address.port}`)).toBe(true)
    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(false)
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
      return webContents.getAllWebContents().some((contents) => (
        contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
      ))
    }, `http://127.0.0.1:${address.port}`)).toBe(false)
    const cpuAfterDevToolsResult = await client.callTool({
      name: 'browser_cpu_profile',
      arguments: { tabId, action: 'get' }
    }) as CallToolResult
    expect(cpuAfterDevToolsResult.isError, text(cpuAfterDevToolsResult)).not.toBe(true)
    expect(JSON.parse(text(cpuAfterDevToolsResult))).toMatchObject({
      tabId,
      status: 'idle'
    })
    await cpuProfilePanel.getByRole('button', { name: 'Закрити профіль CPU JavaScript' }).click()
    await expect(cpuProfilePanel).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    const memoryBaselineResult = await client.callTool({
      name: 'browser_memory',
      arguments: { tabId, action: 'set-baseline', collectGarbage: true }
    }) as CallToolResult
    expect(memoryBaselineResult.isError, text(memoryBaselineResult)).not.toBe(true)
    const memoryBaseline = JSON.parse(text(memoryBaselineResult))
    expect(memoryBaseline).toMatchObject({
      tabId,
      action: 'set-baseline',
      forcedGarbageCollection: true,
      allocationStatus: 'idle',
      baseline: {
        jsHeapUsedBytes: expect.any(Number),
        nodes: expect.any(Number),
        eventListeners: expect.any(Number)
      }
    })

    const allocationStartResult = await client.callTool({
      name: 'browser_memory',
      arguments: { tabId, action: 'start-allocation-sampling' }
    }) as CallToolResult
    expect(allocationStartResult.isError, text(allocationStartResult)).not.toBe(true)
    expect(JSON.parse(text(allocationStartResult))).toMatchObject({
      tabId,
      action: 'start-allocation-sampling',
      allocationStatus: 'recording',
      allocationRecording: { startedAt: expect.any(String) }
    })
    const cpuDuringAllocation = await client.callTool({
      name: 'browser_cpu_profile',
      arguments: { tabId, action: 'start' }
    }) as CallToolResult
    expect(cpuDuringAllocation.isError).toBe(true)
    expect(text(cpuDuringAllocation)).toContain('Stop memory allocation sampling')
    const coverageDuringAllocation = await client.callTool({
      name: 'browser_code_coverage',
      arguments: { tabId, action: 'start', reload: false }
    }) as CallToolResult
    expect(coverageDuringAllocation.isError).toBe(true)
    expect(text(coverageDuringAllocation)).toContain('Stop memory allocation sampling')

    const retainedMemory = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(function retainMemoryForProfile() {
          const root = document.createElement('section')
          root.id = 'retained-memory-fixture'
          const records = []
          for (let index = 0; index < 800; index += 1) {
            const node = document.createElement('button')
            node.textContent = 'retained-' + index
            node.addEventListener('click', () => index)
            root.append(node)
            records.push({ index, payload: new Array(200).fill(index) })
          }
          document.body.append(root)
          window.__hronautRetainedMemory = { root, records }
          return { nodes: root.childElementCount, records: records.length }
        })()`
      }
    }) as CallToolResult
    expect(JSON.parse(text(retainedMemory))).toEqual({ nodes: 800, records: 800 })

    const allocationStopResult = await client.callTool({
      name: 'browser_memory',
      arguments: { tabId, action: 'stop-allocation-sampling' }
    }) as CallToolResult
    expect(allocationStopResult.isError, text(allocationStopResult)).not.toBe(true)
    const allocationStop = JSON.parse(text(allocationStopResult))
    expect(allocationStop).toMatchObject({
      tabId,
      action: 'stop-allocation-sampling',
      allocationStatus: 'complete',
      allocationProfile: {
        sampledBytes: expect.any(Number),
        sampleCount: expect.any(Number),
        hotspots: expect.any(Array)
      }
    })
    expect(allocationStop.allocationProfile.sampledBytes).toBeGreaterThan(0)
    expect(allocationStop.allocationProfile.hotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        functionName: 'retainMemoryForProfile',
        selfBytes: expect.any(Number),
        selfPercent: expect.any(Number)
      })
    ]))
    expect(JSON.stringify(allocationStop.allocationProfile)).not.toContain('retained-memory-fixture')
    expect(JSON.stringify(allocationStop.allocationProfile)).not.toContain('retained-0')

    const memoryMeasurementResult = await client.callTool({
      name: 'browser_memory',
      arguments: { tabId, action: 'measure', collectGarbage: true }
    }) as CallToolResult
    expect(memoryMeasurementResult.isError, text(memoryMeasurementResult)).not.toBe(true)
    const memoryMeasurement = JSON.parse(text(memoryMeasurementResult))
    expect(memoryMeasurement).toMatchObject({
      tabId,
      action: 'measure',
      forcedGarbageCollection: true,
      delta: {
        jsHeapUsedBytes: expect.any(Number),
        nodes: expect.any(Number),
        eventListeners: expect.any(Number)
      }
    })
    expect(memoryMeasurement.current.jsHeapUsedBytes).toBeGreaterThan(memoryMeasurement.baseline.jsHeapUsedBytes)
    expect(memoryMeasurement.delta.nodes).toBeGreaterThanOrEqual(800)
    expect(memoryMeasurement.delta.eventListeners).toBeGreaterThanOrEqual(800)
    expect(JSON.stringify(memoryMeasurement)).not.toContain('retained-memory-fixture')

    await openPageTool(/Page memory:/)
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const memoryPanel = appWindow.getByRole('dialog', { name: 'Памʼять сторінки' })
    await expect(memoryPanel).toBeVisible()
    await expect(memoryPanel).toContainText('Базовий рівень виконання активний')
    await expect(memoryPanel).toContainText('Зростання є підказкою, а не доказом витоку')
    await expect(memoryPanel).toContainText('Знайдіть утримані розподіли за функцією')
    await expect(memoryPanel).toContainText('Вибрані активні байти')
    await expect(memoryPanel).toContainText('retainMemoryForProfile')
    await expect(memoryPanel.getByRole('button', { name: 'GC і вимірювання' })).toBeVisible()
    await memoryPanel.getByRole('button', { name: 'Очистити', exact: true }).click()
    await expect(memoryPanel).toContainText('Базового рівня немає')
    await expect(memoryPanel).toContainText('retainMemoryForProfile')
    await expect(memoryPanel).not.toContainText('Базовий рівень очищено')
    await memoryPanel.getByRole('button', { name: 'Закрити звіт памʼяті' }).click()
    await expect(memoryPanel).toBeHidden()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    const sameUrlTabResult = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
    }) as CallToolResult
    expect(sameUrlTabResult.isError, text(sameUrlTabResult)).not.toBe(true)
    const sameUrlTabId = JSON.parse(text(sameUrlTabResult)).activeTabId as string
    await client.callTool({ name: 'browser_wait', arguments: { tabId: sameUrlTabId } })
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const sameUrlPageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(sameUrlPageTools).toBeVisible()
    await expect(sameUrlPageTools.getByRole('button', { name: 'Page memory: Heap, DOM, and allocation diagnostics' })).toBeVisible()
    await expect(sameUrlPageTools).not.toContainText('retainMemoryForProfile')
    await sameUrlPageTools.getByRole('button', { name: 'Close page tools' }).click()
    await client.callTool({ name: 'browser_close_tab', arguments: { tabId: sameUrlTabId } })
    await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

    const fixtureOrigin = `http://127.0.0.1:${address.port}`
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(fixtureOrigin)}, 'geolocation', 'allow')`)
    const protectedCookieSetup = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "fetch('/http-only-cookie').then(() => true)" }
    }) as CallToolResult
    expect(protectedCookieSetup.isError, text(protectedCookieSetup)).not.toBe(true)
    const localStorageMetadata = await client.callTool({
      name: 'browser_storage',
      arguments: { tabId, kind: 'local-storage', action: 'list' }
    }) as CallToolResult
    expect(JSON.parse(text(localStorageMetadata))).toMatchObject({
      tabId,
      origin: fixtureOrigin,
      kind: 'local-storage',
      itemCount: 1,
      items: [expect.objectContaining({ key: 'hronaut-mcp-site-data', valueBytes: 6 })]
    })
    expect(text(localStorageMetadata)).not.toContain('"value": "stored"')
    const localStorageValue = await client.callTool({
      name: 'browser_storage',
      arguments: { tabId, kind: 'local-storage', action: 'get', key: 'hronaut-mcp-site-data' }
    }) as CallToolResult
    expect(JSON.parse(text(localStorageValue)).items).toEqual([
      expect.objectContaining({ key: 'hronaut-mcp-site-data', value: 'stored' })
    ])
    const storedDebugValue = await client.callTool({
      name: 'browser_storage',
      arguments: { tabId, kind: 'session-storage', action: 'set', key: 'debug-session', value: 'step-one' }
    }) as CallToolResult
    expect(JSON.parse(text(storedDebugValue))).toMatchObject({ changed: true, itemCount: 1 })
    const deletedDebugValue = await client.callTool({
      name: 'browser_storage',
      arguments: { tabId, kind: 'session-storage', action: 'delete', key: 'debug-session' }
    }) as CallToolResult
    expect(JSON.parse(text(deletedDebugValue))).toMatchObject({ changed: true, itemCount: 0 })
    const tabScopedStorage = await client.callTool({
      name: 'browser_storage',
      arguments: { tabId, kind: 'session-storage', action: 'set', key: 'first-tab-only', value: 'private-to-this-tab' }
    }) as CallToolResult
    expect(JSON.parse(text(tabScopedStorage))).toMatchObject({ changed: true, itemCount: 1 })
    const cookieStorage = await client.callTool({
      name: 'browser_storage',
      arguments: { tabId, kind: 'cookies', action: 'list', includeValues: true }
    }) as CallToolResult
    expect(JSON.parse(text(cookieStorage)).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'hronaut-mcp-site-data', value: 'stored' }),
      expect.objectContaining({ key: 'hronaut-protected', protected: true, valueBytes: 13 })
    ]))
    expect(text(cookieStorage)).not.toContain('server-secret')

    await openPageTool('Site storage for 127.0.0.1')
    const storagePanel = appWindow.getByRole('dialog', { name: /Site storage/ })
    await expect(storagePanel).toBeVisible()
    await expect(storagePanel).toContainText('hronaut-mcp-site-data')
    await expect(storagePanel).toContainText('Shared by origin in this workspace')
    await storagePanel.getByRole('button', { name: 'Session', exact: true }).click()
    await expect(storagePanel).toContainText('first-tab-only')

    const storageIsolationTabResult = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
    }) as CallToolResult
    expect(storageIsolationTabResult.isError, text(storageIsolationTabResult)).not.toBe(true)
    const storageIsolationTabId = JSON.parse(text(storageIsolationTabResult)).activeTabId as string
    await client.callTool({ name: 'browser_wait', arguments: { tabId: storageIsolationTabId } })
    await expect(storagePanel).toBeHidden()
    await openPageTool('Site storage for 127.0.0.1')
    await storagePanel.getByRole('button', { name: 'Session', exact: true }).click()
    await expect(storagePanel).not.toContainText('first-tab-only')
    await storagePanel.getByRole('button', { name: 'Close site storage' }).click()
    await client.callTool({ name: 'browser_close_tab', arguments: { tabId: storageIsolationTabId } })
    await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

    await openPageTool('Site storage for 127.0.0.1')
    await storagePanel.getByRole('button', { name: 'Cookies' }).click()
    await expect(storagePanel).toContainText('hronaut-protected')
    await expect(storagePanel).toContainText('HttpOnly value protected')
    await expect(storagePanel).not.toContainText('server-secret')
    await storagePanel.getByRole('button', { name: 'Close site storage' }).click()

    const inspectedSiteData = await client.callTool({
      name: 'browser_site_data',
      arguments: { action: 'inspect', origin: `${fixtureOrigin}/` }
    }) as CallToolResult
    expect(JSON.parse(text(inspectedSiteData))).toMatchObject({
      origin: fixtureOrigin,
      cookieCount: 2,
      historyEntries: 1
    })
    const clearedSiteData = await client.callTool({
      name: 'browser_site_data',
      arguments: { action: 'clear', origin: fixtureOrigin, dataTypes: ['cookies-and-storage', 'cache'] }
    }) as CallToolResult
    expect(JSON.parse(text(clearedSiteData))).toMatchObject({
      origin: fixtureOrigin,
      cleared: ['cookies-and-storage', 'cache'],
      remaining: { cookieCount: 0, historyEntries: 1 }
    })
    const rejectedWholeProfileClear = await client.callTool({
      name: 'browser_site_data',
      arguments: { action: 'clear', origin: fixtureOrigin }
    }) as CallToolResult
    expect(rejectedWholeProfileClear.isError).toBe(true)
    expect(text(rejectedWholeProfileClear)).toContain('select at least one category')
    const rejectedUnsafeOrigin = await client.callTool({
      name: 'browser_site_data',
      arguments: { action: 'inspect', origin: 'file:///tmp/not-a-website' }
    }) as CallToolResult
    expect(rejectedUnsafeOrigin.isError).toBe(true)
    expect(text(rejectedUnsafeOrigin)).toContain('valid HTTP or HTTPS')
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedOrigin) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(requestedOrigin))
      return page?.executeJavaScript("localStorage.getItem('hronaut-mcp-site-data')")
    }, fixtureOrigin)).toBeNull()

    await expect.poll(async () => {
      const result = await client.callTool({
        name: 'browser_visit_history',
        arguments: { action: 'list', query: 'Capability fixture' }
      }) as CallToolResult
      return JSON.parse(text(result))
    }).toEqual([
      expect.objectContaining({ title: 'Capability fixture', url: `http://127.0.0.1:${address.port}/` })
    ])
    const listedHistory = await client.callTool({
      name: 'browser_visit_history',
      arguments: { action: 'list', query: 'Capability fixture' }
    }) as CallToolResult
    const historyEntry = (JSON.parse(text(listedHistory)) as Array<{ id: string }>)[0]
    if (!historyEntry) throw new Error('MCP did not return the recorded visit')
    const reopenedHistory = await client.callTool({
      name: 'browser_visit_history',
      arguments: { action: 'open', id: historyEntry.id, active: false }
    }) as CallToolResult
    const reopenedHistoryState = JSON.parse(text(reopenedHistory)) as { tabs: Array<{ id: string; url: string }> }
    expect(reopenedHistoryState.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: `http://127.0.0.1:${address.port}/` })
    ]))
    const reopenedHistoryTab = reopenedHistoryState.tabs.find((tab) => tab.id !== tabId && tab.url === `http://127.0.0.1:${address.port}/`)
    if (!reopenedHistoryTab) throw new Error('MCP did not reopen the recorded visit')
    await client.callTool({ name: 'browser_wait', arguments: { tabId: reopenedHistoryTab.id } })
    const clearedHistory = await client.callTool({
      name: 'browser_visit_history',
      arguments: { action: 'clear' }
    }) as CallToolResult
    expect(JSON.parse(text(clearedHistory))).toEqual([])

    const bookmarkUrl = `http://127.0.0.1:${address.port}/`
    const addedBookmarks = await client.callTool({
      name: 'browser_bookmarks',
      arguments: { action: 'add', url: bookmarkUrl, title: 'Capability bookmark' }
    }) as CallToolResult
    const bookmark = (JSON.parse(text(addedBookmarks)) as Array<{ id: string; url: string; title: string }>)[0]
    if (!bookmark) throw new Error('MCP did not return the added bookmark')
    expect(bookmark).toMatchObject({ url: bookmarkUrl, title: 'Capability bookmark' })
    const listedBookmarks = await client.callTool({ name: 'browser_bookmarks', arguments: { action: 'list' } }) as CallToolResult
    expect(JSON.parse(text(listedBookmarks))).toEqual([expect.objectContaining({ id: bookmark.id })])
    const renamedBookmarks = await client.callTool({
      name: 'browser_bookmarks',
      arguments: { action: 'rename', id: bookmark.id, title: 'Renamed capability' }
    }) as CallToolResult
    expect(JSON.parse(text(renamedBookmarks))).toEqual([expect.objectContaining({ title: 'Renamed capability' })])
    const openedBookmark = await client.callTool({
      name: 'browser_bookmarks',
      arguments: { action: 'open', id: bookmark.id, active: false }
    }) as CallToolResult
    expect(JSON.parse(text(openedBookmark)).tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: bookmarkUrl })
    ]))
    const removedBookmarks = await client.callTool({
      name: 'browser_bookmarks',
      arguments: { action: 'remove', id: bookmark.id }
    }) as CallToolResult
    expect(JSON.parse(text(removedBookmarks))).toEqual([])

    await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'document.title' }
    })
    const commandedTab = appWindow.locator('.tab.active')
    await expect(commandedTab).toHaveClass(/mcp-active/)
    await expect(commandedTab).toHaveAttribute('title', 'AI command: browser_evaluate')
    await expect(commandedTab).not.toHaveClass(/mcp-active/, { timeout: 3_000 })

    await openPageTool('Save page as PDF')
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageToolsAfterPdf = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(pageToolsAfterPdf.getByRole('button', { name: /PDF saved to/ })).toBeVisible()
    await pageToolsAfterPdf.getByRole('button', { name: 'Close page tools' }).click()
    const humanPdf = await readFile(join(profileDirectory, 'Capability fixture.pdf'))
    expect(humanPdf.subarray(0, 5).toString()).toBe('%PDF-')

    const pdfIsolationTabResult = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
    }) as CallToolResult
    expect(pdfIsolationTabResult.isError, text(pdfIsolationTabResult)).not.toBe(true)
    const pdfIsolationTabId = JSON.parse(text(pdfIsolationTabResult)).activeTabId as string
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const isolatedPdfPageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(isolatedPdfPageTools.getByRole('button', { name: 'Save page as PDF', exact: true })).toBeVisible()
    await expect(isolatedPdfPageTools).not.toContainText('PDF saved to')
    await isolatedPdfPageTools.getByRole('button', { name: 'Close page tools' }).click()
    await client.callTool({ name: 'browser_close_tab', arguments: { tabId: pdfIsolationTabId } })
    await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

    const selected = await client.callTool({
      name: 'browser_select',
      arguments: { tabId, selector: '#choice', value: 'Two' }
    }) as CallToolResult
    expect(selected.isError).not.toBe(true)
    expect(JSON.parse(text(selected))).toMatchObject({ value: 'two', label: 'Two' })

    const filled = await client.callTool({
      name: 'browser_fill_form',
      arguments: {
        tabId,
        fields: [
          { selector: '#name', value: 'Ada' },
          { selector: '#agree', value: true }
        ]
      }
    }) as CallToolResult
    expect(filled.isError, text(filled)).not.toBe(true)
    const formState = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "({ name: document.querySelector('#name').value, agree: document.querySelector('#agree').checked })" }
    }) as CallToolResult
    expect(JSON.parse(text(formState))).toEqual({ name: 'Ada', agree: true })

    await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: "document.querySelector('#name').focus(); window.hronautKeyboardEvents = []; true"
      }
    })
    const selectedAll = await client.callTool({
      name: 'browser_press',
      arguments: { tabId, key: 'Control+A' }
    }) as CallToolResult
    expect(selectedAll.isError, text(selectedAll)).not.toBe(true)
    const shortcutState = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: "({ start: document.querySelector('#name').selectionStart, end: document.querySelector('#name').selectionEnd, events: window.hronautKeyboardEvents })"
      }
    }) as CallToolResult
    expect(JSON.parse(text(shortcutState))).toEqual({
      start: 0,
      end: 3,
      events: [
        { type: 'keydown', key: 'a', control: true, shift: false, alt: false, meta: false },
        { type: 'keyup', key: 'a', control: true, shift: false, alt: false, meta: false }
      ]
    })

    const replacedSelection = await client.callTool({
      name: 'browser_press',
      arguments: { tabId, key: 'x' }
    }) as CallToolResult
    expect(replacedSelection.isError, text(replacedSelection)).not.toBe(true)
    const pressedCharacter = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#name').value" }
    }) as CallToolResult
    expect(text(pressedCharacter)).toBe('x')

    const invalidKeyCombination = await client.callTool({
      name: 'browser_press',
      arguments: { tabId, key: 'Control+A+B' }
    }) as CallToolResult
    expect(invalidKeyCombination.isError).toBe(true)
    expect(text(invalidKeyCombination)).toContain('exactly one non-modifier key')

    const invalidPromptClick = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#double-click', promptText: 'ignored without an action' }
    }) as CallToolResult
    expect(invalidPromptClick.isError).toBe(true)
    expect(text(invalidPromptClick)).toContain('promptText requires dialogAction: accept')

    const invalidDialogDoubleClick = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#double-click', doubleClick: true, dialogAction: 'dismiss' }
    }) as CallToolResult
    expect(invalidDialogDoubleClick.isError).toBe(true)
    expect(text(invalidDialogDoubleClick)).toContain('doubleClick cannot be combined with dialogAction')

    const doubleClicked = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#double-click', doubleClick: true }
    }) as CallToolResult
    expect(doubleClicked.isError, text(doubleClicked)).not.toBe(true)
    const doubleClickState = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: "({ clicks: document.querySelector('#double-click').dataset.clicks, doubleClicks: document.querySelector('#double-click').dataset.doubleClicks })"
      }
    }) as CallToolResult
    expect(JSON.parse(text(doubleClickState))).toEqual({ clicks: '2', doubleClicks: '1' })

    const acceptedPrompt = await client.callTool({
      name: 'browser_click',
      arguments: {
        tabId,
        selector: '#prompt',
        dialogAction: 'accept',
        promptText: 'typed by agent'
      }
    }) as CallToolResult
    expect(acceptedPrompt.isError, text(acceptedPrompt)).not.toBe(true)
    const acceptedPromptValue = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#prompt').dataset.result" }
    }) as CallToolResult
    expect(text(acceptedPromptValue)).toBe('typed by agent')

    const dismissedPrompt = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#prompt', dialogAction: 'dismiss' }
    }) as CallToolResult
    expect(dismissedPrompt.isError, text(dismissedPrompt)).not.toBe(true)
    const dismissedPromptValue = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#prompt').dataset.result" }
    }) as CallToolResult
    expect(text(dismissedPromptValue)).toBe('null')

    const hovered = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, selector: '#hover' }
    }) as CallToolResult
    expect(hovered.isError, text(hovered)).not.toBe(true)
    await expect.poll(async () => {
      const result = await client.callTool({
        name: 'browser_evaluate',
        arguments: { tabId, script: "document.querySelector('#hover').dataset.hovered" }
      }) as CallToolResult
      return text(result)
    }).toBe('true')

    const dragged = await client.callTool({
      name: 'browser_drag',
      arguments: { tabId, sourceSelector: '#drag', targetSelector: '#drop' }
    }) as CallToolResult
    expect(dragged.isError, text(dragged)).not.toBe(true)
    await expect.poll(async () => {
      const result = await client.callTool({
        name: 'browser_evaluate',
        arguments: { tabId, script: "document.querySelector('#drop').textContent" }
      }) as CallToolResult
      return text(result)
    }).toBe('dragged')

    const resized = await client.callTool({
      name: 'browser_resize',
      arguments: { tabId, width: 390, height: 640 }
    }) as CallToolResult
    expect(JSON.parse(text(resized))).toMatchObject({ width: 390, height: 640 })
    await client.callTool({ name: 'browser_resize', arguments: { tabId, reset: true } })

    const uploadPath = join(profileDirectory, 'upload-fixture.txt')
    await writeFile(uploadPath, 'Hronaut upload fixture', 'utf8')
    const uploaded = await client.callTool({
      name: 'browser_file_upload',
      arguments: { tabId, selector: '#upload', paths: [uploadPath] }
    }) as CallToolResult
    expect(uploaded.isError, text(uploaded)).not.toBe(true)
    const uploadName = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#upload').files[0].name" }
    }) as CallToolResult
    expect(text(uploadName)).toBe('upload-fixture.txt')

    const scrolled = await client.callTool({
      name: 'browser_scroll',
      arguments: { tabId, deltaY: 500 }
    }) as CallToolResult
    expect(JSON.parse(text(scrolled)).y).toBeGreaterThan(0)

    const zoomed = await client.callTool({
      name: 'browser_zoom',
      arguments: { tabId, action: 'set', percent: 125 }
    }) as CallToolResult
    expect(JSON.parse(text(zoomed)).tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tabId, zoomPercent: 125 })])
    )
    const resetZoom = await client.callTool({
      name: 'browser_zoom',
      arguments: { tabId, action: 'reset' }
    }) as CallToolResult
    expect(JSON.parse(text(resetZoom)).tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tabId, zoomPercent: 100 })])
    )
    const muted = await client.callTool({
      name: 'browser_audio',
      arguments: { tabId, muted: true }
    }) as CallToolResult
    expect(JSON.parse(text(muted)).tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tabId, muted: true })])
    )
    await client.callTool({ name: 'browser_audio', arguments: { tabId, muted: false } })

    const consoleResult = await client.callTool({ name: 'browser_console', arguments: { tabId } }) as CallToolResult
    expect(JSON.parse(text(consoleResult))).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'error', message: 'hronaut-console-marker' })])
    )
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
    const slowestFetchResult = await client.callTool({
      name: 'browser_network',
      arguments: {
        tabId,
        query: 'api-details',
        resourceType: 'fetch/xhr',
        sortBy: 'duration',
        sortDirection: 'desc',
        limit: 1
      }
    }) as CallToolResult
    const slowestFetch = JSON.parse(text(slowestFetchResult)) as Array<Record<string, unknown>>
    expect(slowestFetch).toHaveLength(1)
    expect(slowestFetch[0]).toMatchObject({ resourceType: 'fetch', durationMs: expect.any(Number) })
    expect(String(slowestFetch[0]?.url)).toContain('timing=delayed')
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
      expect.objectContaining({ url: `http://127.0.0.1:${address.port}/`, lineNumber: expect.any(Number) })
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
    await expect(networkPanel.locator('.network-request-list > button').first()).toContainText('timing=delayed')
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

    const consoleExceptionProbe = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#throw' }
    }) as CallToolResult
    expect(consoleExceptionProbe.isError, text(consoleExceptionProbe)).not.toBe(true)
    let consoleException: Record<string, unknown> | undefined
    let consoleErrors: Array<Record<string, unknown>> = []
    await expect.poll(async () => {
      const consoleResult = await client.callTool({
        name: 'browser_console',
        arguments: { tabId, level: 'error' }
      }) as CallToolResult
      consoleErrors = JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>
      consoleException = [...consoleErrors].reverse().find((message) => (
        String(message.message).includes('console-stack-kept')
      ))
      return consoleException?.kind === 'exception'
        && Array.isArray(consoleException.stack)
        && consoleException.stack.length >= 2
    }).toBeTruthy()
    expect(consoleErrors.filter((message) => String(message.message).includes('console-stack-kept'))).toHaveLength(1)
    expect(consoleException).toMatchObject({
      level: 'error',
      kind: 'exception',
      message: expect.stringContaining('console-stack-kept token=[REDACTED]'),
      lineNumber: expect.any(Number),
      columnNumber: expect.any(Number),
      stack: expect.arrayContaining([
        expect.objectContaining({ functionName: 'innerConsoleFailure', lineNumber: expect.any(Number), columnNumber: expect.any(Number) }),
        expect.objectContaining({ functionName: 'outerConsoleFailure', lineNumber: expect.any(Number), columnNumber: expect.any(Number) })
      ])
    })
    expect(JSON.stringify(consoleException)).not.toContain('console-stack-secret')

    const repeatedExceptionProbe = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#throw' }
    }) as CallToolResult
    expect(repeatedExceptionProbe.isError, text(repeatedExceptionProbe)).not.toBe(true)
    await expect.poll(async () => {
      const consoleResult = await client.callTool({
        name: 'browser_console',
        arguments: { tabId, level: 'error' }
      }) as CallToolResult
      const repeatedErrors = (JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>)
        .filter((message) => String(message.message).includes('console-stack-kept'))
      return repeatedErrors.length === 2 && repeatedErrors.every((message) => (
        message.kind === 'exception'
        && message.repeatCount === undefined
        && Array.isArray(message.stack)
        && message.stack.length >= 2
      ))
    }).toBeTruthy()

    const consoleStackKindsProbe = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'window.runConsoleStackKindsProbe()' }
    }) as CallToolResult
    expect(consoleStackKindsProbe.isError, text(consoleStackKindsProbe)).not.toBe(true)
    let stackKindMessages: Array<Record<string, unknown>> = []
    await expect.poll(async () => {
      const consoleResult = await client.callTool({
        name: 'browser_console',
        arguments: { tabId }
      }) as CallToolResult
      stackKindMessages = (JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>)
        .filter((message) => String(message.message).includes('console-') && String(message.message).includes('-stack-kept'))
      return ['console-error-stack-kept', 'console-trace-stack-kept', 'console-assert-stack-kept'].every((marker) => (
        stackKindMessages.some((message) => (
          String(message.message).includes(marker)
          && Array.isArray(message.stack)
          && message.stack.length >= 2
        ))
      ))
    }).toBeTruthy()
    expect(stackKindMessages.find((message) => String(message.message).includes('console-error-stack-kept')))
      .toMatchObject({ level: 'error', stack: expect.arrayContaining([
        expect.objectContaining({ functionName: 'innerConsoleError' }),
        expect.objectContaining({ functionName: 'outerConsoleError' })
      ]) })
    expect(stackKindMessages.find((message) => String(message.message).includes('console-trace-stack-kept')))
      .toMatchObject({ level: 'info', stack: expect.arrayContaining([
        expect.objectContaining({ functionName: 'innerConsoleTrace' }),
        expect.objectContaining({ functionName: 'outerConsoleTrace' })
      ]) })
    expect(stackKindMessages.find((message) => String(message.message).includes('console-assert-stack-kept')))
      .toMatchObject({ level: 'error', stack: expect.arrayContaining([
        expect.objectContaining({ functionName: 'innerConsoleAssert' }),
        expect.objectContaining({ functionName: 'outerConsoleAssert' })
      ]) })
    expect(JSON.stringify(stackKindMessages)).not.toContain('console-error-secret')
    expect(JSON.stringify(stackKindMessages)).not.toContain('console-trace-secret')
    expect(JSON.stringify(stackKindMessages)).not.toContain('console-assert-secret')

    const consoleSeedResult = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(() => {
          window.runConsoleWarningProbe();
          console.info('human-console-info');
          return true;
        })()`
      }
    }) as CallToolResult
    expect(consoleSeedResult.isError, text(consoleSeedResult)).not.toBe(true)
    let consoleWarnings: Array<Record<string, unknown>> = []
    await expect.poll(async () => {
      const consoleResult = await client.callTool({
        name: 'browser_console',
        arguments: { tabId, level: 'warning' }
      }) as CallToolResult
      consoleWarnings = (JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>)
        .filter((message) => String(message.message).includes('human-console-warning'))
      return consoleWarnings.length === 1 ? consoleWarnings[0]?.repeatCount : undefined
    }).toBe(3)
    expect(consoleWarnings[0]).toMatchObject({
      stack: expect.arrayContaining([
        expect.objectContaining({ functionName: 'innerConsoleWarning' }),
        expect.objectContaining({ functionName: 'outerConsoleWarning' })
      ])
    })
    await openPageTool('Open Console')
    const consolePanel = appWindow.getByRole('dialog', { name: 'Console' })
    await expect(consolePanel).toBeVisible()
    await expect(consolePanel.getByLabel('Preserve logs')).toBeChecked()
    await expect(consolePanel).toContainText('human-console-warning')
    await expect(consolePanel).not.toContainText('human-console-secret')
    await consolePanel.getByRole('searchbox', { name: 'Filter Console messages' }).fill('console-stack-kept')
    await consolePanel.getByRole('combobox', { name: 'Filter Console by level' }).selectOption('error')
    await expect(consolePanel).toContainText('console-stack-kept token=[REDACTED]')
    const firstConsoleStack = consolePanel.getByText('Call stack', { exact: false }).first()
    await expect(firstConsoleStack).toBeVisible()
    await firstConsoleStack.click()
    await expect(consolePanel).toContainText('innerConsoleFailure')
    await expect(consolePanel).toContainText('outerConsoleFailure')
    await expect(consolePanel).not.toContainText('console-stack-secret')
    await consolePanel.getByRole('searchbox', { name: 'Filter Console messages' }).fill('human-console')
    await consolePanel.getByRole('combobox', { name: 'Filter Console by level' }).selectOption('warning')
    await expect(consolePanel).toContainText('human-console-warning')
    await expect(consolePanel.getByText('×3', { exact: true })).toBeVisible()
    await expect(consolePanel).not.toContainText('human-console-info')
    const warningStack = consolePanel.getByText('Call stack', { exact: false })
    await expect(warningStack).toBeVisible()
    await warningStack.click()
    await expect(consolePanel).toContainText('innerConsoleWarning')
    await expect(consolePanel).toContainText('outerConsoleWarning')

    const copyConsoleEntry = consolePanel.getByRole('button', { name: 'Copy Console entry' })
    await copyConsoleEntry.click()
    await expect(copyConsoleEntry).toContainText('Copied')
    const copiedConsoleEntry = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copiedConsoleEntry)).toMatchObject({
      tabId,
      scope: 'entry',
      messages: [expect.objectContaining({
        repeatCount: 3,
        stack: expect.arrayContaining([
          expect.objectContaining({ functionName: 'innerConsoleWarning' }),
          expect.objectContaining({ functionName: 'outerConsoleWarning' })
        ])
      })]
    })
    expect(copiedConsoleEntry).not.toContain('human-console-secret')

    await consolePanel.getByRole('button', { name: 'Copy all' }).click()
    await expect(consolePanel.getByRole('button', { name: 'Copied all' })).toBeVisible()
    const copiedAllConsole = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copiedAllConsole)).toMatchObject({ tabId, scope: 'all' })
    expect(copiedAllConsole).toContain('human-console-warning')
    expect(copiedAllConsole).toContain('human-console-info')
    expect(copiedAllConsole).not.toContain('human-console-secret')

    await consolePanel.getByRole('button', { name: 'Copy filtered' }).click()
    await expect(consolePanel.getByRole('button', { name: 'Copied filtered' })).toBeVisible()
    const copiedConsole = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copiedConsole)).toMatchObject({ tabId, scope: 'filtered', filter: { query: 'human-console', level: 'warning' } })
    expect(JSON.parse(copiedConsole)).toMatchObject({ messages: [expect.objectContaining({ repeatCount: 3 })] })
    expect(copiedConsole).toContain('human-console-warning')
    expect(copiedConsole).not.toContain('human-console-secret')
    expect(copiedConsole).not.toContain('console-url-secret')
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const ukrainianConsolePanel = appWindow.getByRole('dialog', { name: 'Консоль' })
    await expect(ukrainianConsolePanel).toContainText('Попередження')
    await expect(ukrainianConsolePanel.getByRole('searchbox', { name: 'Фільтрувати повідомлення консолі' })).toHaveValue('human-console')
    await ukrainianConsolePanel.getByRole('button', { name: 'Очистити' }).click()
    await expect(ukrainianConsolePanel).toContainText('Повідомлень консолі ще немає')
    await ukrainianConsolePanel.getByRole('button', { name: 'Закрити консоль' }).click()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

    await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(tabId)
    const startedRepro = await client.callTool({
      name: 'browser_repro',
      arguments: { tabId, action: 'start' }
    }) as CallToolResult
    expect(startedRepro.isError, text(startedRepro)).not.toBe(true)
    expect(JSON.parse(text(startedRepro))).toMatchObject({ tabId, active: true, stepCount: 1 })
    await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      const view = BrowserWindow.getAllWindows()
        .flatMap((window) => window.contentView.children)
        .find((candidate): candidate is InstanceType<typeof WebContentsView> => (
          candidate instanceof WebContentsView && candidate.webContents.getTitle() === 'Capability fixture'
      ))
      if (!view) throw new Error('Active repro recorder fixture view disappeared')
      view.webContents.focus()
      await view.webContents.executeJavaScript("document.querySelector('#name').focus()")
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S' })
      view.webContents.sendInputEvent({ type: 'char', keyCode: 'S' })
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S' })
      const point = await view.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#hover').getBoundingClientRect();
        return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
      })()`) as { x: number; y: number }
      view.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      view.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      view.webContents.sendInputEvent({ type: 'mouseWheel', x: point.x, y: point.y, deltaY: -120, canScroll: true })
    })
    await expect.poll(async () => {
      const current = await client.callTool({ name: 'browser_repro', arguments: { tabId, action: 'get' } }) as CallToolResult
      return (JSON.parse(text(current)) as { steps: Array<{ kind: string }> }).steps.map((step) => step.kind)
    }).toEqual(expect.arrayContaining(['navigate', 'input', 'click']))
    const stoppedRepro = await client.callTool({
      name: 'browser_repro',
      arguments: { tabId, action: 'stop' }
    }) as CallToolResult
    expect(stoppedRepro.isError, text(stoppedRepro)).not.toBe(true)
    const repro = JSON.parse(text(stoppedRepro)) as {
      active: boolean
      stepCount: number
      steps: Array<{ kind: string; description: string; valueRedacted?: boolean }>
    }
    expect(repro.active).toBe(false)
    expect(repro.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'navigate' }),
      expect.objectContaining({ kind: 'input', valueRedacted: true }),
      expect.objectContaining({ kind: 'click' })
    ]))
    expect(text(stoppedRepro)).not.toContain('"key":"S"')
    const playwrightRepro = await client.callTool({
      name: 'browser_repro',
      arguments: { tabId, action: 'get', format: 'playwright' }
    }) as CallToolResult
    expect(playwrightRepro.isError, text(playwrightRepro)).not.toBe(true)
    expect(text(playwrightRepro)).toContain("import { test } from '@playwright/test'")
    expect(text(playwrightRepro)).toContain('process.env.HRONAUT_REPRO_INPUT_')
    expect(text(playwrightRepro)).toContain('.click()')
    expect(text(playwrightRepro)).not.toContain('"key":"S"')
    await openPageTool(/Repro recorder:/)
    const reproPanel = appWindow.getByRole('dialog', { name: 'Repro recorder' })
    await expect(reproPanel).toBeVisible()
    await expect(reproPanel).toContainText('Typed values, clipboard contents')
    await reproPanel.getByRole('button', { name: 'Copy timeline' }).click()
    await expect(reproPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copiedRepro = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copiedRepro)).toMatchObject({ tabId, active: false, stepCount: repro.stepCount })
    expect(copiedRepro).not.toContain('"key":"S"')
    await reproPanel.getByRole('button', { name: 'Copy Playwright' }).click()
    await expect(reproPanel.getByRole('button', { name: 'Copied Playwright' })).toBeVisible()
    const copiedPlaywright = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(copiedPlaywright).toContain("import { test } from '@playwright/test'")
    expect(copiedPlaywright).toContain('process.env.HRONAUT_REPRO_INPUT_')
    expect(copiedPlaywright).toContain('.click()')
    expect(copiedPlaywright).not.toContain('"key":"S"')
    await reproPanel.getByRole('button', { name: 'Close repro recorder' }).click()

    const startedDomChanges = await client.callTool({
      name: 'browser_dom_changes',
      arguments: { tabId, action: 'start' }
    }) as CallToolResult
    expect(startedDomChanges.isError, text(startedDomChanges)).not.toBe(true)
    expect(JSON.parse(text(startedDomChanges))).toMatchObject({ tabId, active: true, changeCount: 0 })
    const changedDom = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(() => {
          const marker = document.createElement('aside');
          marker.id = 'dom-secret-id';
          marker.className = 'dom-secret-class';
          marker.setAttribute('data-state', 'dom-secret-attribute-value');
          marker.textContent = 'dom-secret-text';
          document.body.append(marker);
          marker.setAttribute('aria-live', 'polite');
          marker.firstChild.data = 'dom-secret-updated-text';
          marker.remove();
          return true;
        })()`
      }
    }) as CallToolResult
    expect(changedDom.isError, text(changedDom)).not.toBe(true)
    const stoppedDomChanges = await client.callTool({
      name: 'browser_dom_changes',
      arguments: { tabId, action: 'stop' }
    }) as CallToolResult
    expect(stoppedDomChanges.isError, text(stoppedDomChanges)).not.toBe(true)
    const domChangesText = text(stoppedDomChanges)
    const domChanges = JSON.parse(domChangesText) as {
      active: boolean
      changeCount: number
      entries: Array<{ kind: string; target: string; attributeName?: string }>
    }
    expect(domChanges.active).toBe(false)
    expect(domChanges.changeCount).toBeGreaterThanOrEqual(4)
    expect(domChanges.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'child-list' }),
      expect.objectContaining({ kind: 'attributes', attributeName: 'aria-live' }),
      expect.objectContaining({ kind: 'text' })
    ]))
    for (const secret of ['dom-secret-id', 'dom-secret-class', 'dom-secret-attribute-value', 'dom-secret-text', 'dom-secret-updated-text']) {
      expect(domChangesText).not.toContain(secret)
    }
    await openPageTool(/DOM changes:/)
    const domChangesPanel = appWindow.getByRole('dialog', { name: 'DOM changes' })
    await expect(domChangesPanel).toBeVisible()
    await expect(domChangesPanel).toContainText('Text, HTML, attribute values, IDs, classes, and form values are never recorded.')
    await domChangesPanel.getByRole('button', { name: 'Copy report' }).click()
    await expect(domChangesPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copiedDomChanges = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copiedDomChanges)).toMatchObject({ tabId, active: false, changeCount: domChanges.changeCount })
    expect(copiedDomChanges).not.toContain('dom-secret')
    await domChangesPanel.getByRole('button', { name: 'Close DOM changes' }).click()

    const visualBaselineResult = await client.callTool({
      name: 'browser_visual_compare',
      arguments: { tabId, action: 'set-baseline', settleMs: 0 }
    }) as CallToolResult
    expect(visualBaselineResult.isError, text(visualBaselineResult)).not.toBe(true)
    expect(JSON.parse(text(visualBaselineResult))).toMatchObject({
      tabId,
      status: 'baseline',
      baseline: { width: expect.any(Number), height: expect.any(Number) }
    })
    expect(visualBaselineResult.content.some((item) => item.type === 'image')).toBe(false)
    const visualMutationResult = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(() => {
          const marker = document.createElement('div');
          marker.id = 'visual-compare-marker';
          marker.textContent = 'Changed';
          Object.assign(marker.style, {
            position: 'fixed', right: '24px', bottom: '24px', width: '180px', height: '100px',
            background: '#ff00aa', color: '#fff', zIndex: '2147483647'
          });
          document.body.append(marker);
          return true;
        })()`
      }
    }) as CallToolResult
    expect(visualMutationResult.isError, text(visualMutationResult)).not.toBe(true)
    const visualCompareResult = await client.callTool({
      name: 'browser_visual_compare',
      arguments: { tabId, action: 'compare', settleMs: 100 }
    }) as CallToolResult
    expect(visualCompareResult.isError, text(visualCompareResult)).not.toBe(true)
    const visualReport = JSON.parse(text(visualCompareResult)) as {
      status: string
      changedPixels: number
      changedPercent: number
      diffBounds?: { width: number; height: number }
    }
    expect(visualReport.status).toBe('compared')
    expect(visualReport.changedPixels).toBeGreaterThan(10_000)
    expect(visualReport.changedPercent).toBeGreaterThan(0)
    expect(visualReport.diffBounds).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
    const visualDiff = visualCompareResult.content.find((item) => item.type === 'image')
    expect(visualDiff?.type === 'image' ? Buffer.from(visualDiff.data, 'base64').subarray(0, 8) : Buffer.alloc(0)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
    await openPageTool(/Visual compare:/)
    const visualPanel = appWindow.getByRole('dialog', { name: 'Visual compare' })
    await expect(visualPanel).toBeVisible()
    await expect(visualPanel).toContainText('% of pixels changed')
    await expect(visualPanel.getByRole('img', { name: /Visual difference/ })).toBeVisible()
    await visualPanel.getByRole('button', { name: 'Copy diff PNG' }).click()
    await expect(visualPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copiedVisualDiff = await electronApp.evaluate(({ clipboard }) => {
      const image = clipboard.readImage()
      return { empty: image.isEmpty(), size: image.getSize(), signature: [...image.toPNG().subarray(0, 8)] }
    })
    expect(copiedVisualDiff).toMatchObject({
      empty: false,
      size: { width: expect.any(Number), height: expect.any(Number) },
      signature: [137, 80, 78, 71, 13, 10, 26, 10]
    })
    await visualPanel.getByRole('button', { name: 'Close visual compare' }).click()

    const openedIssuesTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/issues`, active: true }
    }) as CallToolResult
    const issueTabId = JSON.parse(text(openedIssuesTab)).activeTabId as string
    await client.callTool({ name: 'browser_wait', arguments: { tabId: issueTabId } })
    const inspectorIssuesResult = await client.callTool({
      name: 'browser_issues',
      arguments: { tabId: issueTabId, action: 'list' }
    }) as CallToolResult
    expect(inspectorIssuesResult.isError, text(inspectorIssuesResult)).not.toBe(true)
    const inspectorIssues = JSON.parse(text(inspectorIssuesResult)) as {
      issueCount: number
      issues: Array<{ code: string; reasons: string[] }>
    }
    expect(inspectorIssues.issueCount).toBeGreaterThan(0)
    expect(inspectorIssues.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'QuirksModeIssue' })
    ]))
    expect(text(inspectorIssuesResult)).not.toContain('server-secret')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageToolsWithIssues = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(pageToolsWithIssues.getByRole('button', { name: /Open browser issues:/ })).toContainText('browser issue')
    await pageToolsWithIssues.getByRole('button', { name: /Open browser issues:/ }).click()
    const inspectorIssuesPanel = appWindow.getByRole('dialog', { name: 'Issues' })
    await expect(inspectorIssuesPanel).toBeVisible()
    await expect(inspectorIssuesPanel.getByRole('combobox', { name: 'Dock browser issues' })).toHaveValue('right')
    await expect(inspectorIssuesPanel).toContainText('Page rendered in quirks mode')
    await inspectorIssuesPanel.getByRole('button', { name: 'Copy issues' }).click()
    await expect(inspectorIssuesPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copiedInspectorIssues = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copiedInspectorIssues)).toMatchObject({ tabId: issueTabId, issueCount: expect.any(Number) })
    expect(copiedInspectorIssues).not.toContain('server-secret')
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    const ukrainianIssuesPanel = appWindow.getByRole('dialog', { name: 'Проблеми' })
    await expect(ukrainianIssuesPanel).toContainText('Задіяні ресурси')
    await ukrainianIssuesPanel.getByRole('button', { name: 'Очистити' }).click()
    await expect(ukrainianIssuesPanel).toContainText('Проблем браузера не зібрано')
    await ukrainianIssuesPanel.getByRole('button', { name: 'Закрити проблеми браузера' }).click()
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
    await client.callTool({ name: 'browser_close_tab', arguments: { tabId: issueTabId } })
    await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

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

    const seededEmulation = await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId, colorScheme: 'dark' }
    }) as CallToolResult
    expect(JSON.parse(text(seededEmulation))).toMatchObject({ colorScheme: 'dark' })
    await openPageTool('Responsive preview: Test phones, tablets, and desktops')
    const responsivePanel = appWindow.getByRole('dialog', { name: 'Responsive preview' })
    await expect(responsivePanel).toBeVisible()
    await responsivePanel.getByRole('button', { name: /^Tablet/ }).click()
    await responsivePanel.getByRole('button', { name: 'Landscape' }).click()
    await responsivePanel.getByRole('button', { name: 'Apply preview' }).click()
    await expect(responsivePanel).toContainText('Viewport applied')
    const humanResponsiveState = await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId }
    }) as CallToolResult
    expect(JSON.parse(text(humanResponsiveState))).toMatchObject({
      colorScheme: 'dark',
      viewport: {
        width: 1024,
        height: 768,
        deviceScaleFactor: 2,
        mobile: true,
        touch: true,
        orientation: 'landscape'
      }
    })
    const resetResponsiveViewport = responsivePanel.getByRole('button', { name: 'Reset viewport' })
    await resetResponsiveViewport.click()
    await expect.poll(async () => {
      const result = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
      return JSON.parse(text(result)).viewport ?? null
    }).toBeNull()
    const afterHumanReset = JSON.parse(text(await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId }
    }) as CallToolResult))
    expect(afterHumanReset).toMatchObject({ colorScheme: 'dark' })
    expect(afterHumanReset.viewport).toBeUndefined()
    await responsivePanel.getByRole('button', { name: 'Close responsive preview' }).click()

    const presetEmulation = await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId, viewportPreset: 'compact-phone', viewportOrientation: 'landscape' }
    }) as CallToolResult
    expect(presetEmulation.isError, text(presetEmulation)).not.toBe(true)
    expect(JSON.parse(text(presetEmulation))).toMatchObject({
      colorScheme: 'dark',
      viewport: {
        width: 800,
        height: 360,
        deviceScaleFactor: 2,
        mobile: true,
        touch: true,
        orientation: 'landscape'
      }
    })
    const ambiguousViewport = await client.callTool({
      name: 'browser_emulate',
      arguments: {
        tabId,
        viewportPreset: 'phone',
        viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' }
      }
    }) as CallToolResult
    expect(ambiguousViewport.isError).toBe(true)
    expect(text(ambiguousViewport)).toContain('cannot be combined')

    const emulated = await client.callTool({
      name: 'browser_emulate',
      arguments: {
        tabId,
        network: 'slow-4g',
        dataSaver: 'enabled',
        cpuThrottlingRate: 4,
        animationPlaybackRate: 0,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        mediaType: 'print',
        forcedColors: 'active',
        contrast: 'more',
        reducedTransparency: 'reduce',
        visionDeficiency: 'deuteranopia',
        userAgent: 'Hronaut Emulation Test/1.0',
        locale: 'fr-CA',
        timezoneId: 'America/Toronto',
        viewport: {
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
          mobile: true,
          touch: true,
          orientation: 'portrait'
        },
        geolocation: { latitude: 50.4501, longitude: 30.5234, accuracy: 25 },
        renderingDebug: {
          paintFlashing: true,
          layoutShiftRegions: true,
          layerBorders: true,
          fpsCounter: true,
          scrollBottlenecks: true
        },
        extraHttpHeaders: { 'X-Hronaut-Test': 'device-emulation' }
      }
    }) as CallToolResult
    expect(emulated.isError, text(emulated)).not.toBe(true)
    expect(JSON.parse(text(emulated))).toEqual({
      network: 'slow-4g',
      cacheDisabled: false,
      bypassServiceWorker: false,
      dataSaver: 'enabled',
      cpuThrottlingRate: 4,
      animationPlaybackRate: 0,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      mediaType: 'print',
      forcedColors: 'active',
      contrast: 'more',
      reducedTransparency: 'reduce',
      visionDeficiency: 'deuteranopia',
      userAgent: 'Hronaut Emulation Test/1.0',
      locale: 'fr-CA',
      timezoneId: 'America/Toronto',
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
        touch: true,
        orientation: 'portrait'
      },
      geolocation: { latitude: 50.4501, longitude: 30.5234, accuracy: 25 },
      renderingDebug: {
        paintFlashing: true,
        layoutShiftRegions: true,
        layerBorders: true,
        fpsCounter: true,
        scrollBottlenecks: true
      },
      extraHttpHeaderNames: ['X-Hronaut-Test']
    })
    const pausedAnimation = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => {
          const animation = document.querySelector('#animation-probe').getAnimations()[0];
          const before = animation.currentTime;
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { before, after: animation.currentTime };
        })()`
      }
    }) as CallToolResult
    const pausedAnimationTimes = JSON.parse(text(pausedAnimation)) as { before: number; after: number }
    expect(Math.abs(pausedAnimationTimes.after - pausedAnimationTimes.before)).toBeLessThan(1)
    const emulationState = await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId }
    }) as CallToolResult
    expect(JSON.parse(text(emulationState))).toEqual(JSON.parse(text(emulated)))
    const emulatedPage = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => ({
          userAgent: navigator.userAgent,
          online: navigator.onLine,
          saveData: navigator.connection?.saveData ?? null,
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          print: matchMedia('print').matches,
          forcedColors: matchMedia('(forced-colors: active)').matches,
          moreContrast: matchMedia('(prefers-contrast: more)').matches,
          reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
          locale: new Intl.NumberFormat().resolvedOptions().locale,
          timezoneId: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, touchPoints: navigator.maxTouchPoints },
          location: await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
            ({ message }) => reject(new Error(message))
          )),
          header: await fetch('/headers').then((response) => response.json())
        }))()`
      }
    }) as CallToolResult
    expect(JSON.parse(text(emulatedPage))).toEqual({
      userAgent: 'Hronaut Emulation Test/1.0',
      online: true,
      saveData: true,
      dark: true,
      reducedMotion: true,
      print: true,
      forcedColors: true,
      moreContrast: true,
      reducedTransparency: true,
      locale: 'fr-CA',
      timezoneId: 'America/Toronto',
      viewport: { width: 390, height: 844, devicePixelRatio: 3, touchPoints: 5 },
      location: { latitude: 50.4501, longitude: 30.5234, accuracy: 25 },
      header: { marker: 'device-emulation', language: expect.any(String) }
    })
    const emulationResetButton = appWindow.getByRole('button', { name: /^Reset tab emulation:/ })
    await expect(emulationResetButton).toContainText('Slow 4G')
    await expect(emulationResetButton).toHaveAttribute('aria-label', /390×844 at 3× mobile touch portrait viewport/)
    await expect(appWindow.locator('.tab-emulation-mark')).toHaveCount(1)
    const listedEmulation = await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult
    const emulatedTabs = JSON.parse(text(listedEmulation)) as Array<{
      id: string
      emulation?: { network: string; cpuThrottlingRate: number }
    }>
    expect(emulatedTabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tabId, emulation: expect.objectContaining({ network: 'slow-4g', cpuThrottlingRate: 4 }) })
    ]))
    expect(text(listedEmulation)).not.toContain('device-emulation')
    expect(emulatedTabs.find((tab) => tab.id === reopenedHistoryTab.id)?.emulation).toBeUndefined()
    const isolatedUserAgent = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId: reopenedHistoryTab.id, script: 'navigator.userAgent' }
    }) as CallToolResult
    expect(text(isolatedUserAgent)).not.toContain('Hronaut Emulation Test')
    await client.callTool({
      name: 'browser_memory',
      arguments: { tabId, action: 'set-baseline', collectGarbage: true }
    })
    await client.callTool({ name: 'browser_history', arguments: { action: 'reload', tabId } })
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    const memoryAfterReload = await client.callTool({
      name: 'browser_memory',
      arguments: { tabId, action: 'measure', collectGarbage: true }
    }) as CallToolResult
    const memoryAfterReloadReport = JSON.parse(text(memoryAfterReload))
    expect(memoryAfterReloadReport.current).toBeDefined()
    expect(memoryAfterReloadReport.baseline).toBeUndefined()
    expect(memoryAfterReloadReport.delta).toBeUndefined()
    const persistedEmulation = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => ({
          userAgent: navigator.userAgent,
          saveData: navigator.connection?.saveData ?? null,
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          print: matchMedia('print').matches,
          forcedColors: matchMedia('(forced-colors: active)').matches,
          moreContrast: matchMedia('(prefers-contrast: more)').matches,
          reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
          locale: navigator.language,
          locales: navigator.languages,
          timezoneId: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          width: innerWidth,
          devicePixelRatio,
          touchPoints: navigator.maxTouchPoints,
          header: await fetch('/headers').then((response) => response.json())
        }))()`
      }
    }) as CallToolResult
    expect(JSON.parse(text(persistedEmulation))).toEqual({
      userAgent: 'Hronaut Emulation Test/1.0',
      saveData: true,
      dark: true,
      reducedMotion: true,
      print: true,
      forcedColors: true,
      moreContrast: true,
      reducedTransparency: true,
      locale: 'fr-CA',
      locales: expect.arrayContaining(['fr-CA']),
      timezoneId: 'America/Toronto',
      width: 390,
      devicePixelRatio: 3,
      touchPoints: 5,
      header: { marker: 'device-emulation', language: expect.stringContaining('fr-CA') }
    })
    const pausedAnimationAfterReload = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => {
          const animation = document.querySelector('#animation-probe').getAnimations()[0];
          const before = animation.currentTime;
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { before, after: animation.currentTime };
        })()`
      }
    }) as CallToolResult
    const pausedAfterReloadTimes = JSON.parse(text(pausedAnimationAfterReload)) as { before: number; after: number }
    expect(Math.abs(pausedAfterReloadTimes.after - pausedAfterReloadTimes.before)).toBeLessThan(1)

    await client.callTool({
      name: 'browser_network_routes',
      arguments: { action: 'add', tabId, urlPattern: routePattern, times: 3, abort: 'Failed' }
    })
    await expect(appWindow.getByRole('button', { name: 'Open 1 temporary request condition' })).toBeVisible()
    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(true)
    const routesAfterDevTools = await client.callTool({
      name: 'browser_network_routes',
      arguments: { action: 'list', tabId }
    }) as CallToolResult
    expect(JSON.parse(text(routesAfterDevTools))).toEqual([])
    await expect(appWindow.locator('.network-routes-pill')).toHaveCount(0)
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
      return webContents.getAllWebContents().some((contents) => (
        contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
      ))
    }, fixtureOrigin)).toBe(true)
    const evaluateWithDevTools = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: 'document.title' }
    }) as CallToolResult
    expect(text(evaluateWithDevTools)).toBe('Capability fixture')
    const debuggerActionWithDevTools = await client.callTool({
      name: 'browser_resize',
      arguments: { tabId, width: 400, height: 600 }
    }) as CallToolResult
    expect(debuggerActionWithDevTools.isError).toBe(true)
    expect(text(debuggerActionWithDevTools)).toContain('Close Developer Tools')
    expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(false)
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
      return webContents.getAllWebContents().some((contents) => (
        contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
      ))
    }, fixtureOrigin)).toBe(false)

    await expect.poll(async () => {
      const result = await client.callTool({
        name: 'browser_evaluate',
        arguments: {
          tabId,
          script: `navigator.userAgent + '|' + matchMedia('(prefers-color-scheme: dark)').matches`
        }
      }) as CallToolResult
      return text(result)
    }).toBe('Hronaut Emulation Test/1.0|true')

    await openPageTool(/Environment: 20 active conditions/)
    const environmentPanel = appWindow.getByRole('dialog', { name: 'Environment' })
    await expect(environmentPanel).toBeVisible()
    await expect(environmentPanel.getByRole('combobox', { name: 'Dock Environment' })).toHaveValue('right')
    await expect(environmentPanel.getByLabel('Network', { exact: true })).toHaveValue('slow-4g')
    await expect(environmentPanel.getByLabel('Data Saver')).toHaveValue('enabled')
    await expect(environmentPanel.getByLabel('CPU')).toHaveValue('4')
    await expect(environmentPanel.getByLabel('Animation playback')).toHaveValue('0')
    await expect(environmentPanel.getByLabel('Color scheme')).toHaveValue('dark')
    await expect(environmentPanel.getByLabel('Motion')).toHaveValue('reduce')
    await expect(environmentPanel.getByLabel('Media type')).toHaveValue('print')
    await expect(environmentPanel.getByLabel('Forced colors')).toHaveValue('active')
    await expect(environmentPanel.getByLabel('Contrast')).toHaveValue('more')
    await expect(environmentPanel.getByLabel('Transparency')).toHaveValue('reduce')
    await expect(environmentPanel.getByLabel('Vision simulation')).toHaveValue('deuteranopia')
    await expect(environmentPanel.getByLabel('Paint flashing')).toBeChecked()
    await expect(environmentPanel.getByLabel('Layout shift regions')).toBeChecked()
    await expect(environmentPanel.getByLabel('Layer borders')).toBeChecked()
    await expect(environmentPanel.getByLabel('Frame rendering stats')).toBeChecked()
    await expect(environmentPanel.getByLabel('Scrolling performance issues')).toBeChecked()
    await expect(environmentPanel).toContainText('These diagnostics can flash rapidly')
    await expect(environmentPanel.getByLabel('Locale')).toHaveValue('fr-CA')
    await expect(environmentPanel.getByLabel('Time zone')).toHaveValue('America/Toronto')
    await expect(environmentPanel.getByLabel('Disable JavaScript')).not.toBeChecked()
    await expect(environmentPanel.getByLabel(/Custom user agent/)).toHaveValue('Hronaut Emulation Test/1.0')
    await expect(environmentPanel.getByLabel(/Override geolocation/)).toBeChecked()
    await expect(environmentPanel).toContainText('390×844 viewport')
    await expect(environmentPanel).toContainText('1 agent-set request header')
    await expect(environmentPanel).toContainText('X-Hronaut-Test')

    await environmentPanel.getByLabel('Network', { exact: true }).selectOption('fast-4g')
    await environmentPanel.getByLabel('Data Saver').selectOption('disabled')
    await environmentPanel.getByLabel('CPU').selectOption('6')
    await environmentPanel.getByLabel('Animation playback').selectOption('0.25')
    await environmentPanel.getByLabel('Color scheme').selectOption('light')
    await environmentPanel.getByLabel('Motion').selectOption('no-preference')
    await environmentPanel.getByLabel('Media type').selectOption('screen')
    await environmentPanel.getByLabel('Forced colors').selectOption('none')
    await environmentPanel.getByLabel('Contrast').selectOption('less')
    await environmentPanel.getByLabel('Transparency').selectOption('no-preference')
    await environmentPanel.getByLabel('Vision simulation').selectOption('protanopia')
    await environmentPanel.getByLabel('Paint flashing').uncheck()
    await environmentPanel.getByLabel('Layout shift regions').uncheck()
    await environmentPanel.getByLabel('Layer borders').uncheck()
    await environmentPanel.getByLabel('Frame rendering stats').uncheck()
    await environmentPanel.getByLabel('Scrolling performance issues').uncheck()
    await environmentPanel.getByLabel('Frame rendering stats').check()
    await environmentPanel.getByLabel('Locale').fill('de-DE')
    await environmentPanel.getByLabel('Time zone').fill('Asia/Tokyo')
    await environmentPanel.getByLabel(/Custom user agent/).fill('Hronaut Human Environment/1.0')
    await environmentPanel.getByLabel(/Override geolocation/).uncheck()
    await environmentPanel.getByRole('button', { name: 'Apply & reload' }).click()
    await expect(environmentPanel.locator('.environment-status')).toContainText('Environment applied')
    await expect.poll(async () => {
      const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
      return JSON.parse(text(current))
    }).toMatchObject({
      network: 'fast-4g',
      dataSaver: 'disabled',
      cpuThrottlingRate: 6,
      animationPlaybackRate: 0.25,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      mediaType: 'screen',
      forcedColors: 'none',
      contrast: 'less',
      reducedTransparency: 'no-preference',
      visionDeficiency: 'protanopia',
      userAgent: 'Hronaut Human Environment/1.0',
      locale: 'de-DE',
      timezoneId: 'Asia/Tokyo',
      renderingDebug: {
        paintFlashing: false,
        layoutShiftRegions: false,
        layerBorders: false,
        fpsCounter: true,
        scrollBottlenecks: false
      },
      viewport: { width: 390, height: 844 },
      extraHttpHeaderNames: ['X-Hronaut-Test']
    })
    const humanEnvironmentState = JSON.parse(text(await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId }
    }) as CallToolResult))
    expect(humanEnvironmentState.geolocation).toBeUndefined()
    await expect.poll(async () => {
      const result = await client.callTool({
        name: 'browser_evaluate',
        arguments: {
          tabId,
          script: `(async () => ({
            userAgent: navigator.userAgent,
            saveData: navigator.connection?.saveData ?? null,
            light: matchMedia('(prefers-color-scheme: light)').matches,
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            screen: matchMedia('screen').matches,
            forcedColorsNone: matchMedia('(forced-colors: none)').matches,
            lessContrast: matchMedia('(prefers-contrast: less)').matches,
            reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
            locale: navigator.language,
            timezoneId: new Intl.DateTimeFormat().resolvedOptions().timeZone,
            header: await fetch('/headers').then((response) => response.json())
          }))()`
        }
      }) as CallToolResult
      return JSON.parse(text(result))
    }).toEqual({
      userAgent: 'Hronaut Human Environment/1.0',
      saveData: false,
      light: true,
      reducedMotion: false,
      screen: true,
      forcedColorsNone: true,
      lessContrast: true,
      reducedTransparency: false,
      locale: 'de-DE',
      timezoneId: 'Asia/Tokyo',
      header: { marker: 'device-emulation', language: expect.stringContaining('de-DE') }
    })
    await environmentPanel.getByRole('button', { name: 'Reset environment' }).click()
    await expect.poll(async () => {
      const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
      return JSON.parse(text(current))
    }).toEqual({
      network: 'none',
      cacheDisabled: false,
      bypassServiceWorker: false,
      dataSaver: 'auto',
      cpuThrottlingRate: 1,
      animationPlaybackRate: 1,
      colorScheme: 'auto',
      reducedMotion: 'auto',
      mediaType: 'auto',
      forcedColors: 'auto',
      contrast: 'auto',
      reducedTransparency: 'auto',
      visionDeficiency: 'none',
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
        touch: true,
        orientation: 'portrait'
      },
      extraHttpHeaderNames: ['X-Hronaut-Test']
    })
    await environmentPanel.getByRole('button', { name: 'Close Environment' }).click()

    const disabledJavaScript = await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId, javaScriptDisabled: true }
    }) as CallToolResult
    expect(JSON.parse(text(disabledJavaScript))).toMatchObject({ javaScriptDisabled: true })
    await client.callTool({
      name: 'browser_navigate',
      arguments: { tabId, url: `${fixtureOrigin}/no-js` }
    })
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    const disabledJavaScriptTabs = JSON.parse(text(await client.callTool({
      name: 'browser_tabs',
      arguments: {}
    }) as CallToolResult)) as Array<{ id: string; title: string }>
    expect(disabledJavaScriptTabs.find((candidate) => candidate.id === tabId)?.title).toBe('Static fallback')

    await openPageTool(/Environment: 1 active condition/)
    const disabledJavaScriptPanel = appWindow.getByRole('dialog', { name: 'Environment' })
    await expect(disabledJavaScriptPanel.getByLabel('Disable JavaScript')).toBeChecked()
    await disabledJavaScriptPanel.getByLabel('Disable JavaScript').uncheck()
    await disabledJavaScriptPanel.getByRole('button', { name: 'Apply & reload' }).click()
    await expect.poll(async () => {
      const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
      return JSON.parse(text(current)).javaScriptDisabled ?? false
    }).toBe(false)
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    const restoredJavaScriptSnapshot = await client.callTool({
      name: 'browser_snapshot',
      arguments: { tabId }
    }) as CallToolResult
    expect(text(restoredJavaScriptSnapshot)).toContain('JavaScript enhanced')
    await disabledJavaScriptPanel.getByRole('button', { name: 'Close Environment' }).click()
    await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureOrigin } })
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })

    const offline = await client.callTool({
      name: 'browser_emulate',
      arguments: { tabId, network: 'offline' }
    }) as CallToolResult
    expect(JSON.parse(text(offline))).toMatchObject({ network: 'offline' })
    const offlinePage = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => ({
          online: navigator.onLine,
          fetchFailed: await fetch('/api').then(() => false, () => true)
        }))()`
      }
    }) as CallToolResult
    expect(JSON.parse(text(offlinePage))).toEqual({ online: false, fetchFailed: true })
    await expect(emulationResetButton).toContainText('Offline')
    await emulationResetButton.click()
    await expect(emulationResetButton).toHaveCount(0)
    await expect(appWindow.locator('.tab-emulation-mark')).toHaveCount(0)
    const resetEmulation = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    expect(JSON.parse(text(resetEmulation))).toEqual({
      network: 'none',
      cacheDisabled: false,
      bypassServiceWorker: false,
      dataSaver: 'auto',
      cpuThrottlingRate: 1,
      animationPlaybackRate: 1,
      colorScheme: 'auto',
      reducedMotion: 'auto',
      mediaType: 'auto',
      forcedColors: 'auto',
      contrast: 'auto',
      reducedTransparency: 'auto',
      visionDeficiency: 'none'
    })
    const resetPage = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => ({
          online: navigator.onLine,
          userAgent: navigator.userAgent,
          width: innerWidth,
          touchPoints: navigator.maxTouchPoints,
          header: await fetch('/headers').then((response) => response.json())
        }))()`
      }
    }) as CallToolResult
    expect(JSON.parse(text(resetPage))).toMatchObject({ online: true })
    expect(JSON.parse(text(resetPage)).userAgent).not.toContain('Hronaut Emulation Test')
    expect(JSON.parse(text(resetPage)).width).toBeGreaterThan(390)
    expect(JSON.parse(text(resetPage)).touchPoints).toBe(0)
    expect(JSON.parse(text(resetPage)).header).toEqual({ marker: null, language: expect.any(String) })

    const screenshot = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, fullPage: true }
    }) as CallToolResult
    const image = screenshot.content.find((item) => item.type === 'image')
    expect(image?.type).toBe('image')
    if (image?.type === 'image') expect(image.data.startsWith('iVBOR')).toBe(true)

    const captureSnapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    const captureRef = text(captureSnapshot).match(/\[(e\d+)\] button "Capture this area"/)?.[1]
    if (!captureRef) throw new Error('Targeted screenshot fixture did not receive a snapshot ref')
    const elementScreenshot = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, ref: captureRef }
    }) as CallToolResult
    const elementImage = elementScreenshot.content.find((item) => item.type === 'image')
    expect(elementImage).toMatchObject({ type: 'image', mimeType: 'image/png' })
    if (elementImage?.type === 'image') {
      const png = Buffer.from(elementImage.data, 'base64')
      expect(png.readUInt32BE(16)).toBe(240)
      expect(png.readUInt32BE(20)).toBe(120)
    }
    const regionScreenshot = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, clip: { x: 10, y: 10, width: 160, height: 90 } }
    }) as CallToolResult
    const regionImage = regionScreenshot.content.find((item) => item.type === 'image')
    expect(regionImage).toMatchObject({ type: 'image', mimeType: 'image/png' })
    if (regionImage?.type === 'image') {
      const png = Buffer.from(regionImage.data, 'base64')
      expect(png.readUInt32BE(16)).toBe(160)
      expect(png.readUInt32BE(20)).toBe(90)
    }
    const boundedElementScreenshot = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, selector: '#capture-target', maxWidth: 120 }
    }) as CallToolResult
    const boundedElementImage = boundedElementScreenshot.content.find((item) => item.type === 'image')
    if (boundedElementImage?.type === 'image') {
      const png = Buffer.from(boundedElementImage.data, 'base64')
      expect(png.readUInt32BE(16)).toBe(120)
      expect(png.readUInt32BE(20)).toBe(60)
    }
    const invalidScreenshotScope = await client.callTool({
      name: 'browser_screenshot',
      arguments: { tabId, fullPage: true, selector: '#capture-target' }
    }) as CallToolResult
    expect(invalidScreenshotScope.isError).toBe(true)
    expect(text(invalidScreenshotScope)).toContain('fullPage cannot be combined')

    const firstPdf = await client.callTool({
      name: 'browser_pdf_save',
      arguments: { tabId, filename: 'capability-report.pdf', pageSize: 'A4' }
    }) as CallToolResult
    expect(firstPdf.isError, text(firstPdf)).not.toBe(true)
    const firstPdfResult = JSON.parse(text(firstPdf)) as { filename: string; path: string; bytes: number }
    expect(firstPdfResult).toMatchObject({
      filename: 'capability-report.pdf',
      path: join(profileDirectory, 'capability-report.pdf'),
      bytes: expect.any(Number)
    })
    expect((await readFile(firstPdfResult.path)).subarray(0, 5).toString()).toBe('%PDF-')

    const secondPdf = await client.callTool({
      name: 'browser_pdf_save',
      arguments: { tabId, filename: 'capability-report.pdf', landscape: true }
    }) as CallToolResult
    expect(JSON.parse(text(secondPdf))).toMatchObject({
      filename: 'capability-report (1).pdf',
      path: join(profileDirectory, 'capability-report (1).pdf')
    })
    const invalidPdf = await client.callTool({
      name: 'browser_pdf_save',
      arguments: { tabId, filename: '../outside.pdf' }
    }) as CallToolResult
    expect(invalidPdf.isError).toBe(true)
    expect(text(invalidPdf)).toContain('without a directory path')

    await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#download' } })
    await expect
      .poll(async () => {
        const result = await client.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
        return JSON.parse(text(result)) as Array<{ state: string; filename: string; savePath?: string }>
      })
      .toEqual([
        expect.objectContaining({
          state: 'completed',
          filename: 'capability.txt',
          savePath: join(profileDirectory, 'capability.txt')
        })
      ])

    const activity = await electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Hronaut Home was not found')
      return home.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
    }) as {
      completedToolCalls: number
      recentActivity: Array<{ toolName: string; outcome: string; durationMs: number }>
      toolMetrics: Array<{ toolName: string; count: number }>
    }
    expect(activity.completedToolCalls).toBeGreaterThan(10)
    expect(activity.recentActivity).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'browser_screenshot', outcome: 'finished' })
    ]))
    expect(activity.recentActivity.every((entry) => entry.durationMs >= 0)).toBe(true)
    expect(activity.toolMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'browser_evaluate', count: expect.any(Number) })
    ]))

  } finally {
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
