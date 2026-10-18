import { randomBytes } from 'node:crypto'
import { linkSync, renameSync, writeFileSync } from 'node:fs'
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CompletedDownloadFile } from '../src/main/browser/downloads-controller.js'
import { copyDownload, MAX_DOWNLOAD_COPY_BYTES, type DownloadCopyProgress } from '../src/main/browser/download-copy/download-copy.js'
import type { DownloadCopyAccess } from '../src/main/browser/download-copy/download-copy-access.js'
import { type DownloadCopySettlement, downloadCopySettlement } from '../src/main/mcp/tools/browser-download-copy/download-copy-settlement.js'
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
  return { dev: String(info.dev), ino: String(info.ino), size: Number(info.size), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) }
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

    // Rewritten in place at the same size with its modification time set back: the change time still moves.
    const rewritten = await accessFor(source)
    const { atime, mtime } = await stat(source)
    await writeFile(source, Buffer.alloc(CONTENT.length, 7))
    await utimes(source, atime, mtime)
    expect(await problem(copyDownload(rewritten, 'workspace', request()))).toMatch(/replaced or changed/u)

    await writeFile(source, CONTENT)
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
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), validate, progress))).toBe('Download copy cancelled')
    expect(await readdir(destination)).toEqual([])
    expect(progress).toEqual({ created: true, removed: true })

    // The call's own errors pass through unchanged, such as a lost write lease.
    const leaseLost = Object.assign(new Error('Workspace write lease lost'), { code: 'LEASE_LOST' })
    checks = 0
    const lost = await copyDownload(await accessFor(source), 'workspace', request(), () => { checks += 1; if (checks === 3) throw leaseLost }).catch((caught: unknown) => caught)
    expect(lost).toBe(leaseLost)

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
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), validate, progress))).toMatch(/moved or replaced while copying.*could not confirm that the copy it started is gone/u)
    expect(await readFile(target, 'utf8')).toBe('someone else')
    expect(progress).toEqual({ created: true, removed: false })
  })

  it('never reports a copy as removed when it was moved away or its folder was, so it may still exist', async () => {
    const target = join(destination, 'renamed copy.bin')
    let checks = 0
    const renamed: DownloadCopyProgress = { created: false, removed: false }
    const renameAway = (): void => { checks += 1; if (checks === 3) renameSync(target, join(destination, 'kept.bin')) }
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), renameAway, renamed))).toMatch(/moved or replaced.*could not confirm/u)
    expect(renamed).toEqual({ created: true, removed: false })
    expect(Buffer.compare(await readFile(join(destination, 'kept.bin')), CONTENT)).toBe(0)

    checks = 0
    const moved: DownloadCopyProgress = { created: false, removed: false }
    const movedFolder = `${destination}-moved`
    const moveFolder = (): void => { checks += 1; if (checks === 3) renameSync(destination, movedFolder) }
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request(), moveFolder, moved))).toMatch(/moved or replaced.*could not confirm/u)
    expect(moved).toEqual({ created: true, removed: false })
    expect(Buffer.compare(await readFile(join(movedFolder, 'renamed copy.bin')), CONTENT)).toBe(0)

    // Another name for the same file keeps it after the copy's own name is removed.
    checks = 0
    const linked: DownloadCopyProgress = { created: false, removed: false }
    const second = await mkdtemp(join(root, 'linked-destination-'))
    const linkAndStop = (): void => {
      checks += 1
      if (checks !== 3) return
      linkSync(join(second, 'renamed copy.bin'), join(second, 'other name.bin'))
      throw new Error('Download copy cancelled')
    }
    expect(await problem(copyDownload(await accessFor(source), 'workspace', request({ directory: second }), linkAndStop, linked))).toMatch(/cancelled.*could not confirm/u)
    expect(linked).toEqual({ created: true, removed: false })
    expect(await readdir(second)).toEqual(['other name.bin'])
  })
})

