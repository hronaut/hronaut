import { execFile } from 'node:child_process'
import { pbkdf2Sync } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyStoreSecret, readLinuxBrowserKey, type KeyStoreAnswer } from '../src/main/browser-import/linux-browser-key.js'

vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), execFile: vi.fn() }))

// Chrome on a KDE desktop keeps its cookie key in KDE Wallet, which Hronaut did not read: its import stopped at
// "Browser key unavailable", the same message as a missing secret-tool or a locked keyring.

const homes: string[] = []
afterEach(async () => {
  vi.mocked(execFile).mockReset()
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

async function home(options: { wallet?: string; kwalletrc?: string } = {}): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'hronaut-key-'))
  homes.push(folder)
  if (options.wallet) {
    await mkdir(join(folder, '.local/share/kwalletd'), { recursive: true })
    await writeFile(join(folder, '.local/share/kwalletd', `${options.wallet}.kwl`), 'wallet')
  }
  if (options.kwalletrc !== undefined) {
    await mkdir(join(folder, '.config'), { recursive: true })
    await writeFile(join(folder, '.config/kwalletrc'), options.kwalletrc)
  }
  return folder
}

/** Key store commands that answer from a table: a secret, nothing, or missing from this computer. */
function commands(answers: { secretTool?: 'missing' | 'none' | string; kwalletQuery?: 'missing' | 'none' | string }) {
  const answer = (value: string | undefined): KeyStoreAnswer => value === undefined || value === 'none' ? { missing: false }
    : value === 'missing' ? { missing: true } : { secret: Buffer.from(value) }
  return vi.fn(async (file: string, _args: readonly string[]): Promise<KeyStoreAnswer> => (
    file === '/usr/bin/secret-tool' ? answer(answers.secretTool) : answer(answers.kwalletQuery)
  ))
}

const key = (secret: string) => pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1')
const gnome = { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }
const kde = { XDG_CURRENT_DESKTOP: 'KDE' }

