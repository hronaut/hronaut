import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { waitForSettledPageBounds } from './settled-page-bounds.js'

type Content = CallToolResult['content'][number]
const report = (result: CallToolResult) => JSON.parse(text(result)) as Record<string, unknown> & { cursor: number; frames: { sequence: number; epochMs: number }[] }
const images = (result: CallToolResult) => result.content.filter((item: Content) => item.type === 'image') as Array<{ data: string; mimeType: string }>

async function animate(electronApp: Parameters<typeof waitForSettledPageBounds>[0], url: string, running: boolean): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, { url, running }) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(running
    ? "document.body.innerHTML='<canvas id=c width=320 height=180></canvas>';window.spin=true;(function f(t){if(!window.spin)return;const x=document.getElementById('c').getContext('2d');x.fillStyle='#'+(Math.floor(t)%4096).toString(16).padStart(3,'0');x.fillRect(0,0,320,180);requestAnimationFrame(f)})(0);void 0"
    : 'window.spin=false;void 0'), { url, running })
}

test('frame stream returns new page frames after a cursor and stops', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  await animate(electronApp, fixtureUrl, true)
  try {
    const call = async (args: Record<string, unknown>) => client.callTool({ name: 'browser_frame_stream', arguments: { tabId, ...args } }) as Promise<CallToolResult>
    const started = await call({ action: 'start', maxWidth: 320, maxHeight: 180, quality: 50, bufferFrames: 5 })
    expect(started.isError, text(started)).not.toBe(true)
    expect(report(started)).toMatchObject({ status: 'STREAMING', cursor: 0, maxWidth: 320, bufferFrames: 5, pageVisible: true })
    const first = await call({ action: 'read', after: 0, waitMs: 2000 })
    expect(first.isError, text(first)).not.toBe(true)
    expect(report(first).status).toBe('FRAMES')
    expect(images(first)).toHaveLength(1)
    expect(images(first)[0]!.mimeType).toBe('image/jpeg')
    expect(Buffer.from(images(first)[0]!.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
    const cursor = report(first).cursor
    await electronApp.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
    const next = await call({ action: 'read', after: cursor, maxFrames: 4, waitMs: 2000 })
    const nextReport = report(next)
    await testInfo.attach('frame-stream', { body: JSON.stringify({ started: report(started), first: report(first), next: nextReport }), contentType: 'application/json' })
    expect(nextReport.status).toBe('FRAMES')
    expect(nextReport.frames.length).toBeGreaterThan(0)
    expect(nextReport.frames.length).toBeLessThanOrEqual(4)
    expect(nextReport.frames.every(frame => frame.sequence > cursor)).toBe(true)
    expect(nextReport.cursor).toBe(nextReport.frames.at(-1)!.sequence + 0 * Number(nextReport.skipped))
    expect(Math.abs(nextReport.frames.at(-1)!.epochMs - Date.now())).toBeLessThan(10_000)
    expect(images(next)).toHaveLength(nextReport.frames.length)
    // Start-only options belong to start, and a cursor past the stream is refused.
    expect((await call({ action: 'read', quality: 10 })).isError).toBe(true)
    expect((await call({ action: 'read', after: nextReport.cursor + 10_000 })).isError).toBe(true)
    const stopped = await call({ action: 'stop' })
    expect(report(stopped)).toMatchObject({ status: 'STOPPED', stopped: 'stopped' })
    expect((await call({ action: 'read' })).isError).toBe(true)
  } finally { await animate(electronApp, fixtureUrl, false) }
})

test('frame stream sends no frames while its page is hidden and resumes when shown', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  await animate(electronApp, fixtureUrl, true)
  const call = async (args: Record<string, unknown>) => client.callTool({ name: 'browser_frame_stream', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  const api = 'window.hronaut'
  let other: string | undefined
  try {
    expect((await call({ action: 'start' })).isError).not.toBe(true)
    const shown = report(await call({ action: 'read', after: 0, waitMs: 2000 }))
    expect(shown.status).toBe('FRAMES')
    other = await appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.newTab()).activeTabId ?? undefined)
    expect(other).not.toBe(tabId)
    await electronApp.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    const settled = report(await call({ action: 'read', after: shown.cursor, maxFrames: 4 }))
    const hidden = report(await call({ action: 'read', after: settled.cursor, waitMs: 800 }))
    expect(hidden).toMatchObject({ status: 'NO_NEW_FRAME', pageVisible: false })
    expect(hidden.cursor).toBe(settled.cursor)
    await appWindow.evaluate(`${api}.selectTab(${JSON.stringify(tabId)})`)
    const back = report(await call({ action: 'read', after: hidden.cursor, waitMs: 2000 }))
    expect(back).toMatchObject({ status: 'FRAMES', pageVisible: true })
  } finally {
    await call({ action: 'stop' }).catch(() => undefined)
    await animate(electronApp, fixtureUrl, false)
    if (other) await appWindow.evaluate(`${api}.closeTab(${JSON.stringify(other)})`).catch(() => undefined)
  }
})

test('frame stream keeps delivering frames while a key sequence holds keys', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  await animate(electronApp, fixtureUrl, true)
  const call = async (args: Record<string, unknown>) => client.callTool({ name: 'browser_frame_stream', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  try {
    expect((await call({ action: 'start', maxWidth: 320, maxHeight: 180 })).isError).not.toBe(true)
    const before = report(await call({ action: 'read', after: 0, waitMs: 2000 }))
    const playing = client.callTool({ name: 'browser_key_sequence', arguments: { tabId, events: [
      { atMs: 0, type: 'down', key: 'ArrowRight' }, { atMs: 1200, type: 'up', key: 'ArrowRight' }
    ] } }) as Promise<CallToolResult>
    await electronApp.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
    // Read while the sequence still holds ArrowRight and the page's debugger queue.
    const during = report(await call({ action: 'read', after: before.cursor, maxFrames: 4, waitMs: 2000 }))
    const played = await playing
    const sequence = JSON.parse(text(played)) as { startEpochMs: number; sentAtMs: number[] }
    await testInfo.attach('frames-during-sequence', { body: JSON.stringify({ before, during, sequence }), contentType: 'application/json' })
    expect(played.isError, text(played)).not.toBe(true)
    expect(during.status).toBe('FRAMES')
    const lastFrame = during.frames.at(-1)!.epochMs
    expect(lastFrame).toBeGreaterThanOrEqual(sequence.startEpochMs - 50)
    expect(lastFrame).toBeLessThan(sequence.startEpochMs + sequence.sentAtMs.at(-1)! + 50)
  } finally {
    await call({ action: 'stop' }).catch(() => undefined)
    await animate(electronApp, fixtureUrl, false)
  }
})
