import { describe, expect, it, vi } from 'vitest'
import type { Cookie } from 'electron'
import { BrowserImportService, type ImportDestination } from '../src/main/browser-import/service.js'
// The orchestration protocol must work without loading native source adapters.
vi.mock('../src/main/browser-import/source.js', () => { throw new Error('Source adapter is unavailable') })

function setup() {
  const destination = { id: 'workspace', name: 'Work', fingerprint: 'one' }
  const profile = { id: 'source', name: 'Personal', browser: 'Chrome', kind: 'chromium' as const, file: '/private/profile', keyApplication: 'chrome' }
  const cookie = { domain: '.example.test', name: 'session', value: 'never-send-to-renderer', path: '/', hostOnly: false, session: true } as Cookie
  const ports = { destination: vi.fn(() => ({ ...destination })), discover: vi.fn(async () => [profile]), consent: vi.fn(async () => true), read: vi.fn(async () => ({ cookies: [{ ...cookie }], skipped: 2 })), write: vi.fn(async (..._args: [ImportDestination, Cookie[]]) => ({ imported: 1, skipped: 0, failed: 0, recoveryRequired: false })), now: () => 10 }
  return { destination, ports, service: new BrowserImportService(ports) }
}
describe('human-only import protocol', () => {
  it('does not read or write cookies when native consent is canceled', async () => {
    const { service, ports } = setup(); ports.consent.mockResolvedValue(false)
    expect(await service.list('workspace')).toEqual([{ id: 'source', name: 'Personal', browser: 'Chrome' }])
    expect(await service.preview('workspace', 'source')).toBeNull()
    expect(ports.read).not.toHaveBeenCalled(); expect(ports.write).not.toHaveBeenCalled(); service.cancel()
  })
  it('returns only summaries and requires an explicit single-use commit to the bound destination', async () => {
    const { service, ports } = setup(); await service.list('workspace')
    const preview = await service.preview('workspace', 'source')
    expect(preview).toMatchObject({ skipped: 2, sites: [{ domain: 'example.test', count: 1, includesSubdomains: true }] })
    expect(JSON.stringify(preview)).not.toMatch(/never-send|private|session/)
    expect(ports.write).not.toHaveBeenCalled()
    await service.commit(preview!.id, ['example.test'])
    expect(ports.write.mock.calls[0]?.[0]).toMatchObject({ id: 'workspace' })
    await expect(service.commit(preview!.id, ['example.test'])).rejects.toMatchObject({ code: 'expired' })
  })
  it('invalidates an in-flight consent when canceled, without reading the profile', async () => {
    const { service, ports } = setup(); await service.list('workspace')
    let consent!: (value: boolean) => void
    ports.consent.mockImplementation(() => new Promise(resolve => { consent = resolve }))
    const pending = service.preview('workspace', 'source'); service.cancel(); consent(true)
    await expect(pending).rejects.toMatchObject({ code: 'expired' }); expect(ports.read).not.toHaveBeenCalled()
  })
  it('rejects changed workspace storage/policy and unselected or foreign profiles', async () => {
    const { service, destination, ports } = setup(); await service.list('workspace')
    await expect(service.preview('other', 'source')).rejects.toMatchObject({ code: 'expired' })
    await expect(service.preview('workspace', '/arbitrary/path')).rejects.toMatchObject({ code: 'expired' })
    const preview = await service.preview('workspace', 'source')
    await expect(service.commit(preview!.id, ['unselected.test'])).rejects.toMatchObject({ code: 'expired' })
    destination.fingerprint = 'replacement'
    await expect(service.commit(preview!.id, ['example.test'])).rejects.toMatchObject({ code: 'expired' })
    expect(ports.write).not.toHaveBeenCalled(); service.cancel()
  })
  it('expires previews', async () => {
    const { service, ports } = setup(); await service.list('workspace')
    const preview = await service.preview('workspace', 'source'); ports.now = () => 600_000
    await expect(service.commit(preview!.id, ['example.test'])).rejects.toMatchObject({ code: 'expired' })
    expect(ports.write).not.toHaveBeenCalled()
  })
  it('does not let a stale commit discard a newer preview', async () => {
    const { service, ports } = setup(); await service.list('workspace')
    const old = await service.preview('workspace', 'source')
    const current = await service.preview('workspace', 'source')
    await expect(service.commit(old!.id, ['example.test'])).rejects.toMatchObject({ code: 'expired' })
    await service.commit(current!.id, ['example.test'])
    expect(ports.write).toHaveBeenCalledTimes(1)
  })
  it('discards late source reads after cancellation', async () => {
    const { service, ports } = setup(); await service.list('workspace')
    let finish!: (value: Awaited<ReturnType<typeof ports.read>>) => void
    ports.read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = service.preview('workspace', 'source')
    await vi.waitFor(() => expect(ports.read).toHaveBeenCalled())
    service.cancel()
    const snapshot = { cookies: [{ domain: 'late.test', value: 'late-secret' } as Cookie], skipped: 0 }
    finish(snapshot)
    await expect(pending).rejects.toMatchObject({ code: 'expired' })
    expect(snapshot.cookies[0]!.value).toBe('')
    expect(ports.write).not.toHaveBeenCalled()
  })

  it('keeps a canceled in-flight write exclusive and clears secrets after it settles', async () => {
    const { service, ports } = setup()
    await service.list('workspace')
    const preview = await service.preview('workspace', 'source')
    let finish!: (value: Awaited<ReturnType<typeof ports.write>>) => void
    ports.write.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = service.commit(preview!.id, ['example.test'])
    const written = ports.write.mock.calls[0]![1]
    service.cancel()
    expect(written[0]!.value).toBe('never-send-to-renderer')
    await expect(service.list('workspace')).rejects.toMatchObject({ code: 'busy' })
    await expect(service.commit(preview!.id, ['example.test'])).rejects.toMatchObject({ code: 'busy' })
    finish({ imported: 1, skipped: 0, failed: 0, recoveryRequired: false })
    await expect(pending).resolves.toMatchObject({ imported: 1 })
    expect(written[0]!.value).toBe('')
    expect(ports.write).toHaveBeenCalledTimes(1)
    await service.list('workspace')
    service.cancel()
  })

})
