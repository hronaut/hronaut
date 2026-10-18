import { randomBytes } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CompletedDownloadFile } from '../src/main/browser/downloads-controller.js'
import { copyDownload, MAX_DOWNLOAD_COPY_BYTES, type DownloadCopyProgress } from '../src/main/browser/download-copy/download-copy.js'
import type { DownloadCopyAccess } from '../src/main/browser/download-copy/download-copy-access.js'
import { registerBrowserDownloadCopy } from '../src/main/mcp/tools/browser-download-copy/index.js'

// More than two copy chunks, with every byte value.
const CONTENT = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, index) => index)), randomBytes(2.5 * 1024 * 1024)])
let root: string
let downloads: string
let destination: string
let source: string

beforeAll(async () => {
  // The directory name is a canary: no message may name a path.
  root = await mkdtemp(join(tmpdir(), 'private-path-canary-'))
  downloads = join(root, 'downloads')
  await mkdir(downloads)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  destination = await mkdtemp(join(root, 'destination-'))
  source = join(downloads, `report-${Math.random().toString(36).slice(2)}.bin`)
  await writeFile(source, CONTENT)
})

async function identityOf(path: string): Promise<CompletedDownloadFile['identity']> {
  const info = await lstat(path, { bigint: true })
  return { dev: String(info.dev), ino: String(info.ino), size: Number(info.size), mtimeNs: String(info.mtimeNs) }
}

/** A manager view whose one completed download is the file at `path`, recorded as it is now unless overridden. */
async function accessFor(path: string, identity?: Partial<CompletedDownloadFile['identity']>): Promise<DownloadCopyAccess & { requests: string[] }> {
  const recorded = { ...await identityOf(path), ...identity }
  const requests: string[] = []
  return {
    requests,
    completedDownloadFile: async (workspaceId, downloadId) => {
      requests.push(`${workspaceId}/${downloadId}`)
      if (workspaceId !== 'workspace' || downloadId !== 'download') throw new Error(`Download not found in this workspace: ${downloadId}`)
      return { savePath: path, identity: recorded }
    }
  }
}

async function problem(operation: Promise<unknown>): Promise<string> {
  const message = await operation.then(() => 'copied', (caught: unknown) => (caught as Error).message)
  expect(message).not.toContain('private-path-canary')
  return message
}

const request = (overrides: Partial<{ downloadId: string; directory: string; filename: string }> = {}) =>
  ({ downloadId: 'download', directory: destination, filename: 'renamed copy.bin', ...overrides })

