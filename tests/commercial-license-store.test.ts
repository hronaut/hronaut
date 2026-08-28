import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommercialLicenseStore, type CommercialLicenseEncryption } from '../src/main/commercial-license-store.js'

const temporaryDirectories: string[] = []
const encryption: CommercialLicenseEncryption = {
  encrypt: async (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decrypt: async (value) => ({ result: value.toString('utf8').replace(/^protected:/, ''), shouldReEncrypt: false })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: CommercialLicenseStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-license-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'commercial-license.json')
  const store = new CommercialLicenseStore(path, encryption)
  await store.load()
  return { path, store }
}

describe('CommercialLicenseStore', () => {
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
