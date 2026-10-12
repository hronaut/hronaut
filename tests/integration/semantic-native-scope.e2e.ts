import { createServer } from 'node:http'
import { test, expect } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type Scope = typeof globalThis & { __scopeProbe?: { commands: string[]; restore(): void } }
for (const contentType of ['application/xhtml+xml', 'application/xml', 'image/svg+xml']) for (const doubleClick of [false, true]) {
  test(`semantic admission rejects document ${contentType} double=${doubleClick} before page preparation`, async ({ capabilities, electronApp }, info) => {
    const { client, tabId } = capabilities
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': contentType })
      response.end(contentType === 'image/svg+xml'
        ? '<svg xmlns="http://www.w3.org/2000/svg"><rect id="target" width="100" height="100" /></svg>'
        : '<h:html xmlns:h="http://www.w3.org/1999/xhtml"><h:body><h:button id="target">Target</h:button></h:body></h:html>')
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw Error('Missing fixture address')
      const url = `http://127.0.0.1:${address.port}/`
      expect((await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } })).isError).not.toBe(true)
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        await page.executeJavaScript(`window.preparations=0;window.clicks=0;
          document.addEventListener('click',()=>window.clicks++);
          Object.defineProperty(Document.prototype,'contentType',{get(){return 'text/html'}});
          Object.defineProperty(window,'__hronautAgentInputActive',{configurable:true,set(){window.preparations++}});true`)
        const send = page.debugger.sendCommand.bind(page.debugger)
        const probe = { commands: [] as string[], restore: () => { page.debugger.sendCommand = send } }
        ;(globalThis as Scope).__scopeProbe = probe
        page.debugger.sendCommand = async (method, params, session) => {
          if (method === 'Input.dispatchMouseEvent') probe.commands.push(String((params as { type?: string }).type))
          return send(method, params, session)
        }
      }, url)
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', ...(doubleClick ? { doubleClick: true } : { native: true }) } })
      const observed = await electronApp.evaluate(async ({ webContents }, url) => ({
        commands: (globalThis as Scope).__scopeProbe!.commands,
        page: await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('({preparations:window.preparations,clicks:window.clicks})')
      }), url)
      await info.attach('document-scope', { body: JSON.stringify({ result, observed }), contentType: 'application/json' })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', reason: 'TARGET_UNAVAILABLE', progress: { preparationAttempted: true, downAttempted: 0, targetCleanup: 'confirmed' } })
      expect(observed).toEqual({ commands: [], page: { preparations: 0, clicks: 0 } })
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__scopeProbe?.restore(); delete (globalThis as Scope).__scopeProbe })
      await closeFixtureServer(server)
    }
  })
}

for (const variant of ['namespaced-object', 'namespaced-frame', 'fallback', 'deep', 'ordinary']) {
  test(`semantic admission HTML receiver scope ${variant}`, async ({ capabilities, electronApp }, info) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(async ({ webContents }, { url, variant }) => {
      return webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`(() => {
        document.body.innerHTML='';window.clicks=0;
        let target=document.createElement('button');target.textContent='Target';
        if(${JSON.stringify(variant)}==='namespaced-object')target=document.createElementNS('http://www.w3.org/1999/xhtml','h:object');
        if(${JSON.stringify(variant)}==='namespaced-frame')target=document.createElementNS('http://www.w3.org/1999/xhtml','h:iframe');
        target.id='target';target.setAttribute('data-private','receiver-attribute-canary');
        target.setAttribute('style','display:block;box-sizing:border-box;border:0;position:fixed;left:120px;top:120px;width:200px;height:100px');
        let host=target;
        if(${JSON.stringify(variant)}==='fallback'){host=document.createElement('object');host.type='application/x-hronaut-unsupported';host.data='data:application/x-hronaut-unsupported,fixture';host.setAttribute('data-private','host-attribute-canary');host.append(target)}
        if(${JSON.stringify(variant)}==='deep')for(let i=0;i<70;i++){const n=document.createElement('div');n.append(host);host=n}
        document.body.append(host);document.addEventListener('click',()=>window.clicks++);const r=target.getBoundingClientRect();return {hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===target,localName:target.localName,width:r.width,height:r.height};
      })()`)
    }, { url: fixtureUrl, variant })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`(() => {const t=document.getElementById('target'),r=t.getBoundingClientRect();return {hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===t,width:r.width,height:r.height}})()`), fixtureUrl)).toEqual({ hit: true, width: 200, height: 100 })
    const result = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true } })
    const clicks = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('window.clicks'), fixtureUrl)
    await info.attach('receiver-scope', { body: JSON.stringify({ result, clicks }), contentType: 'application/json' })
    expect(JSON.stringify(result)).not.toMatch(/receiver-attribute-canary|host-attribute-canary/)
    expect(result.isError === true).toBe(variant !== 'ordinary')
    expect(clicks).toBe(variant === 'ordinary' ? 1 : 0)
    if (variant !== 'ordinary') expect(result.structuredContent).toMatchObject({ reason: variant === 'deep' ? 'TARGET_UNVERIFIABLE' : 'EMBEDDED_HIT_UNSUPPORTED', progress: { downAttempted: 0, upAttempted: 0, targetCleanup: 'confirmed' } })
  })
}
