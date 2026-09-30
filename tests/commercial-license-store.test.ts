import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommercialLicenseStore, commercialLicenseStateRefreshDelay, TRIAL_DURATION_MS, LICENSE_OFFLINE_GRACE_MS, type CommercialLicenseEncryption } from '../src/main/commercial-license-store.js'

const temporaryDirectories: string[] = []
const encryption: CommercialLicenseEncryption = {
  encrypt: async (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decrypt: async (value) => ({ result: value.toString('utf8').replace(/^protected:/, ''), shouldReEncrypt: false })
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(
  commercialLicenseEncryption: CommercialLicenseEncryption = encryption
): Promise<{ path: string; store: CommercialLicenseStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-license-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'commercial-license.json')
  const store = new CommercialLicenseStore(path, commercialLicenseEncryption)
  await store.load()
  return { path, store }
}

describe('CommercialLicenseStore', () => {
  it('lets shutdown wait for an already-queued encrypted activation write', async () => {
    let releaseEncryption: () => void = () => undefined
    const encryptionGate = new Promise<void>((resolve) => { releaseEncryption = resolve })
    const delayedEncryption: CommercialLicenseEncryption = {
      ...encryption,
      encrypt: async (value) => {
        await encryptionGate
        return encryption.encrypt(value)
      }
    }
    const { path, store } = await createStore(delayedEncryption)
    const activating = store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_shutdown1234'
    })
    let flushSettled = false
    const flushing = store.flush().then(() => { flushSettled = true })

    await Promise.resolve()
    expect(flushSettled).toBe(false)
    releaseEncryption()
    await flushing
    await activating

    const restored = new CommercialLicenseStore(path, encryption)
    await restored.load()
    expect(restored.summary(true)).toMatchObject({ active: true, maskedKey: '••••-MNOP' })
  })

  it('keeps a stable anonymous installation name before activation', async () => {
    const { path, store } = await createStore()
    const installationName = store.installationName()

    const restarted = new CommercialLicenseStore(path, encryption)
    await restarted.load()

    expect(restarted.installationName()).toBe(installationName)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      version: 1,
      installationId: expect.any(String)
    })
  })

  it('persists the license key encrypted and exposes only a suffix', async () => {
    const { path, store } = await createStore()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234',
      activations: 1,
      activationLimit: 3,
      expiresAt: null
    })

    const file = await readFile(path, 'utf8')
    expect(file).not.toContain('ABCD-EFGH-IJKL-MNOP')
    expect(store.summary(true)).toMatchObject({ active: true, maskedKey: '••••-MNOP', activationLimit: 3 })
    expect(await store.credentials()).toEqual({ licenseKey: 'ABCD-EFGH-IJKL-MNOP', instanceId: 'inst_abcdefgh1234' })
  })

  it.skipIf(process.platform === 'win32')('does not follow a pre-existing temporary-file symlink while saving the license', async () => {
    const { path, store } = await createStore()
    const unrelatedPath = join(dirname(path), 'unrelated.txt')
    await writeFile(unrelatedPath, 'keep this file intact\n', 'utf8')
    await symlink(unrelatedPath, `${path}.tmp`)

    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234'
    })

    expect(await readFile(unrelatedPath, 'utf8')).toBe('keep this file intact\n')
    expect(await readFile(path, 'utf8')).not.toContain('ABCD-EFGH-IJKL-MNOP')
  })

  it('keeps a stable anonymous installation name after deactivation', async () => {
    const { store } = await createStore()
    const name = store.installationName()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234',
      activationLimit: 3
    })
    await store.clear()
    expect(store.installationName()).toBe(name)
    expect(store.summary(true)).toMatchObject({ active: false, status: 'not-activated' })
  })

  it('marks a retained activation inactive when the subscription no longer grants access', async () => {
    const { store } = await createStore()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234',
      activationLimit: 3
    })

    await store.markInactive()

    expect(store.summary(true)).toMatchObject({ active: false, status: 'inactive', maskedKey: '••••-MNOP' })
    expect(await store.credentials()).toEqual({ licenseKey: 'ABCD-EFGH-IJKL-MNOP', instanceId: 'inst_abcdefgh1234' })
  })

  it('does not retain an active grant when validation says the license is invalid', async () => {
    const { store } = await createStore()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234'
    })

    await store.saveValidation({
      valid: false,
      status: 'active',
      productId: 'prod_hronaut'
    })

    expect(store.summary(true)).toMatchObject({ active: false, status: 'inactive', maskedKey: '••••-MNOP' })
  })

  it('stops granting offline access after the stored subscription expiration', async () => {
    const { store } = await createStore()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234',
      expiresAt: '2000-01-01T00:00:00.000Z'
    })

    expect(store.summary(true)).toMatchObject({ active: false, status: 'expired', maskedKey: '••••-MNOP' })
    expect(await store.credentials()).toEqual({ licenseKey: 'ABCD-EFGH-IJKL-MNOP', instanceId: 'inst_abcdefgh1234' })
  })

  it('keeps the current license state when mutations cannot be persisted', async () => {
    const { path, store } = await createStore()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234',
      activationLimit: 3
    })
    const before = store.summary(true)
    const profileDirectory = dirname(path)
    const backupDirectory = `${profileDirectory}-backup`
    await rename(profileDirectory, backupDirectory)
    await writeFile(profileDirectory, 'blocks license directory creation', 'utf8')

    await expect(store.saveValidation({ valid: false, status: 'inactive', productId: 'prod_hronaut' })).rejects.toThrow()
    expect(store.summary(true)).toEqual(before)
    await expect(store.markInactive()).rejects.toThrow()
    expect(store.summary(true)).toEqual(before)
    await expect(store.clear()).rejects.toThrow()
    expect(store.summary(true)).toEqual(before)
    await expect(store.saveActivation('WXYZ-EFGH-IJKL-QRST', {
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_replacement1234'
    })).rejects.toThrow()
    expect(store.summary(true)).toEqual(before)

    await rm(profileDirectory, { force: true })
    await rename(backupDirectory, profileDirectory)
    const restored = new CommercialLicenseStore(path, encryption)
    await restored.load()
    expect(restored.summary(true)).toEqual(before)
  })
})