describe('reading a Chromium browser’s cookie key on Linux', () => {
  it('reads Chrome’s key from the Secret Service keyring on GNOME', async () => {
    const run = commands({ secretTool: 'gnome-secret' })
    expect(await readLinuxBrowserKey('chrome', { run, home: await home(), environment: gnome })).toEqual(key('gnome-secret'))
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/secret-tool', ['lookup', 'application', 'chrome'], undefined)
  })

  it('reads Chrome’s key from KDE Wallet first on a KDE desktop', async () => {
    const run = commands({ kwalletQuery: 'kde-secret', secretTool: 'other' })
    expect(await readLinuxBrowserKey('chrome', { run, home: await home({ wallet: 'kdewallet' }), environment: kde })).toEqual(key('kde-secret'))
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/kwallet-query', ['--read-password', 'Chrome Safe Storage', '--folder', 'Chrome Keys', 'kdewallet'], undefined)
  })

  it('reads Chromium’s own entry, from the wallet kwalletrc names', async () => {
    const run = commands({ kwalletQuery: 'chromium-secret' })
    const folder = await home({ wallet: 'Work', kwalletrc: '[Migration]\nalreadyMigrated=true\n\n[Wallet]\nDefault Wallet=Work\nEnabled=true\n' })
    expect(await readLinuxBrowserKey('chromium', { run, home: folder, environment: { XDG_CURRENT_DESKTOP: 'KDE' } })).toEqual(key('chromium-secret'))
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/kwallet-query', ['--read-password', 'Chromium Safe Storage', '--folder', 'Chromium Keys', 'Work'], undefined)
  })

  it('asks the other store when the usual one has no key, for a browser started with another password store', async () => {
    const onGnome = commands({ secretTool: 'none', kwalletQuery: 'kde-secret' })
    expect(await readLinuxBrowserKey('chrome', { run: onGnome, home: await home({ wallet: 'kdewallet' }), environment: gnome })).toEqual(key('kde-secret'))
    expect(onGnome.mock.calls.map(([file]) => file)).toEqual(['/usr/bin/secret-tool', '/usr/bin/kwallet-query'])

    const onKde = commands({ kwalletQuery: 'none', secretTool: 'gnome-secret' })
    expect(await readLinuxBrowserKey('chrome', { run: onKde, home: await home({ wallet: 'kdewallet' }), environment: kde })).toEqual(key('gnome-secret'))
    expect(onKde.mock.calls.map(([file]) => file)).toEqual(['/usr/bin/kwallet-query', '/usr/bin/secret-tool'])
  })

  it('never asks KDE Wallet for a wallet that does not exist', async () => {
    const run = commands({ secretTool: 'none', kwalletQuery: 'kde-secret' })
    await expect(readLinuxBrowserKey('chrome', { run, home: await home({ kwalletrc: '[Wallet]\nDefault Wallet=Missing\n' }), environment: kde }))
      .rejects.toMatchObject({ code: 'keyUnavailable' })
    expect(run.mock.calls.map(([file]) => file)).toEqual(['/usr/bin/secret-tool'])
  })

  it('says which command to install when the one that could hold the key is missing', async () => {
    await expect(readLinuxBrowserKey('chrome', { run: commands({ secretTool: 'missing' }), home: await home(), environment: gnome }))
      .rejects.toMatchObject({ code: 'secretToolMissing' })
    await expect(readLinuxBrowserKey('chrome', { run: commands({ kwalletQuery: 'missing', secretTool: 'none' }), home: await home({ wallet: 'kdewallet' }), environment: kde }))
      .rejects.toMatchObject({ code: 'kwalletQueryMissing' })
    await expect(readLinuxBrowserKey('chrome', { run: commands({ kwalletQuery: 'missing', secretTool: 'missing' }), home: await home({ wallet: 'kdewallet' }), environment: gnome }))
      .rejects.toMatchObject({ code: 'secretToolMissing' })
  })

  it('says the key could not be read when every store answered without it', async () => {
    await expect(readLinuxBrowserKey('chrome', { run: commands({ secretTool: 'none', kwalletQuery: 'none' }), home: await home({ wallet: 'kdewallet' }), environment: gnome }))
      .rejects.toMatchObject({ code: 'keyUnavailable' })
  })

  it('reads no key for another application and wipes the secret once the key is made from it', async () => {
    const run = commands({ secretTool: 'gnome-secret' })
    await expect(readLinuxBrowserKey('firefox', { run, home: await home(), environment: gnome })).rejects.toMatchObject({ code: 'keyUnavailable' })
    expect(run).not.toHaveBeenCalled()

    const secret = Buffer.from('wiped-secret')
    await readLinuxBrowserKey('chrome', { run: async () => ({ secret }), home: await home(), environment: gnome })
    expect(secret.every((byte) => byte === 0)).toBe(true)
  })

  it('takes the printed secret without its newline, and none of kwallet-query’s reports as a secret', () => {
    expect(keyStoreSecret(Buffer.from('Xq3vV0n5yH0kF2aTq9w1Zg==\n'))).toEqual(Buffer.from('Xq3vV0n5yH0kF2aTq9w1Zg=='))
    expect(keyStoreSecret(Buffer.from('no-newline'))).toEqual(Buffer.from('no-newline'))
    expect(keyStoreSecret(Buffer.from('\n'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.alloc(0))).toBeUndefined()
    // KDE Frameworks 5 (Plasma 5, Kubuntu 24.04, Debian 12) ends these with exit status 0, and translates them.
    expect(keyStoreSecret(Buffer.from('Failed to read entry Chrome Safe Storage value from the kdewallet wallet.\n'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.from('The folder Chrome Keys does not exist!\nFailed to read entry Chrome Safe Storage value from the kdewallet wallet.\n'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.from('Der Wert des Eintrags Chrome Safe Storage aus dem Passwortspeicher kdewallet kann nicht gelesen werden.\n'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.from('Не удалось прочитать значение записи Chrome Safe Storage из бумажника kdewallet.\n'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.from('two\nlines\n'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.from('tab\tinside'))).toBeUndefined()
    expect(keyStoreSecret(Buffer.from('ключ'))).toBeUndefined()
  })

  it('asks no further store once the read is cancelled, and gives each command the signal that stops it', async () => {
    const controller = new AbortController()
    const run = vi.fn(async (_file: string, _args: readonly string[], signal?: AbortSignal): Promise<KeyStoreAnswer> => {
      expect(signal).toBe(controller.signal)
      controller.abort()
      return { missing: false }
    })
    await expect(readLinuxBrowserKey('chrome', { run, home: await home({ wallet: 'kdewallet' }), environment: gnome, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'expired' })
    expect(run.mock.calls.map(([file]) => file)).toEqual(['/usr/bin/secret-tool'])

    const cancelled = commands({ secretTool: 'gnome-secret' })
    await expect(readLinuxBrowserKey('chrome', { run: cancelled, home: await home(), environment: gnome, signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ code: 'expired' })
    expect(cancelled).not.toHaveBeenCalled()
  })

  it('finds a wallet by the file name KWallet gives it, and asks none for a name it would read as an option', async () => {
    const work = commands({ kwalletQuery: 'work-secret' })
    const folder = await home({ wallet: ';D0;A0;D0;B0;D0;B1;D0;BE;D1;82;D0;B0 2;3A;2F', kwalletrc: '[Wallet]\nDefault Wallet=Работа 2:/\n' })
    expect(await readLinuxBrowserKey('chrome', { run: work, home: folder, environment: kde })).toEqual(key('work-secret'))
    expect(work).toHaveBeenCalledExactlyOnceWith('/usr/bin/kwallet-query', ['--read-password', 'Chrome Safe Storage', '--folder', 'Chrome Keys', 'Работа 2:/'], undefined)

    // Not the default wallet either: that would ask another wallet than the one Chrome uses.
    const option = commands({ kwalletQuery: 'help-text', secretTool: 'none' })
    const optionHome = await home({ wallet: 'kdewallet', kwalletrc: '[Wallet]\nDefault Wallet=--help\n' })
    await writeFile(join(optionHome, '.local/share/kwalletd/--help.kwl'), 'wallet')
    await expect(readLinuxBrowserKey('chrome', { run: option, home: optionHome, environment: kde })).rejects.toMatchObject({ code: 'keyUnavailable' })
    expect(option.mock.calls.map(([file]) => file)).toEqual(['/usr/bin/secret-tool'])
  })

  it('reads kwalletrc and the wallet from the XDG folders, following a linked kwalletrc', async () => {
    const folder = await home()
    const config = join(folder, 'config'); const data = join(folder, 'data')
    await mkdir(join(data, 'kwalletd'), { recursive: true }); await mkdir(config, { recursive: true })
    await writeFile(join(data, 'kwalletd', 'Linked.kwl'), 'wallet')
    await writeFile(join(folder, 'dotfiles-kwalletrc'), '[Wallet]\nDefault Wallet=Linked\n')
    await symlink(join(folder, 'dotfiles-kwalletrc'), join(config, 'kwalletrc'))
    const run = commands({ kwalletQuery: 'linked-secret' })
    expect(await readLinuxBrowserKey('chrome', { run, home: folder, environment: { ...kde, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data } })).toEqual(key('linked-secret'))
    expect(run.mock.calls[0]![1].at(-1)).toBe('Linked')
  })
})

describe('running the key store commands', () => {
  type Callback = (error: NodeJS.ErrnoException | null, stdout: Buffer) => void
  function answer(error: NodeJS.ErrnoException | null, stdout: Buffer) {
    vi.mocked(execFile).mockImplementation(((_file: string, _args: readonly string[], _options: object, callback: Callback) => {
      callback(error, stdout)
    }) as unknown as typeof execFile)
  }

  it('runs the fixed command without a shell, with a time limit and the cancel signal, and wipes what it printed', async () => {
    const stdout = Buffer.from('Xq3vV0n5yH0kF2aTq9w1Zg==\n')
    const { signal } = new AbortController()
    answer(null, stdout)
    expect(await readLinuxBrowserKey('chrome', { home: await home(), environment: gnome, signal })).toEqual(key('Xq3vV0n5yH0kF2aTq9w1Zg=='))
    expect(execFile).toHaveBeenCalledExactlyOnceWith('/usr/bin/secret-tool', ['lookup', 'application', 'chrome'], { timeout: 60_000, maxBuffer: 4096, encoding: 'buffer', signal }, expect.any(Function))
    expect(stdout.every((byte) => byte === 0)).toBe(true)
  })

  it('reports a command this computer does not have as missing, and ignores what a failed one printed', async () => {
    answer(Object.assign(new Error('spawn /usr/bin/secret-tool ENOENT'), { code: 'ENOENT' }), Buffer.alloc(0))
    await expect(readLinuxBrowserKey('chrome', { home: await home(), environment: gnome })).rejects.toMatchObject({ code: 'secretToolMissing' })

    const printed = Buffer.from('Xq3vV0n5yH0kF2aTq9w1Zg==\n')
    answer(Object.assign(new Error('Command failed'), { code: 1 as unknown as string }), printed)
    await expect(readLinuxBrowserKey('chrome', { home: await home(), environment: gnome })).rejects.toMatchObject({ code: 'keyUnavailable' })
    expect(printed.every((byte) => byte === 0)).toBe(true)
  })
})
