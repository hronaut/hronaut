import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { answerEveryTrustedDialog, answeredTrustedDialogs } from './trusted-dialog-fixture.js'
import { closeFixtureServer, closeHronaut, launchHronaut } from './fixtures.js'

// Electron asks Hronaut's permission check, not the request's answer, whether a page may still use what the person
// gave it. A file dropped onto an editor read "denied" and getFile() failed with NotAllowedError, and a page in a call
// the person allowed read its camera and microphone as "denied", with no names.

/** Answers every permission prompt with Allow and records what each one said. */
const allowEveryPrompt = (window: Page): Promise<void> => answerEveryTrustedDialog(window, 'Allow')
const prompts = (window: Page): Promise<string[]> => answeredTrustedDialogs(window)

// A drop zone that keeps the dropped file's handle, as editors that save back to the file do.
const DROP_ZONE = `(() => {
  document.body.innerHTML = '<div id="zone" style="position:absolute;left:40px;top:40px;width:320px;height:200px">Drop a file</div>';
  window.dropped = null;
  const zone = document.querySelector('#zone');
  zone.addEventListener('dragover', (event) => event.preventDefault());
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    window.dropped = event.dataTransfer.items[0].getAsFileSystemHandle();
  });
  return true;
})()`

test('reads a dropped file, and never writes it, since Electron cannot ask first', async ({ appWindow, capabilities, electronApp, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const folder = join(profileDirectory, 'file-access')
  await mkdir(folder, { recursive: true })
  const notes = join(folder, 'notes.txt')
  await writeFile(notes, 'First draft', 'utf8')
  const onPage = <T>(script: string): Promise<T> => electronApp.evaluate(({ webContents }, { url, script }) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.executeJavaScript(script, true)
  ), { url: fixtureUrl, script }) as Promise<T>
  await allowEveryPrompt(appWindow)
  await onPage(DROP_ZONE)
  const drop = await client.callTool({ name: 'browser_file_drop', arguments: { tabId, selector: '#zone', paths: [notes] } }) as CallToolResult
  expect(JSON.parse(text(drop))).toMatchObject({ status: 'DROPPED', files: 1 })
  await expect.poll(() => onPage('window.dropped !== null')).toBe(true)

  expect(await onPage(`(async () => {
    const handle = await window.dropped;
    return [await handle.queryPermission({ mode: 'read' }), await (await handle.getFile()).text(), await handle.queryPermission({ mode: 'readwrite' })];
  })()`)).toEqual(['granted', 'First draft', 'denied'])
  expect(await prompts(appWindow)).toEqual([])

  // Chromium asks a single file's write access of the check alone, which cannot ask the person, so it stays refused.
  expect(await onPage(`(async () => {
    const handle = await window.dropped;
    const asked = await handle.requestPermission({ mode: 'readwrite' });
    const written = await handle.createWritable().then(() => 'written', (error) => error.name);
    return [asked, written];
  })()`)).toEqual(['denied', 'NotAllowedError'])
  expect(await readFile(notes, 'utf8')).toBe('First draft')
  expect(await prompts(appWindow)).toEqual([])
})

test('reports a camera and microphone the person allowed as allowed, with their names, until the page reloads', async ({ profileDirectory, mcpPort }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Call</title><main>Call</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  // Chromium's fake camera and microphone stand in for real devices.
  const { app, window } = await launchHronaut(profileDirectory, mcpPort, 1, [], ['--use-fake-device-for-media-stream'])
  try {
    await window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Call'))).toBe(true)
    await allowEveryPrompt(window)
    const onPage = <T>(script: string): Promise<T> => app.evaluate(({ webContents }, script) => (
      webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Call')!.executeJavaScript(script, true)
    ), script) as Promise<T>
    const devices = `(async () => ({
      camera: (await navigator.permissions.query({ name: 'camera' })).state,
      microphone: (await navigator.permissions.query({ name: 'microphone' })).state,
      named: [...new Set((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.label && device.deviceId).map((device) => device.kind))].sort()
    }))()`
    // Electron cannot report "prompt", so a page that was not given its devices reads them as denied.
    expect(await onPage(devices)).toEqual({ camera: 'denied', microphone: 'denied', named: [] })

    expect(await onPage(`navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
      window.stream = stream;
      return stream.getTracks().map((track) => track.kind);
    }, (error) => error.name)`)).toEqual(['video'])
    expect(await onPage(devices)).toEqual({ camera: 'granted', microphone: 'denied', named: ['videoinput'] })

    expect(await onPage(`navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => stream.getTracks().map((track) => track.kind), (error) => error.name)`)).toEqual(['audio'])
    expect(await onPage(devices)).toEqual({ camera: 'granted', microphone: 'granted', named: ['audioinput', 'audiooutput', 'videoinput'] })
    // Every request still asks.
    expect(await prompts(window)).toHaveLength(2)

    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Call')!.reload())
    await expect.poll(() => onPage<string>(`document.readyState`).catch(() => 'loading')).toBe('complete')
    expect(await onPage(devices)).toEqual({ camera: 'denied', microphone: 'denied', named: [] })
  } finally {
    await closeHronaut(app)
    await closeFixtureServer(server)
  }
})
