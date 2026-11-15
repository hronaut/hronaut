import { chmod, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CredentialStore, type CredentialEncryption } from '../src/main/credentials/credential-store.js'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open), rename: vi.fn(fs.rename) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

const temporaryDirectories: string[] = []
const encryption: CredentialEncryption = {
  encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decrypt: async (value) => ({ result: value.toString('utf8').replace(/^encrypted:/, ''), shouldReEncrypt: false })
}

afterEach(async () => {
  vi.useRealTimers()
  vi.mocked(open).mockReset().mockImplementation(actualFs.open)
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename)
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

  it.each([
    ['cut short', (saved: string) => saved.slice(0, -3)],
    ['from a newer version', (saved: string) => JSON.stringify({ ...JSON.parse(saved), version: 2 })]
  ])('keeps a saved-passwords file %s aside instead of replacing it on the next save', async (_case, damage) => {
    // The next saved password replaced the file, and every password in it was gone.
    const { path, store } = await createStore()
    for (const index of [1, 2, 3]) await store.save(`https://site${index}.example`, `user${index}`, `secret ${index}`)
    const unreadable = damage(await readFile(path, 'utf8'))
    await writeFile(path, unreadable, 'utf8')
    // A copied or restored file can be readable by others; the kept one is not.
    await chmod(path, 0o644)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const reopened = new CredentialStore(path, encryption)
      await expect(reopened.load()).resolves.toEqual([])
      // Until something is saved the file stays in place, so a newer Hronaut opened again still finds it.
      expect(await readdir(dirname(path))).toEqual(['credentials.json'])

      await reopened.save('https://new.example', 'new', 'new secret')
      await reopened.save('https://second.example', 'second', 'second secret')

      const files = await readdir(dirname(path))
      const aside = files.find((name) => /^credentials\.json\.unreadable-\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(name))
      expect(files.sort()).toEqual(['credentials.json', aside].sort())
      expect(await readFile(join(dirname(path), aside!), 'utf8')).toBe(unreadable)
      if (process.platform !== 'win32') expect((await stat(join(dirname(path), aside!))).mode & 0o777).toBe(0o600)
      expect(reopened.list().map((credential) => credential.origin)).toEqual(['https://new.example', 'https://second.example'])
      expect(warn).toHaveBeenCalledExactlyOnceWith('[credentials] Kept an unreadable saved-passwords file aside before saving a new one.')
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps an unreadable saved-passwords file aside when passwords are imported', async () => {
    const { path, store } = await createStore()
    await store.save('https://site.example', 'user', 'secret')
    await writeFile(path, '{"version":', 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const reopened = new CredentialStore(path, encryption)
      await reopened.load()
      await reopened.importMany([{ origin: 'https://imported.example', username: 'imported', password: 'imported secret' }])

      const files = await readdir(dirname(path))
      const aside = files.find((name) => name.startsWith('credentials.json.unreadable-'))
      expect(files.sort()).toEqual(['credentials.json', aside].sort())
      expect(await readFile(join(dirname(path), aside!), 'utf8')).toBe('{"version":')
    } finally {
      warn.mockRestore()
    }
  })

  it.each([
    ['could not move it or write', ['busy', 'busy']],
    ['moved it but could not write', ['actual', 'busy']]
  ] as const)('still keeps an unreadable saved-passwords file aside after a save that %s', async (_case, renames) => {
    // A save that failed, as on Windows while a sync tool holds the file, gave up keeping it, and the next save replaced it.
    const { path, store } = await createStore()
    await store.save('https://site.example', 'user', 'secret')
    await writeFile(path, '{"version":', 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const reopened = new CredentialStore(path, encryption)
      await reopened.load()
      const busy = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
      for (const outcome of renames) {
        if (outcome === 'busy') vi.mocked(rename).mockRejectedValueOnce(busy)
        else vi.mocked(rename).mockImplementationOnce(actualFs.rename)
      }
      await expect(reopened.save('https://new.example', 'new', 'new secret')).rejects.toThrow('resource busy or locked')

      await reopened.save('https://new.example', 'new', 'new secret')
      const files = await readdir(dirname(path))
      const aside = files.find((name) => name.startsWith('credentials.json.unreadable-'))
      expect(files.sort()).toEqual(['credentials.json', aside].sort())
      expect(await readFile(join(dirname(path), aside!), 'utf8')).toBe('{"version":')
      expect(reopened.list().map((credential) => credential.origin)).toEqual(['https://new.example'])
      expect(warn).toHaveBeenLastCalledWith('[credentials] Kept an unreadable saved-passwords file aside before saving a new one.')
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps only the unreadable saved-passwords file aside when a save fails after writing the new one', async () => {
    // The new file was in place, but the save still counted the unreadable one as waiting, so the next save moved the new
    // file aside as well.
    const { path, store } = await createStore()
    await store.save('https://site.example', 'user', 'secret')
    await writeFile(path, '{"version":', 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const reopened = new CredentialStore(path, encryption)
      await reopened.load()
      // Flushing the folder, after the new file replaced the old one, fails.
      vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error('i/o error'), { code: 'EIO' }))
      await expect(reopened.save('https://new.example', 'new', 'new secret')).rejects.toThrow('i/o error')

      await reopened.save('https://new.example', 'new', 'new secret')
      const files = await readdir(dirname(path))
      const aside = files.find((name) => name.startsWith('credentials.json.unreadable-'))
      expect(files.sort()).toEqual(['credentials.json', aside].sort())
      expect(await readFile(join(dirname(path), aside!), 'utf8')).toBe('{"version":')
      expect(warn).toHaveBeenCalledExactlyOnceWith('[credentials] Kept an unreadable saved-passwords file aside before saving a new one.')
    } finally {
      warn.mockRestore()
    }
  })

  it.each([
    ['an unreadable file', '{"version":'],
    ['saved passwords', null]
  ])('removes the saved-passwords files kept aside when every password is removed from %s', async (_case, damaged) => {
    const { path, store } = await createStore()
    await store.save('https://site.example', 'user', 'secret')
    await writeFile(`${path}.unreadable-2026-10-01T00-00-00-000Z`, '{"version":2}', 'utf8')
    if (damaged) await writeFile(path, damaged, 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const reopened = new CredentialStore(path, encryption)
      await reopened.load()

      await reopened.clear()
      expect(await readdir(dirname(path))).toEqual(['credentials.json'])
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, credentials: [] })
    } finally {
      warn.mockRestore()
    }
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

  // The secure storage asks for a password to be re-encrypted after its key changes. When that re-encryption failed,
  // the fill failed with the storage's own untranslated error although the password had already decrypted.
  it('still returns a decrypted password when re-encrypting it fails, and keeps the saved entry', async () => {
    let refuseEncryption = false
    const refusingEncryption: CredentialEncryption = {
      encrypt: async (value) => {
        if (refuseEncryption) throw new Error('Secure storage backend refused the operation')
        return Buffer.from(`encrypted:${value}`, 'utf8')
      },
      decrypt: async (value) => ({ result: value.toString('utf8').replace(/^encrypted:/, ''), shouldReEncrypt: true })
    }
    const { path, store } = await createStore(refusingEncryption)
    const saved = await store.save('https://example.com', 'person', 'private password')
    const before = await readFile(path, 'utf8')
    refuseEncryption = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(store.password(saved.id)).resolves.toBe('private password')
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('[credentials] Could not re-encrypt a saved password; it keeps its previous encryption.')
    warn.mockRestore()
    refuseEncryption = false
    await expect(store.password(saved.id)).resolves.toBe('private password')
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
