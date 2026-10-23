import { execFile } from 'node:child_process'
import { createSecureServer } from 'node:http2'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

const payload = Buffer.alloc(2 * 1024 * 1024, 'workspace-close-download\n')
const offset = 256 * 1024

test('a workspace closed while it downloads lets the download finish and deletes its cookies at once', async ({ appWindow, electronApp }) => {
  // Closing the workspace closed every connection of its storage, so its download over HTTP/2, as most websites serve
  // files, failed halfway, and a resumable one was cancelled with its partial file.
  const certificates = await mkdtemp(join(tmpdir(), 'hronaut-download-tls-'))
  let release = false
  let fileRequests = 0
  let server: ReturnType<typeof createSecureServer> | undefined
  // An HTTP/2 server keeps its sessions open until they close, which Chromium may never do on its own.
  const sessions = new Set<import('node:http2').ServerHttp2Session>()
  try {
    await exec('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certificates, 'key.pem'), '-out', join(certificates, 'cert.pem')
    ])
    server = createSecureServer({
      key: await readFile(join(certificates, 'key.pem')),
      cert: await readFile(join(certificates, 'cert.pem'))
    }, (request, response) => {
      if (request.url !== '/report.bin') {
        response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=signed-in; Path=/' })
        response.end('<title>Workspace download</title><main>Workspace download</main>')
        return
      }
      fileRequests += 1
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="report.bin"',
        'content-length': payload.length
      })
      response.write(payload.subarray(0, offset))
      const timer = setInterval(() => {
        if (!release) return
        clearInterval(timer)
        response.end(payload.subarray(offset))
      }, 50)
      response.on('close', () => clearInterval(timer))
    })
    server.on('session', (session) => {
      sessions.add(session)
      session.on('close', () => sessions.delete(session))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Download fixture port is unavailable')
    const origin = `https://127.0.0.1:${address.port}`
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Report downloads', storage: 'scratch' })`) as {
      tabs: Array<{ id: string; mcpGroupId?: string }>
      mcpTabGroups: Array<{ id: string; name: string }>
    }
    const workspaceId = created.mcpTabGroups.find((group) => group.name === 'Report downloads')!.id
    const tabId = created.tabs.find((tab) => tab.mcpGroupId === workspaceId)!.id
    // The workspace's storage trusts the fixture's own certificate, for 127.0.0.1 only.
    const blank = 'data:text/html,<title>Workspace download start</title>'
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(blank)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      page?.session.setCertificateVerifyProc((request, callback) => callback(request.hostname === '127.0.0.1' ? 0 : -3))
      return Boolean(page)
    }, blank)).toBe(true)
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${origin}/`)} })`)
    // The workspace's own storage holds the website's cookie; the test keeps its session to read it after the close.
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      if (!page) return 0
      ;(globalThis as { closedWorkspaceSession?: Electron.Session }).closedWorkspaceSession = page.session
      return (await page.session.cookies.get({})).length
    }, `${origin}/`)).toBe(1)

    await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      await page!.executeJavaScript("const link = document.createElement('a'); link.href = '/report.bin'; link.download = ''; document.body.append(link); link.click()")
    }, `${origin}/`)
    const downloads = () => appWindow.evaluate('window.hronautDownloads.list()') as Promise<BrowserDownloadState[]>
    await expect.poll(async () => (await downloads())[0]?.receivedBytes ?? 0).toBeGreaterThanOrEqual(offset)

    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(workspaceId)})`)
    await expect.poll(() => electronApp.evaluate(async () => (
      (await (globalThis as { closedWorkspaceSession?: Electron.Session }).closedWorkspaceSession!.cookies.get({})).length
    ))).toBe(0)
    expect(await downloads()).toEqual([expect.objectContaining({ filename: 'report.bin', state: 'progressing' })])

    release = true
    await expect.poll(downloads).toEqual([
      expect.objectContaining({ filename: 'report.bin', state: 'completed', receivedBytes: payload.length })
    ])
    const [finished] = await downloads()
    expect(await readFile(finished!.savePath!)).toEqual(payload)
    // One request from start to end: the transfer was never cut and restarted.
    expect(fileRequests).toBe(1)
    // Once its download ended, the rest of the closed workspace's storage is deleted, with every connection.
    await expect.poll(() => sessions.size).toBe(0)
  } finally {
    for (const session of sessions) session.destroy()
    if (server?.listening) await closeFixtureServer(server)
    await rm(certificates, { recursive: true, force: true })
  }
})
