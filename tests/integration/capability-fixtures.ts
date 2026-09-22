import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Page } from '@playwright/test'
import { closeFixtureServer, expect, test as base } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

export { expect } from './fixtures.js'

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

export function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

interface CapabilityFixture {
  client: Client
  tabId: string
  address: { port: number }
  fixtureUrl: string
  fixtureOrigin: string
  redactedFixtureUrl: string
  counters: { memorySaverTicks: number; cacheProbeRequests: number }
  openPageTool(name: string | RegExp): Promise<void>
}

async function openPageTool(appWindow: Page, name: string | RegExp): Promise<void> {
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(pageTools).toBeVisible()
  await pageTools.getByRole('button', { name }).click()
}

// Each case gets its own HTTP server, MCP connection, workspace, tab and Electron profile.
// Assertions live in the cases; this fixture only establishes and tears down their prerequisites.
export const test = base.extend<{ capabilities: CapabilityFixture }>({
  capabilities: async ({ appWindow, mcpPort, mcpToken }, use) => {
    const counters = { memorySaverTicks: 0, cacheProbeRequests: 0 }
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
        counters.cacheProbeRequests += 1
        response.writeHead(200, {
          'cache-control': 'public, max-age=3600',
          'content-type': 'application/json'
        })
        response.end(JSON.stringify({ requestCount: counters.cacheProbeRequests }))
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
        counters.memorySaverTicks += 1
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
    const sockets = new Set<Socket>()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    const client = new Client({ name: 'hronaut-capabilities-test', version: '1.0.0' })
    const authorization = `Bearer ${mcpToken}`
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization } }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve())
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a port')
      const fixtureOrigin = `http://127.0.0.1:${address.port}`
      const fixtureUrl = `${fixtureOrigin}/?token=top-level-navigation-secret&view=capabilities`
      const redactedFixtureUrl = `${fixtureOrigin}/?view=capabilities&token=%5BREDACTED%5D`
      await expect.poll(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
        } catch {
          return false
        }
      }).toBe(true)
      await client.connect(transport)
      await useMcpWorkspace(client, 'Capability tests')
      const opened = await client.callTool({
        name: 'browser_new_tab', arguments: { url: fixtureUrl, active: true }
      }) as CallToolResult
      expect(opened.isError, text(opened)).not.toBe(true)
      const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
      await client.callTool({ name: 'browser_wait', arguments: { tabId } })
      await use({
        client, tabId, address, fixtureUrl, fixtureOrigin, redactedFixtureUrl, counters,
        openPageTool: (name) => openPageTool(appWindow, name)
      })
    } finally {
      await client.close().catch(() => undefined)
      // Include upgraded WebSockets: server.closeAllConnections does not close them.
      for (const socket of sockets) socket.destroy()
      await closeFixtureServer(server)
    }
  }
})
