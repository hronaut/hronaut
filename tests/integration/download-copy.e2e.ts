import { access, appendFile, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface DownloadRecord {
  id: string
  state: string
  filename: string
  savePath?: string
}

const CONTENT = 'Hronaut download fixture'

test('copies a finished download only into a folder its capability profile names, never replaces a file, and refuses a changed download', async ({ capabilities, appWindow, mcpPort, profileDirectory }) => {
  const { client: owner, tabId, workspace } = capabilities
  await owner.callTool({ name: 'browser_click', arguments: { tabId, selector: '#download' } })
  let download: DownloadRecord | undefined
  await expect.poll(async () => {
    const listed = await owner.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
    download = (JSON.parse(text(listed)) as DownloadRecord[]).find(entry => entry.filename === 'capability.txt' && entry.state === 'completed')
    return download !== undefined
  }).toBe(true)
  // The folder names are canaries: no refusal may name a path.
  const folder = join(profileDirectory, 'private-path-canary', 'copies')
  const unlisted = join(profileDirectory, 'private-path-canary', 'unlisted')
  await mkdir(folder, { recursive: true })
  await mkdir(unlisted, { recursive: true })
  const request = (args: Record<string, unknown>) => ({
    name: 'browser_download_copy',
    arguments: { downloadId: download!.id, directory: folder, filename: 'renamed report.txt', ...args }
  })

  // Full access is not enough: the person names the folders in a capability profile.
  const fullAccess = await owner.callTool(request({})) as CallToolResult
  expect(fullAccess.isError, text(fullAccess)).toBe(true)
  expect(fullAccess.structuredContent).toMatchObject({ status: 'REFUSED', reason: 'SEPARATE_GRANT_REQUIRED', effects: 'none' })
  expect(await readdir(folder)).toEqual([])

  await owner.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
  const grant = await appWindow.evaluate(directory => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({
    name: 'Report folder', preset: 'complete', argumentConstraints: { 'browser_download_copy.directory': [directory] }
  }), folder)
  const client = new Client({ name: 'download-copy-folder', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${grant.credential}` } } }))
    await connectMcpWorkspace(client, 'Download copy scope', false, workspace)
    const copy = (args: Record<string, unknown> = {}) => client.callTool(request(args)) as Promise<CallToolResult>

    const copied = await copy()
    expect(copied.isError, text(copied)).not.toBe(true)
    const target = join(await realpath(folder), 'renamed report.txt')
    expect(JSON.parse(text(copied))).toMatchObject({ status: 'COPIED', downloadId: download!.id, filename: 'renamed report.txt', path: target, bytes: CONTENT.length })
    expect(copied.structuredContent).toMatchObject({ status: 'COPIED', bytes: CONTENT.length })
    expect(await readFile(target, 'utf8')).toBe(CONTENT)
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    // The download and its record are unchanged.
    expect(await readFile(download!.savePath!, 'utf8')).toBe(CONTENT)
    const listed = await client.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(listed))).toEqual(expect.arrayContaining([expect.objectContaining({ id: download!.id, state: 'completed', savePath: download!.savePath })]))

    // A folder the profile does not list is refused by the capability check.
    const elsewhere = await copy({ directory: unlisted })
    expect(elsewhere.isError, text(elsewhere)).toBe(true)
    expect(await readdir(unlisted)).toEqual([])

    // Another workspace of the same client cannot copy it. The fixture's client helper always names its own
    // workspace, so this call goes through the unwrapped client method.
    const created = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Other copy workspace' } }) as CallToolResult
    expect(created.isError, text(created)).not.toBe(true)
    const otherWorkspaceId = (JSON.parse(text(created)) as { id: string }).id
    const fromOther = await Client.prototype.callTool.call(client, request({ workspaceId: otherWorkspaceId, filename: 'other workspace.txt' })) as CallToolResult
    expect(fromOther.isError, text(fromOther)).toBe(true)
    expect(text(fromOther)).toMatch(/not found in this workspace/u)

    const refusals: Array<[Record<string, unknown>, RegExp]> = [
      [{}, /already exists in the destination folder/u],
      [{ filename: '../escape.txt' }, /one portable file name/u],
      [{ filename: 'nested/escape.txt' }, /one portable file name/u],
      [{ downloadId: 'not-a-download' }, /not found in this workspace/u]
    ]
    for (const [args, message] of refusals) {
      const refused = await copy(args)
      expect(refused.isError, text(refused)).toBe(true)
      expect(text(refused)).toMatch(message)
      expect(text(refused)).not.toContain('private-path-canary')
    }
    expect(await readFile(target, 'utf8')).toBe(CONTENT)

    // A download changed after it finished is not the file Hronaut recorded.
    await appendFile(download!.savePath!, ' changed')
    const changed = await copy({ filename: 'after change.txt' })
    expect(changed.isError, text(changed)).toBe(true)
    expect(text(changed)).toMatch(/replaced or changed since it finished downloading/u)
    expect(await readdir(folder)).toEqual(['renamed report.txt'])
  } finally {
    await client.close()
  }
})

type CopyGate = { held: boolean; release(): void; restore(): void }
type CopyGateGlobal = typeof globalThis & { __downloadCopyGate?: CopyGate }

// Each case holds the copy at one point, withdraws access there, and checks what the agent is told once the call's
// own result is discarded. The audit outcome is saved after the copy is written and after the shared checks, so
// publication checks the call's authority once more.
const holds = [
  ['before the copy is created', 'workspace access'],
  ['after the copy is created', 'workspace access'],
  ['after the copy is written', 'workspace access'],
  ['after the copy is written', 'the capability profile']
] as const
for (const [stage, withdrawn] of holds) {
  test(`reports what a copy left behind when ${withdrawn} is withdrawn ${stage}`, async ({ capabilities, appWindow, electronApp, mcpPort, profileDirectory }) => {
    const { client: owner, tabId, workspace } = capabilities
    await owner.callTool({ name: 'browser_click', arguments: { tabId, selector: '#download' } })
    let download: DownloadRecord | undefined
    await expect.poll(async () => {
      const listed = await owner.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
      download = (JSON.parse(text(listed)) as DownloadRecord[]).find(entry => entry.filename === 'capability.txt' && entry.state === 'completed')
      return download !== undefined
    }).toBe(true)
    const folder = join(profileDirectory, 'held-copies')
    await mkdir(folder, { recursive: true })
    await owner.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
    await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
    const grant = await appWindow.evaluate(directory => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({
      name: 'Held copy folder', preset: 'complete', argumentConstraints: { 'browser_download_copy.directory': [directory] }
    }), folder)
    const client = new Client({ name: 'download-copy-held', version: '1' })
    let pending: Promise<CallToolResult> | undefined
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${grant.credential}` } } }))
      await connectMcpWorkspace(client, 'Held copy scope', false, workspace)
      if (stage === 'after the copy is written') {
        const started = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
        expect(started.isError, text(started)).not.toBe(true)
      }
      // Holds the source opening, the copy's creation, or the call's audit outcome after the copy, by stage.
      await electronApp.evaluate((_electron, { stage, source, target }) => {
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: CopyGate = { held: false, release, restore: () => { fs.open = open; syncBuiltinESMExports() } }
        ;(globalThis as CopyGateGlobal).__downloadCopyGate = gate
        let actionId = ''
        fs.open = async function (...args) {
          const path = String(args[0])
          if (!gate.held && (stage === 'before the copy is created' && path === source || stage === 'after the copy is created' && path === target)) {
            gate.held = true
            await barrier
          }
          const handle = await open.apply(this, args)
          if (stage === 'after the copy is written' && path.includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_download_copy') actionId = event.actionId!
              if (event.phase === 'outcome' && event.actionId === actionId && !gate.held) {
                gate.held = true
                await barrier
              }
              return write(data, options)
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      }, { stage, source: download!.savePath!, target: join(await realpath(folder), 'held copy.txt') })
      pending = client.callTool({ name: 'browser_download_copy', arguments: { downloadId: download!.id, directory: folder, filename: 'held copy.txt' } }) as Promise<CallToolResult>
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CopyGateGlobal).__downloadCopyGate?.held)).toBe(true)
      if (withdrawn === 'the capability profile') {
        await appWindow.evaluate(id => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.revokeMcpCapabilityProfile(id), grant.profile.id)
      } else {
        await appWindow.evaluate(async workspaceId => {
          await (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(workspaceId, { agentAccess: false })
        }, workspace.workspaceId)
      }
      await electronApp.evaluate(() => (globalThis as CopyGateGlobal).__downloadCopyGate!.release())
      const result = await pending
      expect(result.isError, text(result)).toBe(true)
      const target = join(folder, 'held copy.txt')
      if (stage === 'after the copy is written') {
        expect(result.structuredContent).toMatchObject({ status: 'COPIED_UNCONFIRMED', effects: 'file-written', retrySafe: false })
        expect(text(result)).not.toContain('held copy')
        expect(await readFile(target, 'utf8')).toBe(CONTENT)
      } else {
        // Nothing was created, or the partial copy was removed: the agent is told nothing was copied.
        expect(result.structuredContent).toMatchObject({ status: 'NOT_COPIED', dispatch: 'dispatched', effects: 'none' })
        await expect(access(target)).rejects.toThrow()
      }
      expect(text(result)).not.toContain(profileDirectory)
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as CopyGateGlobal
        scope.__downloadCopyGate?.release()
        scope.__downloadCopyGate?.restore()
        delete scope.__downloadCopyGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await client.close()
    }
  })
}
