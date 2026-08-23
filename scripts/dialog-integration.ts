import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from './mcp-workspace.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const electronPath = join(repositoryRoot, 'node_modules/electron/dist/electron')
const profileDirectory = await mkdtemp(join(tmpdir(), 'hronaut-dialog-integration-'))

async function availableLoopbackPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => resolve())
  })
  const address = probe.address()
  assert(address && typeof address !== 'string', 'Could not allocate a loopback port')
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return address.port
}

const mcpPort = await availableLoopbackPort()

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(predicate: () => Promise<boolean>, message: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(`<!doctype html>
    <title>Dialog integration</title>
    <button id="alert" onclick="alert('Agent alert'); this.dataset.result='continued'">Alert</button>
    <p>Ready</p>`)
})
await new Promise<void>((resolve, reject) => {
  fixture.once('error', reject)
  fixture.listen(0, '127.0.0.1', () => resolve())
})
const address = fixture.address()
assert(address && typeof address !== 'string', 'Fixture server did not expose a TCP port')
const fixtureUrl = `http://127.0.0.1:${address.port}/`

const electronArguments = process.env.CI ? ['.', '--no-sandbox'] : ['.']
const application = spawn(electronPath, electronArguments, {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    HRONAUT_MCP_HOST: '127.0.0.1',
    HRONAUT_MCP_PORT: String(mcpPort),
    HRONAUT_USER_DATA_DIR: profileDirectory,
    HRONAUT_DOWNLOAD_DIR: profileDirectory
  },
  stdio: ['ignore', 'pipe', 'pipe']
})
application.stdout.pipe(process.stdout)
application.stderr.pipe(process.stderr)

let client: Client | undefined
let transport: StreamableHTTPClientTransport | undefined
try {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok
    } catch {
      return false
    }
  }, 'Hronaut MCP server did not start')
  client = new Client({ name: 'hronaut-dialog-integration', version: '1.0.0' })
  transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
  await client.connect(transport)
  await useMcpWorkspace(client, 'Dialog integration')

  const created = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: fixtureUrl, active: true }
  }) as CallToolResult
  assert(!created.isError, text(created))
  const tabs = JSON.parse(text(created)) as { tabs: Array<{ id: string; url: string }> }
  const tabId = tabs.tabs.find((tab) => tab.url === fixtureUrl)?.id
  assert(tabId, 'Created dialog test tab was not returned')

  const alertClick = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#alert', dialogAction: 'accept' }
  }) as CallToolResult
  assert(!alertClick.isError, `Could not accept alert opened by click: ${text(alertClick)}`)
  const alertResult = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "document.querySelector('#alert').dataset.result" }
  }) as CallToolResult
  assert(!alertResult.isError && text(alertResult) === 'continued', 'Alert-opening click did not resume')

  const evaluationConfirm = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "confirm('Evaluation confirm')",
      dialogAction: 'accept'
    }
  }) as CallToolResult
  assert(!evaluationConfirm.isError && text(evaluationConfirm) === 'true', `Could not accept evaluation confirmation: ${text(evaluationConfirm)}`)

  const consecutiveDialogs = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "alert('First dialog'); confirm('Second dialog')",
      dialogAction: 'accept'
    }
  }) as CallToolResult
  assert(!consecutiveDialogs.isError && text(consecutiveDialogs) === 'true', `Could not handle consecutive dialogs: ${text(consecutiveDialogs)}`)

  const scheduled = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "setTimeout(() => { window.confirmResult = confirm('Agent confirm') }, 0); 'scheduled'"
    }
  }) as CallToolResult
  assert(!scheduled.isError && text(scheduled) === 'scheduled', `Could not schedule confirmation: ${text(scheduled)}`)

  await waitFor(async () => {
    const listed = await client!.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult
    const currentTabs = JSON.parse(text(listed)) as Array<{
      id: string
      dialog?: { type: string; message: string; url: string }
    }>
    const dialog = currentTabs.find((tab) => tab.id === tabId)?.dialog
    return dialog?.type === 'confirm' && dialog.message === 'Agent confirm' && dialog.url === fixtureUrl
  }, 'browser_tabs did not expose the open confirmation')

  const handled = await client.callTool({
    name: 'browser_dialog',
    arguments: { tabId, action: 'dismiss' }
  }) as CallToolResult
  assert(!handled.isError, `Could not dismiss confirmation: ${text(handled)}`)
  assert(JSON.stringify(JSON.parse(text(handled))) === JSON.stringify({ handled: true, action: 'dismiss' }), 'Unexpected browser_dialog response')

  const result = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.confirmResult' }
  }) as CallToolResult
  assert(!result.isError && text(result) === 'false', `Dismissed confirmation returned ${text(result)}`)

  const noDialog = await client.callTool({
    name: 'browser_dialog',
    arguments: { tabId, action: 'accept' }
  }) as CallToolResult
  assert(noDialog.isError && /dialog/i.test(text(noDialog)), 'browser_dialog should fail clearly when no dialog is open')
  process.stdout.write('Dialog integration passed: action-scoped and already-open dialogs resumed correctly.\n')
} finally {
  await transport?.close().catch(() => undefined)
  fixture.close()
  if (application.exitCode === null) application.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => application.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000))
  ])
  if (application.exitCode === null) application.kill('SIGKILL')
  await rm(profileDirectory, { recursive: true, force: true })
}
