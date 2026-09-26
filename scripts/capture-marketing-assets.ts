import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const repositoryRoot = process.env.HRONAUT_CAPTURE_APP_ROOT || fileURLToPath(new URL('..', import.meta.url))
const outputPath = resolve(
  process.argv[2] ?? join(repositoryRoot, '..', 'hronaut-page', 'public', 'hronaut-app.png')
)
const profileDirectory = await mkdtemp('/tmp/opencode/hronaut-marketing-')
const fixture = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Localhost QA · Example checkout</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;background:#f6f7fa;color:#242936;font:18px system-ui}main{max-width:780px;margin:60px auto;padding:36px}small{color:#6250d8;font-weight:700;letter-spacing:.08em}h1{font-size:44px;line-height:1.1}section{background:white;border:1px solid #d9dce5;padding:28px;border-radius:16px;margin:28px 0}button{background:#6250d8;color:white;border:0;border-radius:8px;padding:14px 24px;font:inherit}li{margin:16px 0}p{line-height:1.6;color:#555e71}</style>
<main><small>LOCALHOST QA / EXAMPLE DATA</small><h1>Checkout is ready for your review.</h1><p>The coding agent opened this local fixture, inspected the page, and handed control back to you.</p><section><h2>Example order</h2><p>2 demo seats · $48 / year</p><ul><li>Order summary is visible</li><li>Keyboard-accessible review button</li><li>No payment request is sent</li></ul><button type="button">Review example order</button></section><p>This is a local demonstration, not a live store.</p></main></html>`))
await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
const address = fixture.address()
if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
const client = new Client({ name: 'Localhost QA demo', version: '1.0.0' })

try {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    join(profileDirectory, 'settings.json'),
    `${JSON.stringify({ interfaceScale: 1, languagePreference: 'en-US', theme: 'light' }, null, 2)}\n`,
    'utf8'
  )

  const app = await electron.launch({
    args: ['.'],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HRONAUT_DISABLE_AUTO_UPDATE: '1',
      HRONAUT_DISABLE_MCP_AUTH: '1',
      HRONAUT_DOWNLOAD_DIR: profileDirectory,
      HRONAUT_MCP_HOST: '127.0.0.1',
      HRONAUT_MCP_PORT: '48729',
      HRONAUT_USER_DATA_DIR: profileDirectory
    }
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.setViewportSize({ width: 1440, height: 900 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width: 1440, height: 900 }))
    await expect.poll(async () => fetch('http://127.0.0.1:48729/healthz').then(r => r.status).catch(() => 0)).toBe(200)
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:48729/mcp')))
    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const result = await client.callTool({ name, arguments: args })
      if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`)
      const content = result.content as { type: string; text?: string }[]
      const text = content.find(item => item.type === 'text')?.text ?? '{}'
      return text.trim().startsWith('{') ? JSON.parse(text) : {}
    }
    const created = await call('browser_workspaces', { action: 'create', name: 'Localhost QA', storage: 'scratch' })
    const workspaceId = String(created.workspaceId ?? (created.workspace as { id?: string } | undefined)?.id ?? created.id)
    const opened = await call('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/checkout` })
    const tabId = String((opened.tabs as { id: string; url: string }[]).find(tab => tab.url.includes('/checkout'))?.id)
    await call('browser_snapshot', { workspaceId, tabId })
    await call('browser_request_user_attention', { workspaceId, tabId, reason: 'Review the example checkout. The agent has finished its read-only page check.' })
    await expect(window.getByText('Localhost QA', { exact: true }).first()).toBeVisible()
    const page = app.windows().find(page => page.url().includes('/checkout'))
    if (!page) throw new Error('Local fixture page unavailable')
    await expect(page.getByRole('heading', { name: 'Checkout is ready for your review.' })).toBeVisible()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    if (process.platform === 'linux') {
      // BrowserWindow.capturePage omits native child WebContentsView surfaces on
      // Linux. Capture the composited isolated Xvfb display instead.
      await promisify(execFile)('import', ['-window', 'root', '-crop', '1440x900+0+0', '+repage', outputPath])
    } else {
      const imageBase64 = await app.evaluate(async ({ BrowserWindow }) => {
      const browser = BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.isVisible())
      if (!browser) throw new Error('Browser window unavailable')
      const image = await browser.capturePage()
      return image.toPNG().toString('base64')
    })
      await writeFile(outputPath, Buffer.from(imageBase64, 'base64'))
    }
    const { version } = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as { version: string }
    await writeFile(`${outputPath}.json`, `${JSON.stringify({ version, theme: 'light', viewport: { width: 1440, height: 900 }, scenario: 'Localhost QA fixture, isolated scratch workspace, read-only snapshot, human review', containsPrivateData: false }, null, 2)}\n`)
    console.log(outputPath)
  } finally {
    await client.close()
    await app.close()
  }
} finally {
  fixture.closeAllConnections()
  await new Promise<void>(resolve => fixture.close(() => resolve()))
  await rm(profileDirectory, { recursive: true, force: true })
}
