// Investigation only: Linux procfs descriptor acquisition, no evaluation or MCP API.
import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const MAX_SOURCE_BYTES = 64 * 1024
const O_PATH = 0x200000 // Linux UAPI; deliberately not portable.
export class AcquisitionFailure extends Error {
  constructor(readonly code: string) { super(code) }
}
export interface AcquisitionHooks {
  // Diagnostic seams delay real completed operations; they do not cancel native IO.
  afterOpen?: (handle: FileHandle) => Promise<void>
  afterRead?: () => Promise<void>
}
export class AcquisitionPool {
  active = 0
  readonly quarantinedHandles = new Set<FileHandle>()
  constructor(private readonly hooks: AcquisitionHooks = {}, private readonly platform = process.platform) {}

  acquire(path: string, expectedSha256: string, signal?: AbortSignal, deadlineMs = 1000): Promise<string> {
    const fail = (code: string): never => { throw new AcquisitionFailure(code) }
    if (this.platform !== 'linux') return Promise.reject(new AcquisitionFailure('UNSUPPORTED_PLATFORM'))
    if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || posix.normalize(path) !== path || path === '/' || path.endsWith('/') || Buffer.byteLength(path) > 4095) return Promise.reject(new AcquisitionFailure('INVALID_PATH'))
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000) return Promise.reject(new AcquisitionFailure('INVALID_REQUEST'))
    if (signal?.aborted) return Promise.reject(new AcquisitionFailure('CANCELLED'))
    if (this.active >= 2) return Promise.reject(new AcquisitionFailure('BUSY'))
    this.active++
    return new Promise<string>((resolve, reject) => {
      let stopped = false
      const stop = (code: string): void => { stopped = true; reject(new AcquisitionFailure(code)) }
      const abort = (): void => stop('CANCELLED')
      const timer = setTimeout(() => stop('DEADLINE'), deadlineMs)
      signal?.addEventListener('abort', abort, { once: true })
      const check = (): void => { if (stopped) fail('CANCELLED') }
      const handles = new Set<FileHandle>()
      const failedCloses = new Set<FileHandle>()
      const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1)
      let cleanupUnknown = false
      const close = async (handle: FileHandle): Promise<void> => {
        try { await handle.close(); handles.delete(handle) } catch { cleanupUnknown = true; failedCloses.add(handle); this.quarantinedHandles.add(handle); fail('CLEANUP_UNKNOWN') }
      }
      const ownedOpen = async (name: string, flags: number): Promise<FileHandle> => {
        const handle = await open(name, flags)
        handles.add(handle) // Own even a handle that arrives after caller cancellation.
        await this.hooks.afterOpen?.(handle)
        check()
        return handle
      }
      const work = async (): Promise<string> => {
        let parent = await ownedOpen('/', O_PATH | constants.O_DIRECTORY | constants.O_NOFOLLOW)
        const components = path.slice(1).split('/')
        for (let i = 0; i < components.length; i++) {
          const next = await ownedOpen(`/proc/self/fd/${parent.fd}/${components[i]}`, O_PATH | constants.O_NOFOLLOW)
          const info = await next.stat({ bigint: true }); check()
          if (i === components.length - 1 ? !info.isFile() : !info.isDirectory()) fail('INVALID_FILE_TYPE')
          await close(parent); check(); parent = next
        }
        const identity = await parent.stat({ bigint: true }); check()
        const file = await ownedOpen(`/proc/self/fd/${parent.fd}`, constants.O_RDONLY | constants.O_NONBLOCK)
        const before = await file.stat({ bigint: true }); check()
        if (!before.isFile() || before.dev !== identity.dev || before.ino !== identity.ino) fail('FILE_CHANGED')
        if (before.size > BigInt(MAX_SOURCE_BYTES)) fail('TOO_LARGE')
        let length = 0
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
          await this.hooks.afterRead?.(); check()
          if (!bytesRead) break
          length += bytesRead
        }
        if (length > MAX_SOURCE_BYTES) fail('TOO_LARGE')
        const after = await file.stat({ bigint: true }); check()
        if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.size !== BigInt(length)) fail('FILE_CHANGED')
        const captured = buffer.subarray(0, length)
        if (createHash('sha256').update(captured).digest('hex') !== expectedSha256) fail('DIGEST_MISMATCH')
        try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured) } catch { return fail('INVALID_UTF8') }
      }
      void (async () => {
        let source: string | undefined
        let failure: AcquisitionFailure | undefined
        try { source = await work() } catch (error) { failure = error instanceof AcquisitionFailure ? error : new AcquisitionFailure('IO_FAILURE') }
        for (const handle of handles) {
          if (failedCloses.has(handle)) continue
          try { await close(handle) } catch { /* Quarantine the admission slot; never claim the handle closed. */ }
        }
        buffer.fill(0)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (!cleanupUnknown) this.active--
        if (cleanupUnknown) reject(new AcquisitionFailure('CLEANUP_UNKNOWN'))
        else if (failure) reject(failure)
        else if (!stopped) resolve(source!)
      })()
    })
  }
}
