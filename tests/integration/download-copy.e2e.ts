import { appendFile, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface DownloadRecord {
  id: string
  state: string
  filename: string
  savePath?: string
}

const CONTENT = 'Hronaut download fixture'

test('copies a finished download into a chosen folder under a new name, never replaces a file, and refuses a changed download', async ({ capabilities, profileDirectory }) => {
  const { client, tabId } = capabilities
  await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#download' } })
  let download: DownloadRecord | undefined
  await expect.poll(async () => {
    const listed = await client.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
    download = (JSON.parse(text(listed)) as DownloadRecord[]).find(entry => entry.filename === 'capability.txt' && entry.state === 'completed')
    return download !== undefined
  }).toBe(true)
  // The folder name is a canary: no refusal may name a path.
  const folder = join(profileDirectory, 'private-path-canary', 'copies')
  await mkdir(folder, { recursive: true })
  const request = (args: Record<string, unknown>) => ({
    name: 'browser_download_copy',
    arguments: { downloadId: download!.id, directory: folder, filename: 'renamed report.txt', ...args }
  })
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

  // Another workspace of the same client cannot copy it. The fixture's client always names its own workspace, so this
  // call goes through the unwrapped client method.
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
    [{ directory: 'relative/folder' }, /must be an absolute path/u],
    [{ directory: join(folder, 'missing') }, /does not exist/u],
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
})
