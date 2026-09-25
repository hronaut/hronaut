import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CredentialStore, type CredentialEncryption } from '../src/main/credential-store.js'

const temporaryDirectories: string[] = []
const encryption: CredentialEncryption = {
  encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decrypt: async (value) => ({ result: value.toString('utf8').replace(/^encrypted:/, ''), shouldReEncrypt: false })
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(credentialEncryption: CredentialEncryption = encryption): Promise<{ path: string; store: CredentialStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-credentials-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'credentials.json')
  return { path, store: new CredentialStore(path, credentialEncryption) }
}

describe('CredentialStore', () => {
  it('keeps multiple accounts for one origin and updates only the matching username', async () => {
    const { path, store } = await createStore()
    const alice = await store.save('https://x.example/login', 'alice', 'alice-original')
    const bob = await store.save('https://x.example/login', 'bob', 'bob-original')
    const updated = await store.save('https://x.example/another-route', 'alice', 'alice-updated')
    expect(updated.id).toBe(alice.id)
    expect(bob.id).not.toBe(alice.id)
    const reloaded = new CredentialStore(path, encryption)
    expect(await reloaded.load()).toEqual([
      expect.objectContaining({ id: alice.id, username: 'alice' }),
      expect.objectContaining({ id: bob.id, username: 'bob' })
    ])
    expect(await reloaded.password(alice.id)).toBe('alice-updated')
    expect(await reloaded.password(bob.id)).toBe('bob-original')
  })

  it('lets shutdown wait for an already-queued encrypted credential write', async () => {
    let releaseEncryption: () => void = () => undefined
    const encryptionGate = new Promise<void>((resolve) => { releaseEncryption = resolve })
    const delayedEncryption: CredentialEncryption = {
      ...encryption,
      encrypt: async (value) => {
        await encryptionGate
        return encryption.encrypt(value)
      }
    }
    const { path, store } = await createStore(delayedEncryption)
    const saving = store.save('https://shutdown-credential.example', 'person', 'private password')
    let flushSettled = false
    const flushing = store.flush().then(() => { flushSettled = true })

    await Promise.resolve()
    expect(flushSettled).toBe(false)
    releaseEncryption()
    await flushing

    await expect(saving).resolves.toMatchObject({ origin: 'https://shutdown-credential.example' })
    await expect(new CredentialStore(path, encryption).load()).resolves.toEqual([
      expect.objectContaining({ username: 'person' })
    ])
  })

  it('ignores a credential vault containing JSON null', async () => {
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'null\n', 'utf8')

    await expect(store.load()).resolves.toEqual([])
  })

  it('persists encrypted passwords and exposes metadata only', async () => {
    const { path, store } = await createStore()
    const saved = await store.save('https://example.com/login', 'person@example.com', 'correct horse battery staple')
    expect(saved).toMatchObject({ origin: 'https://example.com', username: 'person@example.com' })
    expect('encryptedPassword' in saved).toBe(false)
    const file = await readFile(path, 'utf8')
    expect(file).not.toContain('correct horse battery staple')

    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([saved])
    expect(await restored.password(saved.id)).toBe('correct horse battery staple')
  })

  it('returns a password after transparently re-encrypting the same credential', async () => {
    let encryptionCount = 0
    const rotatingEncryption: CredentialEncryption = {
      encrypt: async (value) => Buffer.from(`encrypted-${++encryptionCount}:${value}`, 'utf8'),
      decrypt: async (value) => ({
        result: value.toString('utf8').replace(/^encrypted-\d+:/, ''),
        shouldReEncrypt: true
      })
    }
    const { path, store } = await createStore(rotatingEncryption)
    const saved = await store.save('https://example.com', 'person', 'private password')

    await expect(store.password(saved.id)).resolves.toBe('private password')

    const persisted = await readFile(path, 'utf8')
    expect(persisted).toContain(Buffer.from('encrypted-2:private password').toString('base64'))
    expect(persisted).not.toContain('private password')
  })

  it.skipIf(process.platform === 'win32')('does not follow a pre-existing temporary-file symlink while saving the vault', async () => {
    const { path, store } = await createStore()
    const unrelatedPath = join(dirname(path), 'unrelated.txt')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(unrelatedPath, 'keep this file intact\n', 'utf8')
    await symlink(unrelatedPath, `${path}.tmp`)

    await store.save('https://example.com', 'person', 'private password')

    expect(await readFile(unrelatedPath, 'utf8')).toBe('keep this file intact\n')
    expect(await readFile(path, 'utf8')).not.toContain('private password')
  })

  it('updates the matching origin and username instead of creating duplicates', async () => {
    const { store } = await createStore()
    const original = await store.save('https://example.com', 'person', 'old password')
    const updated = await store.save('https://example.com/account', 'person', 'new password')
    expect(updated.id).toBe(original.id)
    expect(updated.createdAt).toBe(original.createdAt)
    expect(store.list()).toHaveLength(1)
    expect(await store.password(original.id)).toBe('new password')
  })

  it('atomically imports unique browser accounts and keeps the last duplicate row', async () => {
    const { path, store } = await createStore()
    const existing = await store.save('https://example.com', 'person', 'old password')

    const result = await store.importMany([
      { origin: 'https://example.com/login', username: 'person', password: 'first imported password' },
      { origin: 'https://new.example/sign-in', username: 'new person', password: 'first new password' },
      { origin: 'https://example.com/account', username: 'person', password: 'final imported password' },
      { origin: 'https://new.example/other', username: 'new person', password: 'final new password' }
    ])

    expect(result).toEqual({ added: 1, updated: 1, duplicateRows: 2 })
    expect(store.list()).toHaveLength(2)
    expect(store.list().find((entry) => entry.origin === 'https://example.com')?.id).toBe(existing.id)
    expect(await store.password(existing.id)).toBe('final imported password')
    const added = store.list().find((entry) => entry.origin === 'https://new.example')!
    expect(await store.password(added.id)).toBe('final new password')

    const persisted = await readFile(path, 'utf8')
    expect(persisted).not.toContain('imported password')
    expect(persisted).not.toContain('new password')
  })

  it('keeps the complete vault unchanged when imported encryption fails', async () => {
    const failingEncryption: CredentialEncryption = {
      ...encryption,
      encrypt: async (value) => {
        if (value === 'cannot encrypt') throw new Error('encryption unavailable')
        return encryption.encrypt(value)
      }
    }
    const { path, store } = await createStore(failingEncryption)
    const existing = await store.save('https://example.com', 'person', 'original password')
    const before = await readFile(path, 'utf8')

    await expect(store.importMany([
      { origin: 'https://new.example', username: 'new', password: 'encryptable' },
      { origin: 'https://broken.example', username: 'broken', password: 'cannot encrypt' }
    ])).rejects.toThrow('encryption unavailable')

    expect(store.list()).toEqual([existing])
    expect(await store.password(existing.id)).toBe('original password')
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('serializes overlapping saves for the same account and keeps the last password', async () => {
    let releaseEncryption: () => void = () => undefined
    const encryptionGate = new Promise<void>((resolve) => { releaseEncryption = resolve })
    const delayedEncryption: CredentialEncryption = {
      ...encryption,
      encrypt: async (value) => {
        await encryptionGate
        return encryption.encrypt(value)
      }
    }
    const { path, store } = await createStore(delayedEncryption)

    const firstSave = store.save('https://example.com/login', 'person', 'first password')
    const secondSave = store.save('https://example.com/account', 'person', 'second password')
    releaseEncryption()
    const [first, second] = await Promise.all([firstSave, secondSave])

    expect(second.id).toBe(first.id)
    expect(store.list()).toHaveLength(1)
    expect(await store.password(first.id)).toBe('second password')
    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toHaveLength(1)
    expect(await restored.password(first.id)).toBe('second password')
  })

  it('keeps removal ordered behind an overlapping password update', async () => {
    let blockEncryption = false
    let releaseEncryption: () => void = () => undefined
    const encryptionGate = new Promise<void>((resolve) => { releaseEncryption = resolve })
    const delayedEncryption: CredentialEncryption = {
      ...encryption,
      encrypt: async (value) => {
        if (blockEncryption) await encryptionGate
        return encryption.encrypt(value)
      }
    }
    const { path, store } = await createStore(delayedEncryption)
    const saved = await store.save('https://example.com', 'person', 'first password')

    blockEncryption = true
    const pendingUpdate = store.save('https://example.com/account', 'person', 'updated password')
    const pendingRemoval = store.remove(saved.id)
    releaseEncryption()
    await expect(pendingUpdate).resolves.toMatchObject({ id: saved.id })
    await expect(pendingRemoval).resolves.toBe(true)

    expect(store.list()).toEqual([])
    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([])
  })

  it.each([
    ['updated', async (store: CredentialStore, id: string) => {
      await expect(store.save('https://example.com/account', 'person', 'new password')).resolves.toMatchObject({ id })
    }],
    ['removed', async (store: CredentialStore, id: string) => {
      await expect(store.remove(id)).resolves.toBe(true)
    }],
    ['cleared', async (store: CredentialStore) => {
      await store.clear()
    }]
  ] as const)('rejects a decrypted password after its credential is %s', async (_operation, mutate) => {
    let releaseDecryption: () => void = () => undefined
    const decryptionGate = new Promise<void>((resolve) => { releaseDecryption = resolve })
    let decryptionStarted: () => void = () => undefined
    const decryptionStart = new Promise<void>((resolve) => { decryptionStarted = resolve })
    const delayedDecryption: CredentialEncryption = {
      ...encryption,
      decrypt: async (value) => {
        decryptionStarted()
        await decryptionGate
        return { ...await encryption.decrypt(value), shouldReEncrypt: true }
      }
    }
    const { store } = await createStore(delayedDecryption)
    const saved = await store.save('https://example.com', 'person', 'old password')

    const pendingPassword = store.password(saved.id)
    await decryptionStart
    await mutate(store, saved.id)
    releaseDecryption()

    await expect(pendingPassword).rejects.toThrow('Saved credential changed during access')
  })

  it('repairs duplicate persisted accounts by keeping the newest password', async () => {
    const now = Date.UTC(2026, 8, 16, 12)
    vi.useFakeTimers()
    vi.setSystemTime(now - 1_000)
    const { path, store } = await createStore()
    const original = await store.save('https://example.com', 'person', 'old password')
    vi.setSystemTime(now)
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      version: 1
      credentials: Array<Record<string, string>>
    }
    persisted.credentials.push({
      ...persisted.credentials[0]!,
      id: 'newer-duplicate',
      encryptedPassword: Buffer.from('encrypted:new password', 'utf8').toString('base64'),
      updatedAt: new Date(now).toISOString()
    })
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([
      expect.objectContaining({ id: 'newer-duplicate', origin: original.origin, username: original.username })
    ])
    expect(await restored.password('newer-duplicate')).toBe('new password')
    expect((JSON.parse(await readFile(path, 'utf8')) as { credentials: unknown[] }).credentials).toHaveLength(1)
  })

  it('does not let a clock-skewed duplicate replace the current saved password', async () => {
    const now = Date.UTC(2026, 8, 16, 12)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const { path, store } = await createStore()
    const current = await store.save('https://example.com', 'person', 'current password')
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      version: 1
      credentials: Array<Record<string, string>>
    }
    persisted.credentials.push({
      ...persisted.credentials[0]!,
      id: 'clock-skewed-duplicate',
      encryptedPassword: Buffer.from('encrypted:stale password', 'utf8').toString('base64'),
      updatedAt: new Date(now + 24 * 60 * 60 * 1_000).toISOString()
    })
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([
      expect.objectContaining({ id: current.id, updatedAt: new Date(now).toISOString() })
    ])
    expect(await restored.password(current.id)).toBe('current password')
    const repaired = JSON.parse(await readFile(path, 'utf8')) as {
      credentials: Array<{ id: string; updatedAt: string }>
    }
    expect(repaired.credentials).toEqual([
      expect.objectContaining({ id: current.id, updatedAt: new Date(now).toISOString() })
    ])
  })

  it('repairs future and inverted timestamps on a single saved credential', async () => {
    const now = Date.UTC(2026, 8, 16, 12)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const { path, store } = await createStore()
    const saved = await store.save('https://example.com', 'person', 'private password')
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      credentials: Array<Record<string, string>>
    }
    persisted.credentials[0]!.createdAt = new Date(now + 2_000).toISOString()
    persisted.credentials[0]!.updatedAt = new Date(now + 1_000).toISOString()
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([
      expect.objectContaining({
        id: saved.id,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString()
      })
    ])
    expect((JSON.parse(await readFile(path, 'utf8')) as { credentials: unknown[] }).credentials).toEqual([
      expect.objectContaining({
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString()
      })
    ])
  })

  it('repairs duplicate persisted IDs without dropping either account', async () => {
    const { path, store } = await createStore()
    const first = await store.save('https://one.example', 'one', 'secret one')
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      version: 1
      credentials: Array<Record<string, string>>
    }
    persisted.credentials.push({
      ...persisted.credentials[0]!,
      origin: 'https://two.example',
      username: 'two',
      encryptedPassword: Buffer.from('encrypted:secret two', 'utf8').toString('base64')
    })
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new CredentialStore(path, encryption)
    const accounts = await restored.load()
    expect(accounts).toHaveLength(2)
    expect(accounts.map((account) => account.origin)).toEqual(['https://one.example', 'https://two.example'])
    expect(new Set(accounts.map((account) => account.id))).toHaveProperty('size', 2)
    expect(await restored.password(first.id)).toBe('secret one')
    const second = accounts.find((account) => account.origin === 'https://two.example')!
    expect(await restored.password(second.id)).toBe('secret two')
    const repaired = JSON.parse(await readFile(path, 'utf8')) as { credentials: Array<{ id: string }> }
    expect(new Set(repaired.credentials.map((account) => account.id))).toHaveProperty('size', 2)
  })

  it('removes malformed persisted credentials from the encrypted vault file', async () => {
    const { path, store } = await createStore()
    const saved = await store.save('https://example.com', 'person', 'valid password')
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      version: 1
      credentials: Array<Record<string, string>>
    }
    persisted.credentials.push({
      ...persisted.credentials[0]!,
      id: 'unsafe-origin',
      origin: 'file:///tmp/private.html',
      encryptedPassword: 'invalid-private-payload'
    })
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([saved])
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toContain('invalid-private-payload')
    expect((JSON.parse(repaired) as { credentials: unknown[] }).credentials).toHaveLength(1)
  })

  it('keeps the in-memory vault unchanged when persistence fails', async () => {
    const { path, store } = await createStore()
    const saved = await store.save('https://example.com', 'person', 'original password')
    const profileDirectory = dirname(path)
    const backupDirectory = `${profileDirectory}-backup`

    const blockPersistence = async (): Promise<void> => {
      await rename(profileDirectory, backupDirectory)
      await writeFile(profileDirectory, 'blocks credential directory creation', 'utf8')
    }
    const restorePersistence = async (): Promise<void> => {
      await rm(profileDirectory, { force: true })
      await rename(backupDirectory, profileDirectory)
    }

    await blockPersistence()
    await expect(store.save('https://example.com/account', 'person', 'lost update')).rejects.toThrow()
    expect(store.list()).toEqual([saved])
    expect(await store.password(saved.id)).toBe('original password')
    await restorePersistence()

    await blockPersistence()
    await expect(store.remove(saved.id)).rejects.toThrow()
    expect(store.list()).toEqual([saved])
    await restorePersistence()

    await blockPersistence()
    await expect(store.clear()).rejects.toThrow()
    expect(store.list()).toEqual([saved])
    await restorePersistence()

    const restored = new CredentialStore(path, encryption)
    expect(await restored.load()).toEqual([saved])
    expect(await restored.password(saved.id)).toBe('original password')
  })

  it('removes one credential or clears the complete vault', async () => {
    const { store } = await createStore()
    const first = await store.save('https://one.example', 'one', 'secret one')
    await store.save('https://two.example', 'two', 'secret two')
    expect(await store.remove(first.id)).toBe(true)
    expect(store.list().map((credential) => credential.origin)).toEqual(['https://two.example'])
    await store.clear()
    expect(store.list()).toEqual([])
  })

  it('rejects unsafe origins and empty passwords', async () => {
    const { store } = await createStore()
    await expect(store.save('file:///tmp/login', 'person', 'secret')).rejects.toThrow('HTTP or HTTPS')
    await expect(store.save('https://example.com', 'person', '')).rejects.toThrow('between 1 and 16384')
  })
})
