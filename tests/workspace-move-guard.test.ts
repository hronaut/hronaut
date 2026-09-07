import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, WebContents } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const electronState = vi.hoisted(() => ({ contents: [] as WebContents[] }))
vi.mock('electron', () => ({ webContents: { getAllWebContents: () => electronState.contents } }))
import { withWorkspaceMoveGuard } from '../src/main/browser/workspace-move-guard.js'

let directory: string
let browserSession: ReturnType<typeof makeSession>
function makeSession() {
  return {
    getStoragePath: vi.fn((): string | null => directory),
    serviceWorkers: { getAllRunning: vi.fn((): Record<number, object> => ({})) },
    cookies: { flushStore: vi.fn(async () => {}) },
    flushStorageData: vi.fn(async () => {}),
    enableNetworkEmulation: vi.fn(), disableNetworkEmulation: vi.fn(),
    closeAllConnections: vi.fn(async () => {})
  }
}
function source() { return browserSession as unknown as Session }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-move-guard-'))
  browserSession = makeSession()
  electronState.contents = []
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('allows an archived idle worker-free profile while offline and restores network', async () => {
  const result = await withWorkspaceMoveGuard(source(), async permissions => {
    expect(permissions).toEqual({ allowCookieCleanup: true, allowLocalStorageCleanup: true })
    expect(browserSession.enableNetworkEmulation).toHaveBeenCalledWith({ offline: true })
    expect(browserSession.closeAllConnections).toHaveBeenCalledOnce()
    expect(browserSession.disableNetworkEmulation).not.toHaveBeenCalled()
    return 'moved'
  })
  expect(result).toBe('moved')
  expect(browserSession.disableNetworkEmulation).toHaveBeenCalledOnce()
})
it('rejects a live source view before executing any transfer', async () => {
  electronState.contents = [{ isDestroyed: () => false, session: source() } as WebContents]
  const operation = vi.fn()
  await expect(withWorkspaceMoveGuard(source(), operation)).rejects.toThrow('Archive the source workspace')
  expect(operation).not.toHaveBeenCalled()
  expect(browserSession.enableNetworkEmulation).not.toHaveBeenCalled()
})
it('ignores another session and already destroyed views', async () => {
  electronState.contents = [
    { isDestroyed: () => false, session: {} as Session } as WebContents,
    { isDestroyed: () => true, session: source() } as WebContents
  ]
  await expect(withWorkspaceMoveGuard(source(), async () => true)).resolves.toBe(true)
})
it('rejects stored worker data even without currently running workers', async () => {
  await mkdir(join(directory, 'Service Worker'))
  const operation = vi.fn()
  await expect(withWorkspaceMoveGuard(source(), operation)).rejects.toThrow('stored background site workers')
  expect(operation).not.toHaveBeenCalled()
})
it('rejects running workers even before their directory is written', async () => {
  browserSession.serviceWorkers.getAllRunning.mockReturnValue({ 1: {} })
  const operation = vi.fn()
  await expect(withWorkspaceMoveGuard(source(), operation)).rejects.toThrow('background site workers')
  expect(operation).not.toHaveBeenCalled()
})
it('rejects nonpersistent sessions rather than assuming their disk is empty', async () => {
  browserSession.getStoragePath.mockReturnValue(null)
  await expect(withWorkspaceMoveGuard(source(), vi.fn())).rejects.toThrow('verifiable persistent')
})
it('rechecks worker storage after closing connections and restores the network on rejection', async () => {
  browserSession.closeAllConnections.mockImplementation(async () => { await mkdir(join(directory, 'Service Worker')) })
  const operation = vi.fn()
  await expect(withWorkspaceMoveGuard(source(), operation)).rejects.toThrow('stored background site workers')
  expect(operation).not.toHaveBeenCalled()
  expect(browserSession.disableNetworkEmulation).toHaveBeenCalledOnce()
})
it('restores the network if the guarded transfer fails', async () => {
  await expect(withWorkspaceMoveGuard(source(), async () => { throw new Error('copy failed') })).rejects.toThrow('copy failed')
  expect(browserSession.disableNetworkEmulation).toHaveBeenCalledOnce()
})
it('restores the network if closing connections fails', async () => {
  browserSession.closeAllConnections.mockRejectedValue(new Error('close failed'))
  const operation = vi.fn()
  await expect(withWorkspaceMoveGuard(source(), operation)).rejects.toThrow('close failed')
  expect(operation).not.toHaveBeenCalled()
  expect(browserSession.disableNetworkEmulation).toHaveBeenCalledOnce()
})

it('rejects a missing profile directory instead of treating a missing worker path as proof', async () => {
  browserSession.getStoragePath.mockReturnValue(join(directory, 'missing'))
  await expect(withWorkspaceMoveGuard(source(), vi.fn())).rejects.toThrow('persistent browser profile could not be checked')
})
