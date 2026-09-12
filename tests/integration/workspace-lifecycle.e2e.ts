import { createServer } from 'node:http'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { seedWorkspaceProfile } from './workspace-profile.js'

test('preserves isolated site data through rename and archive, then deletes its workspace', async ({ profileDirectory }) => {
  const { workspaceId } = await seedWorkspaceProfile(profileDirectory)
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Workspace data</title>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const url = `http://127.0.0.1:${address.port}/workspace`
  let instance = await launchHronaut(profileDirectory)
  try {
    await instance.window.evaluate(`window.hronaut.newTab({url:${JSON.stringify(url)},mcpGroupId:${JSON.stringify(workspaceId)}})`)
    await expect.poll(() => instance.app.evaluate(({ webContents }, target) => webContents.getAllWebContents().some(entry => entry.getURL() === target), url)).toBe(true)
    await instance.app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url)!
      await contents.session.cookies.set({ url, name: 'workspace-proof', value: 'preserved', httpOnly: true, expirationDate: Math.floor(Date.now() / 1000) + 3600 })
      await contents.executeJavaScript(`localStorage.setItem('workspace-proof', 'preserved'); new Promise((resolve, reject) => {
        const request = indexedDB.open('workspace-proof', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result; const transaction = db.transaction('records', 'readwrite');
          transaction.objectStore('records').put('preserved', 'proof');
          transaction.oncomplete = () => { db.close(); resolve(true); }; transaction.onerror = () => reject(transaction.error);
        };
      })`)
    }, url)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory)
    await instance.window.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(workspaceId)},{name:'My existing profile',agentAccess:false})`)
    await instance.window.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(workspaceId)})`)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory)
    const archived = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
    expect(archived.mcpTabGroups).toEqual([])
    expect(archived.savedTabGroups).toMatchObject([{ id: workspaceId, name: 'My existing profile', agentAccess: false }])
    await instance.window.evaluate(`window.hronaut.restoreSavedTabGroup(${JSON.stringify(workspaceId)})`)
    await expect.poll(() => instance.app.evaluate(({ webContents }, target) => webContents.getAllWebContents().some(entry => entry.getURL() === target), url)).toBe(true)
    const proof = await instance.app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url)!
      return {
        cookies: (await contents.session.cookies.get({})).map(cookie => cookie.value),
        local: await contents.executeJavaScript("localStorage.getItem('workspace-proof')"),
        indexed: await contents.executeJavaScript(`new Promise((resolve, reject) => {
          const request = indexedDB.open('workspace-proof');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => { const db = request.result; const read = db.transaction('records').objectStore('records').get('proof'); read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error); };
        })`)
      }
    }, url)
    expect(proof).toEqual({ cookies: ['preserved'], local: 'preserved', indexed: 'preserved' })
    const removed = await instance.window.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(workspaceId)})`) as BrowserState
    expect(removed.mcpTabGroups).toEqual([])
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory)
    const restarted = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
    expect(restarted.mcpTabGroups).toEqual([])
    expect(restarted.savedTabGroups).toEqual([])
    expect(restarted.tabs.map(tab => tab.url)).toEqual(['hronaut://home/'])
  } finally { await closeHronaut(instance.app); await closeFixtureServer(server) }
})
