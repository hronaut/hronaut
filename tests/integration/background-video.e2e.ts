import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { test, expect, text } from './capability-fixtures.js'

type TestWindow = Window & { hronaut: HronautApi; hronautSettings: HronautSettingsApi }

test('two agents export distinct progressing background tabs while the human keeps a third selected', async ({ capabilities, appWindow, mcpPort, mcpToken }, testInfo) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const other = new Client({ name: 'background-recorder-two', version: '1.0.0' })
  await other.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  const call = async (owner: Client, id: string, action: string): Promise<BrowserVideoState> => {
    const result = await owner.callTool({ name: 'browser_video', arguments: { tabId: id, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  try {
    await useMcpWorkspace(other, 'Second background recorder', false)
    await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `${fixtureOrigin}/background-video?red` } })
    const opened = await other.callTool({ name: 'browser_new_tab', arguments: { url: `${fixtureOrigin}/background-video?blue`, active: true } }) as CallToolResult
    expect(opened.isError, text(opened)).not.toBe(true)
    const secondId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await other.callTool({ name: 'browser_wait', arguments: { tabId: secondId } })
    const human = await appWindow.evaluate(async url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), `${fixtureOrigin}/?human`)
    const humanId = human.activeTabId
    const selected = () => appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.getState()).activeTabId)
    for (const follow of [true, false]) {
      await appWindow.evaluate(value => (window as unknown as TestWindow).hronautSettings.setFollowAgentActivity(value), follow)
      await Promise.all([call(client, tabId, 'start'), call(other, secondId, 'start')])
      await expect.poll(selected).toBe(humanId)
      await expect.poll(async () => (await call(client, tabId, 'get')).frameCount).toBeGreaterThanOrEqual(12)
      await expect.poll(async () => (await call(other, secondId, 'get')).frameCount).toBeGreaterThanOrEqual(12)
      expect(await selected()).toBe(humanId)
      const stopped = await Promise.all([call(client, tabId, 'stop'), call(other, secondId, 'stop')])
      for (const [index, id] of [tabId, secondId].entries()) {
        const output = await call(index ? other : client, id, 'export')
        const data = (await readFile(output.exported!.path)).toString('base64')
        const samples = await appWindow.evaluate(async ({ data, duration }) => {
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
          const video = document.createElement('video')
          try {
            video.src = url; video.muted = true
            await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Decode failed')) })
            const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d')!
            const samples: number[][] = []
            for (let n = 1; n <= 10; n++) {
              video.currentTime = duration / 1000 * n / 12
              await new Promise<void>(resolve => { video.onseeked = () => resolve() })
              ctx.drawImage(video, 0, 0)
              samples.push([...ctx.getImageData(canvas.width * .25, canvas.height * .7, 1, 1).data, ...ctx.getImageData(canvas.width * .75, canvas.height * .7, 1, 1).data])
            }
            return samples
          } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
        }, { data, duration: stopped[index]!.durationMs })
        for (const pixel of samples) {
          expect(pixel[index ? 2 : 0]).toBeGreaterThan(180)
          expect(pixel[index ? 0 : 2]).toBeLessThan(60)
        }
        expect(new Set(samples.map(pixel => Math.round(pixel[4]! / 16))).size).toBeGreaterThan(2)
        await testInfo.attach(`decoded-${follow}-${index}`, { body: JSON.stringify(samples), contentType: 'application/json' })
      }
      expect(await selected()).toBe(humanId)
      await Promise.all([call(client, tabId, 'clear'), call(other, secondId, 'clear')])
    }
  } finally { await other.close() }
})