describe('copying a finished download', () => {
  it('copies the file byte for byte under the new name, readable only by its owner, and leaves the download as it was', async () => {
    const before = await stat(source)
    const progress: DownloadCopyProgress = { created: false, removed: false }
    const result = await copyDownload(await accessFor(source), 'workspace', request(), undefined, progress)
    const path = join(await realpath(destination), 'renamed copy.bin')
    expect(result).toMatchObject({ status: 'COPIED', downloadId: 'download', filename: 'renamed copy.bin', path, bytes: CONTENT.length })
    expect(Buffer.compare(await readFile(path), CONTENT)).toBe(0)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(Buffer.compare(await readFile(source), CONTENT)).toBe(0)
    expect((await stat(source)).mtimeMs).toBe(before.mtimeMs)
    expect(progress).toEqual({ created: true, removed: false })
  })

  it('writes into the real folder a symbolic link names, and reports that path', async () => {
    const linked = join(root, `linked-${Math.random().toString(36).slice(2)}`)
    await symlink(destination, linked)
    const result = await copyDownload(await accessFor(source), 'workspace', request({ directory: linked }))
    expect(result.path).toBe(join(await realpath(destination), 'renamed copy.bin'))
  })

  it('never replaces an existing name, a symbolic link included', async () => {
    const existing = join(destination, 'existing.bin')
    await writeFile(existing, 'keep me')
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request({ filename: 'existing.bin' })))).toMatch(/already exists.*nothing was copied or replaced/u)
    expect(await readFile(existing, 'utf8')).toBe('keep me')
    const elsewhere = join(root, 'elsewhere.txt')
    await writeFile(elsewhere, 'outside')
    await symlink(elsewhere, join(destination, 'link.bin'))
    await symlink(join(root, 'nowhere.txt'), join(destination, 'dangling.bin'))
    for (const filename of ['link.bin', 'dangling.bin']) {
      expect(await problem(copyDownload(await accessFor(source), 'workspace', request({ filename })))).toMatch(/already exists/u)
    }
    expect(await readFile(elsewhere, 'utf8')).toBe('outside')
    await expect(lstat(join(root, 'nowhere.txt'))).rejects.toThrow()
  })

  it('refuses names that are not one portable file name, and folders it cannot use, creating nothing', async () => {
    const access = await accessFor(source)
    for (const filename of ['../escape.bin', 'nested/copy.bin', 'nested\\copy.bin', '.', '..', ' padded.bin', 'padded.bin ', 'trailing.', 'CON.txt', 'nul', 'control\u0001.bin', 'colon:.bin', `${'é'.repeat(128)}.bin`]) {
      expect(await problem(copyDownload(access, 'workspace', request({ filename }))), filename).toMatch(/one portable file name/u)
    }
    expect(await problem(copyDownload(access, 'workspace', request({ directory: 'relative/folder' })))).toMatch(/must be an absolute path/u)
    expect(await problem(copyDownload(access, 'workspace', request({ directory: join(root, 'missing') })))).toMatch(/does not exist/u)
    expect(await problem(copyDownload(access, 'workspace', request({ directory: source })))).toMatch(/not a folder/u)
    expect(await readdir(destination)).toEqual([])
    // Names and relative folders are refused before the download is looked up.
    expect(access.requests).toEqual(['workspace/download', 'workspace/download'])
  })

  it('refuses a download from another workspace, one larger than the limit, and a file that changed since it finished', async () => {
    expect(await problem(copyDownload(await accessFor(source), 'other', request()))).toMatch(/not found in this workspace/u)
    expect(await problem(copyDownload(await accessFor(source, { size: MAX_DOWNLOAD_COPY_BYTES + 1 }), 'workspace', request()))).toMatch(/larger than 2 GiB/u)

    const appended = await accessFor(source)
    await appendFile(source, 'more')
    expect(await problem(copyDownload(appended, 'workspace', request()))).toMatch(/replaced or changed since it finished/u)

    await writeFile(source, CONTENT)
    const touched = await accessFor(source)
    await utimes(source, new Date(2001, 0, 1), new Date(2001, 0, 1))
    // Found before the copy is created, not only after it was written.
    const touchedProgress: DownloadCopyProgress = { created: false, removed: false }
    expect(await problem(copyDownload(touched, 'workspace', request(), undefined, touchedProgress))).toMatch(/replaced or changed/u)
    expect(touchedProgress.created).toBe(false)

    const replaced = await accessFor(source)
    await unlink(source)
    await writeFile(source, CONTENT)
    expect(await problem(copyDownload(replaced, 'workspace', request()))).toMatch(/replaced or changed/u)

    const linkedAway = await accessFor(source)
    const moved = `${source}.moved`
    await rename(source, moved)
    await symlink(moved, source)
    expect(await problem(copyDownload(linkedAway, 'workspace', request()))).toMatch(/gone or cannot be read/u)

    await unlink(source)
    expect(await problem(copyDownload(linkedAway, 'workspace', request()))).toMatch(/gone or cannot be read/u)
    expect(await readdir(destination)).toEqual([])
  })

  it('runs at most two copies at once and refuses a third until one finishes', async () => {
    const access = await accessFor(source)
    const copies = await Promise.allSettled(['one.bin', 'two.bin', 'three.bin'].map(filename => copyDownload(access, 'workspace', request({ filename }))))
    expect(copies.map(copy => copy.status)).toEqual(['fulfilled', 'fulfilled', 'rejected'])
    expect(((copies[2] as PromiseRejectedResult).reason as Error).message).toMatch(/already being copied/u)
    expect((await copyDownload(access, 'workspace', request({ filename: 'four.bin' }))).status).toBe('COPIED')
  })

  it('removes only its own partial copy when the call is stopped part way, and says so', async () => {
    let checks = 0
    const progress: DownloadCopyProgress = { created: false, removed: false }
    // The first two checks precede the file; the third follows the first chunk.
    const validate = (): void => { checks += 1; if (checks === 3) throw new Error('Download copy cancelled') }
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), validate, progress))).toBe('Download copy cancelled The copy it started was removed.')
    expect(await readdir(destination)).toEqual([])
    expect(progress).toEqual({ created: true, removed: true })

    const early: DownloadCopyProgress = { created: false, removed: false }
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), () => { throw new Error('Authority changed') }, early))).toBe('Authority changed')
    expect(early).toEqual({ created: false, removed: false })
  })

  it('leaves a file that took the copy\'s name alone, and reports that something may remain', async () => {
    const target = join(destination, 'renamed copy.bin')
    let checks = 0
    const progress: DownloadCopyProgress = { created: false, removed: false }
    // After the first chunk, another program moves the partial copy away and writes its own file under the name.
    const validate = (): void => {
      checks += 1
      if (checks !== 3) return
      renameSync(target, join(destination, 'moved-away.bin'))
      writeFileSync(target, 'someone else')
    }
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), validate, progress))).toMatch(/replaced while copying.*could not remove the copy it started/u)
    expect(await readFile(target, 'utf8')).toBe('someone else')
    expect(progress).toEqual({ created: true, removed: false })
  })
})

describe('browser_download_copy tool', () => {
  function tool(copy: (validate: () => void, progress: DownloadCopyProgress) => Promise<unknown>) {
    let handler: ((input: Record<string, unknown>, call: unknown) => Promise<CallToolResult>) | undefined
    registerBrowserDownloadCopy({
      manager: { copyWorkspaceDownload: (_workspaceId: string, _request: unknown, validate: () => void, progress: DownloadCopyProgress) => copy(validate, progress) },
      tool: (callback: unknown) => callback,
      registerWorkspaceTool: (_name: string, _config: unknown, callback: typeof handler) => { handler = callback }
    } as never)
    const outcomes: unknown[] = []
    const call = { signal: undefined, requireCurrentTarget: () => undefined, setInvalidatedOutcome: (outcome: unknown) => { outcomes.push(outcome) } }
    const run = () => handler!({ workspaceId: 'workspace', downloadId: 'download', directory: destination, filename: 'copy.bin' }, call)
    return { outcomes, run }
  }

  it('returns the copy as structured content', async () => {
    const copied = await tool(async () => ({ status: 'COPIED', filename: 'copy.bin', bytes: 3 })).run()
    expect(copied.structuredContent).toMatchObject({ status: 'COPIED', bytes: 3 })
  })

  it('marks the outcome unknown only when its own file may remain', async () => {
    const remained = tool(async (_validate, progress) => { progress.created = true; throw new Error('could not remove') })
    await expect(remained.run()).rejects.toThrow('could not remove')
    expect(remained.outcomes).toEqual(['outcome-unknown'])
    const removed = tool(async (_validate, progress) => { progress.created = true; progress.removed = true; throw new Error('removed') })
    await expect(removed.run()).rejects.toThrow('removed')
    expect(removed.outcomes).toEqual([])
  })
})