describe('browser_download_copy tool', () => {
  function tool(copy: (validate: () => void, progress: DownloadCopyProgress) => Promise<unknown>) {
    let handler: ((input: Record<string, unknown>, call: unknown) => Promise<CallToolResult>) | undefined
    let options: { settlement?: () => DownloadCopySettlement } | undefined
    registerBrowserDownloadCopy({
      capability: {},
      manager: { copyWorkspaceDownload: (_workspaceId: string, _request: unknown, validate: () => void, progress: DownloadCopyProgress) => copy(validate, progress) },
      tool: (callback: unknown) => callback,
      registerWorkspaceTool: (_name: string, _config: unknown, callback: typeof handler, toolOptions: typeof options) => { handler = callback; options = toolOptions }
    } as never)
    const settlement = options!.settlement!()
    const outcomes: unknown[] = []
    let authorized = true
    const abort = new AbortController()
    const call = {
      signal: abort.signal,
      requireCurrentTarget: () => { if (!authorized) throw new Error('Workspace access was withdrawn') },
      setInvalidatedOutcome: (outcome: unknown) => { outcomes.push(outcome) },
      settlement
    }
    settlement.prepare(call as never)
    const run = () => handler!({ workspaceId: 'workspace', downloadId: 'download', directory: destination, filename: 'copy.bin' }, call)
    return { outcomes, run, settlement, revoke: () => { authorized = false }, cancel: () => abort.abort() }
  }
  const failed = { content: [{ type: 'text' as const, text: 'failed' }], isError: true }
  const status = (result: CallToolResult | undefined) => result?.structuredContent?.status

  it('returns the copy as structured content, and keeps a copy the call could not confirm from looking like nothing happened', async () => {
    const copied = tool(async () => ({ status: 'COPIED', filename: 'copy.bin', bytes: 3 }))
    const result = await copied.run()
    expect(result.structuredContent).toMatchObject({ status: 'COPIED', bytes: 3 })
    expect(copied.settlement.publish(result)).toBeUndefined()
    // The shared checks after the copy discarded its result: the copy exists, and the agent is told so.
    expect(status(copied.settlement.publish(failed))).toBe('COPIED_UNCONFIRMED')
    expect(copied.settlement.publish(failed)?.structuredContent).toMatchObject({ effects: 'file-written', retrySafe: false })
    expect(status(copied.settlement.settleError())).toBe('COPIED_UNCONFIRMED')
    expect(status(copied.settlement.publicationRevoked())).toBe('COPIED_UNCONFIRMED')

    // Access withdrawn, or the call cancelled, after the shared checks: the copy is not confirmed and its path is withheld.
    copied.revoke()
    expect(copied.settlement.publish(result)?.structuredContent).toMatchObject({ status: 'COPIED_UNCONFIRMED', effects: 'file-written' })
    expect(JSON.stringify(copied.settlement.publish(result))).not.toContain('copy.bin')
    const cancelled = tool(async () => ({ status: 'COPIED', filename: 'copy.bin', bytes: 3 }))
    const finished = await cancelled.run()
    cancelled.cancel()
    expect(status(cancelled.settlement.publish(finished))).toBe('COPIED_UNCONFIRMED')
  })

  it('reports a copy that may remain, and passes through failures that left nothing behind', async () => {
    const remained = tool(async (_validate, progress) => { progress.created = true; throw new Error('could not confirm') })
    await expect(remained.run()).rejects.toThrow('could not confirm')
    expect(remained.outcomes).toEqual(['outcome-unknown'])
    expect(status(remained.settlement.publish(failed))).toBe('COPY_OUTCOME_UNKNOWN')
    expect(remained.settlement.effectsPossible()).toBe(true)

    const removed = tool(async (_validate, progress) => { progress.created = true; progress.removed = true; throw new Error('removed') })
    await expect(removed.run()).rejects.toThrow('removed')
    expect(removed.outcomes).toEqual([])
    expect(removed.settlement.effectsPossible()).toBe(false)
    expect(removed.settlement.settleError()).toBeUndefined()
    // The shared wrapper turns the thrown error into its own result; that refusal is published as it is.
    removed.settlement.afterDispatch(failed)
    expect(removed.settlement.publish(failed)).toBeUndefined()
  })

  it('tells the agent nothing was copied when the call discarded a result that left nothing behind', async () => {
    const stopped = tool(async () => { throw new Error('Download copy cancelled') })
    await expect(stopped.run()).rejects.toThrow('cancelled')
    stopped.settlement.afterDispatch(failed)
    // The shared result that replaces a result discarded after a pause, a lease change or lost access.
    const discarded = { content: [{ type: 'text' as const, text: 'discarded' }], structuredContent: { status: 'OUTCOME_UNKNOWN' }, isError: true }
    for (const result of [stopped.settlement.publish(discarded), stopped.settlement.publicationRevoked(), stopped.settlement.settleDenied()]) {
      expect(result?.structuredContent).toMatchObject({ status: 'NOT_COPIED', dispatch: 'dispatched', effects: 'none', retrySafe: false })
    }

    // A rejection before the copy ran is reported as it is.
    const rejected = downloadCopySettlement(true)
    const rejection = { content: [{ type: 'text' as const, text: 'rejected' }], structuredContent: { status: 'POLICY_REJECTED' }, isError: true }
    expect(rejected.publish(rejection)).toBeUndefined()
    expect(rejected.publicationRevoked().structuredContent).toMatchObject({ status: 'NOT_COPIED', dispatch: 'not-dispatched', effects: 'none' })
  })

  it('refuses full-access credentials before anything else', () => {
    const refused = downloadCopySettlement(false).admit()
    expect(refused?.structuredContent).toMatchObject({ status: 'REFUSED', reason: 'SEPARATE_GRANT_REQUIRED', effects: 'none' })
    expect(downloadCopySettlement(true).admit()).toBeUndefined()
  })
})
