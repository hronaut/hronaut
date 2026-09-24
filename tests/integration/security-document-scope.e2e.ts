import { createServer, type Socket } from 'node:net'
import { expect, test } from './fixtures.js'

test('reports the main HTTP connection after a real iframe uses another protocol version', async ({ appWindow, electronApp }) => {
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.once('data', request => {
      const child = request.toString().startsWith('GET /child ')
      const body = child ? '<title>Child</title>' : '<title>Main</title><iframe src="/child"></iframe>'
      socket.end(`HTTP/1.${child ? '0' : '1'} 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP fixture address is missing')
    const url = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.loading)')).toBe(false)
    // Initial navigation can precede diagnostic attachment. Reload after the
    // native Network domain is enabled, as the report's caveat instructs.
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      await contents.debugger.sendCommand('Network.enable')
      await new Promise<void>(resolve => {
        contents.once('did-stop-loading', resolve)
        contents.reload()
      })
    }, url)
    expect(await appWindow.evaluate('window.hronaut.inspectSecurity()')).toMatchObject({
      url, connection: { protocol: 'http/1.1' }
    })
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('keeps iframe certificates out of the main document security report', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Security scope</title><iframe srcdoc="child"></iframe>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.loading)')).toBe(false)
  const emitResponse = async (child: boolean): Promise<void> => {
    await electronApp.evaluate(async ({ webContents }, { url, child }) => {
      const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      const tree = await contents.debugger.sendCommand('Page.getFrameTree') as {
        frameTree: { frame: { id: string }; childFrames?: Array<{ frame: { id: string } }> }
      }
      const frameId = child ? tree.frameTree.childFrames?.[0]?.frame.id : tree.frameTree.frame.id
      if (!frameId) throw new Error('Native frame fixture is missing')
      const requestId = child ? 'controlled-child-response' : 'controlled-main-response'
      contents.debugger.emit('message', {}, 'Network.requestWillBeSent', {
        requestId, frameId, type: 'Document', request: { url: 'https://example.test/document', method: 'GET' }
      })
      contents.debugger.emit('message', {}, 'Network.responseReceived', {
        requestId, frameId, type: 'Document', response: {
          url: 'https://example.test/document', status: 200, protocol: 'h2', securityState: 'secure',
          securityDetails: { protocol: 'TLS 1.3', issuer: child ? 'Iframe issuer' : 'Main issuer' }
        }
      })
    }, { url, child })
  }
  await emitResponse(false)
  expect(await appWindow.evaluate('window.hronaut.inspectSecurity()')).toMatchObject({ certificate: { issuer: 'Main issuer' } })
  await emitResponse(true)
  expect(await appWindow.evaluate('window.hronaut.inspectSecurity()')).toMatchObject({ certificate: { issuer: 'Main issuer' } })
})
