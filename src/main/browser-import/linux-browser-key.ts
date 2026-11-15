import { pbkdf2Sync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { BrowserImportError } from './contracts.js'

/** What a key store's command gave back: the secret, nothing, or no such command on this computer. */
export type KeyStoreAnswer = { secret: Buffer } | { secret?: undefined; missing: boolean }

/** Runs one of the fixed key store commands and returns what it printed; the signal stops it. */
export type KeyStoreCommand = (file: string, args: readonly string[], signal?: AbortSignal) => Promise<KeyStoreAnswer>

const SECRET_TOOL = '/usr/bin/secret-tool'
const KWALLET_QUERY = '/usr/bin/kwallet-query'
// Both may ask to unlock the keyring or wallet first, and wait while the person types its password.
const COMMAND_TIMEOUT_MS = 60_000

/** Where Chrome and Chromium keep their cookie key: the Secret Service attribute, and the KDE Wallet folder and entry. */
const BROWSER_KEYS = {
  chrome: { application: 'chrome', folder: 'Chrome Keys', entry: 'Chrome Safe Storage' },
  chromium: { application: 'chromium', folder: 'Chromium Keys', entry: 'Chromium Safe Storage' }
} as const

/** The bytes KWallet keeps as they are in a wallet's file name; it writes each other byte as ";XX". */
const WALLET_FILE_NAME_BYTES = new Set(Buffer.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789^&'@{}[],$=!-#()%.+_\r\n\t\f\v "))

export interface LinuxBrowserKeyOptions {
  run?: KeyStoreCommand
  home?: string
  environment?: NodeJS.ProcessEnv
  /** Ends the read when the person cancels the import or reads another profile, closing a command still waiting. */
  signal?: AbortSignal
}

/**
 * Reads a Chromium browser's Linux cookie key, its "Safe Storage" password, from where the browser keeps it: the Secret
 * Service keyring (GNOME and most desktops) or KDE Wallet (KDE, as Chrome picks there). Each is asked through its own
 * command, which may ask the person to unlock it. Only called after native read consent; never writes or creates a
 * keyring or wallet entry, and asks KDE Wallet only for a wallet that exists, so a computer without one never starts
 * the wallet service.
 */
export async function readLinuxBrowserKey(application: string, options: LinuxBrowserKeyOptions = {}): Promise<Buffer> {
  if (application !== 'chrome' && application !== 'chromium') throw new BrowserImportError('keyUnavailable')
  const run = options.run ?? runKeyStoreCommand
  const home = options.home ?? homedir()
  const environment = options.environment ?? process.env
  const names = BROWSER_KEYS[application]
  const signal = options.signal
  const secretService = { missing: 'secretToolMissing' as const, read: () => run(SECRET_TOOL, ['lookup', 'application', names.application], signal) }
  const wallet = await kdeWallet(home, environment)
  const kwallet = wallet === undefined ? undefined : {
    missing: 'kwalletQueryMissing' as const,
    read: () => run(KWALLET_QUERY, ['--read-password', names.entry, '--folder', names.folder, wallet], signal)
  }
  // Chrome keeps its key in KDE Wallet on a KDE desktop and in the Secret Service keyring elsewhere; the other is asked
  // too, for a browser started with another password store.
  const stores = kdeDesktop(environment) ? [kwallet, secretService] : [secretService, kwallet]
  let missing: 'secretToolMissing' | 'kwalletQueryMissing' | undefined
  for (const store of stores) {
    // A cancelled read asks no further store, which could ask the person to unlock it.
    if (signal?.aborted) throw new BrowserImportError('expired')
    if (!store) continue
    const answer = await store.read()
    if (answer.secret) {
      try {
        return pbkdf2Sync(answer.secret, 'saltysalt', 1, 16, 'sha1')
      } finally { answer.secret.fill(0) }
    }
    if (answer.missing) missing ??= store.missing
  }
  if (signal?.aborted) throw new BrowserImportError('expired')
  throw new BrowserImportError(missing ?? 'keyUnavailable')
}

/** Whether the session is a KDE desktop, where Chrome keeps its key in KDE Wallet. */
function kdeDesktop(environment: NodeJS.ProcessEnv): boolean {
  return (environment.XDG_CURRENT_DESKTOP ?? '').split(':').some((name) => name.trim().toUpperCase() === 'KDE')
}

/**
 * The KDE wallet Chrome writes to, the default wallet named in kwalletrc, if its file exists. A name this module would
 * not pass on (one kwallet-query would read as an option) asks no wallet, rather than another one.
 */
async function kdeWallet(home: string, environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const configHome = environment.XDG_CONFIG_HOME && isAbsolute(environment.XDG_CONFIG_HOME) ? environment.XDG_CONFIG_HOME : join(home, '.config')
  const dataHome = environment.XDG_DATA_HOME && isAbsolute(environment.XDG_DATA_HOME) ? environment.XDG_DATA_HOME : join(home, '.local/share')
  let name = 'kdewallet'
  const config = await smallFile(join(configHome, 'kwalletrc'))
  if (config !== undefined) {
    const section = config.split(/(?=^\[)/m).find((part) => /^\[Wallet\]\s*$/m.test(part.split('\n', 1)[0]!))
    const configured = section?.match(/^Default Wallet=(.*)$/m)?.[1]?.trim()
    if (configured) {
      if (!/^[^\p{Cc}-][^\p{Cc}]{0,63}$/u.test(configured)) return undefined
      name = configured
    }
  }
  return await isFile(join(dataHome, 'kwalletd', `${walletFileName(name)}.kwl`)) ? name : undefined
}

/** The file name KWallet gives a wallet: its name, with each byte it does not keep written as ";XX". */
function walletFileName(name: string): string {
  return [...Buffer.from(name, 'utf8')]
    .map((byte) => WALLET_FILE_NAME_BYTES.has(byte) ? String.fromCharCode(byte) : `;${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('')
}

// Both follow a symbolic link, as dotfile managers link kwalletrc; each file is only checked or read with a size cap.
async function isFile(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile() } catch { return false }
}

async function smallFile(file: string): Promise<string | undefined> {
  try {
    const found = await stat(file)
    if (!found.isFile() || found.size > 64 * 1024) return undefined
    return await readFile(file, 'utf8')
  } catch { return undefined }
}

/**
 * The secret a key store command printed: one word of printable ASCII, as Chrome writes it (Base64 of random bytes),
 * without the newline after it. Anything else is no secret: nothing, or a kwallet-query report such as a missing
 * folder or entry, which names them (both hold spaces), may be translated, and with KDE Frameworks 5 ends with exit
 * status 0 like a found entry. The bytes are compared as they are, so no part of a secret is copied into a string.
 */
export function keyStoreSecret(output: Buffer): Buffer | undefined {
  const end = output.at(-1) === 10 ? output.length - 1 : output.length
  if (end === 0) return undefined
  for (let index = 0; index < end; index++) {
    const byte = output[index]!
    if (byte < 0x21 || byte > 0x7e) return undefined
  }
  return Buffer.from(output.subarray(0, end))
}

/** Runs a key store command without a shell; a command this computer does not have is missing. */
function runKeyStoreCommand(file: string, args: readonly string[], signal?: AbortSignal): Promise<KeyStoreAnswer> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4096, encoding: 'buffer', signal }, (error, stdout) => {
      try {
        if (error) { resolve({ missing: (error as NodeJS.ErrnoException).code === 'ENOENT' }); return }
        const secret = keyStoreSecret(stdout)
        resolve(secret ? { secret } : { missing: false })
      } finally { stdout?.fill(0) }
    })
  })
}