describe('paid automation access', () => {
  it('starts once at first use and expires exactly after ten days across restarts and deactivation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    const { path, store } = await createStore()
    expect(store.summary(true)).toMatchObject({ trialStatus: 'not-started', accessAllowed: false })
    await store.authorizeAutomation()
    const expiry = store.summary(true).trialExpiresAt
    expect(expiry).toBe('2026-09-19T12:00:00.000Z')
    vi.setSystemTime(Date.now() + TRIAL_DURATION_MS - 1)
    const restarted = new CommercialLicenseStore(path, encryption)
    await restarted.load()
    await restarted.clear()
    await expect(restarted.authorizeAutomation()).resolves.toBeUndefined()
    expect(restarted.summary(true).trialExpiresAt).toBe(expiry)
    vi.setSystemTime(Date.now() + 1)
    await expect(restarted.authorizeAutomation()).rejects.toThrow('active subscription')
    expect(restarted.summary(true)).toMatchObject({ trialStatus: 'expired', accessAllowed: false })
  })

  it('does not grant a fresh trial from a corrupt persisted license file', async () => {
    const { path } = await createStore()
    await writeFile(path, '{broken')
    const restarted = new CommercialLicenseStore(path, encryption)
    await restarted.load()
    await expect(restarted.authorizeAutomation()).rejects.toThrow('active subscription')
  })

  it('bounds offline paid access and restores it only after successful validation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    const { store } = await createStore()
    const grant = { valid: true, status: 'active', productId: 'prod_hronaut', instanceId: 'inst_paid' }
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', grant)
    await expect(store.authorizeAutomation()).resolves.toBeUndefined()
    expect(store.summary(true).trialStatus).toBe('not-started')
    vi.setSystemTime(Date.now() + LICENSE_OFFLINE_GRACE_MS)
    await expect(store.authorizeAutomation()).rejects.toThrow('active subscription')
    await store.saveValidation(grant)
    await expect(store.authorizeAutomation()).resolves.toBeUndefined()
    await store.markInactive()
    await expect(store.authorizeAutomation()).rejects.toThrow('active subscription')
  })

  it('does not reopen an expired trial when the clock moves backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.parse('2026-09-09T12:00:00Z')
    vi.setSystemTime(start)
    const { path, store } = await createStore()
    await store.authorizeAutomation()
    vi.setSystemTime(start + TRIAL_DURATION_MS)
    await expect(store.authorizeAutomation()).rejects.toThrow()
    vi.setSystemTime(start)
    const restarted = new CommercialLicenseStore(path, encryption)
    await restarted.load()
    await expect(restarted.authorizeAutomation()).rejects.toThrow()
  })
  it('does not reopen an expired subscription when the clock moves backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.parse('2026-09-09T12:00:00Z')
    vi.setSystemTime(start)
    const { store } = await createStore()
    await store.saveActivation('ABCD-EFGH-IJKL-MNOP', {
      valid: true, status: 'active', productId: 'prod_hronaut', instanceId: 'inst_paid',
      expiresAt: new Date(start + 60_000).toISOString()
    })
    vi.setSystemTime(start + 60_000)
    await expect(store.authorizeAutomation()).rejects.toThrow()
    vi.setSystemTime(start)
    await expect(store.authorizeAutomation()).rejects.toThrow()
  })

})


it('schedules elapsed-state publication at trial, paid and offline boundaries without provider traffic', () => {
  const now = Date.parse('2026-09-30T20:00:00Z')
  const state = { status: 'active', active: true, secureStorageAvailable: true }
  expect(commercialLicenseStateRefreshDelay(state, now)).toBe(60_000)
  expect(commercialLicenseStateRefreshDelay({ ...state, trialExpiresAt: new Date(now + 1500).toISOString() }, now)).toBe(1500)
  expect(commercialLicenseStateRefreshDelay({ ...state, expiresAt: new Date(now + 500).toISOString() }, now)).toBe(500)
  expect(commercialLicenseStateRefreshDelay({ ...state, lastValidatedAt: new Date(now - LICENSE_OFFLINE_GRACE_MS + 250).toISOString() }, now)).toBe(250)
  expect(commercialLicenseStateRefreshDelay({ ...state, expiresAt: 'invalid' }, now)).toBe(60_000)
})

it('rechecks elapsed entitlement without starting a trial or writing, and accepts renewal', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const { store, path } = await createStore()
  expect(() => store.assertAutomationAccess()).toThrow('active subscription')
  expect(store.summary(true).trialStatus).toBe('not-started')
  await store.authorizeAutomation()
  const before = await readFile(path, 'utf8')
  vi.setSystemTime(Date.now() + TRIAL_DURATION_MS)
  expect(() => store.assertAutomationAccess()).toThrow('active subscription')
  expect(await readFile(path, 'utf8')).toBe(before)
  await store.saveActivation('SYNTHETIC-LICENSE', { valid: true, status: 'active', productId: 'test', instanceId: 'test' })
  expect(() => store.assertAutomationAccess()).not.toThrow()
})
