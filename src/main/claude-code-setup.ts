import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, open, realpath, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { flushDirectory } from './atomic-file.js'
import type { ClaudeCodeSetupErrorCode, ClaudeCodeSetupPreview, ClaudeCodeSetupResult, ClaudeCodeSetupStatus } from '../shared/claude-code-setup.js'

/** Larger files are not Claude Code's settings as people keep them; Hronaut leaves them to the copied command. */
export const CLAUDE_CODE_CONFIG_MAX_BYTES = 16 * 1024 * 1024
const PLAN_LIFETIME_MS = 2 * 60_000
/** Home and the dialog show at most this much of an existing entry. */
const PREVIEW_MAX_CHARACTERS = 2_000

/**
 * Claude Code keeps its user-scope MCP servers in `.claude.json`, under `CLAUDE_CONFIG_DIR` when that is set. A relative
 * `CLAUDE_CONFIG_DIR` depends on where Claude Code starts, so the path stays relative and reads as not found.
 */
export function claudeCodeConfigPath(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const directory = environment.CLAUDE_CONFIG_DIR?.trim()
  return join(directory || home, '.claude.json')
}

type ConfigRead =
  | { state: 'not-found' }
  | { state: 'unreadable' }
  | { state: 'ready'; target: string; raw: Buffer; text: string; hash: string; mode: number; root: Record<string, unknown>; indent: string; newline: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

/**
 * Reads the settings file only when Hronaut can write it back exactly as it was apart from its own entry: valid UTF-8, a
 * JSON object whose `mcpServers` is an object, and text that is what `JSON.stringify` gives with the file's own
 * indentation. Anything else (comments, other formatting, duplicate keys, a byte-order mark) is left alone, and so is a
 * file Hronaut could not replace without changing more than its contents: another account's, one with other hard links,
 * or a read-only one on Windows.
 */
async function readConfig(path: string, platform: NodeJS.Platform): Promise<ConfigRead> {
  if (!isAbsolute(path)) return { state: 'not-found' }
  let target: string
  try { target = await realpath(path) } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'not-found' } : { state: 'unreadable' }
  }
  let handle: Awaited<ReturnType<typeof open>>
  // Non-blocking, so a FIFO put in the file's place cannot hang the read.
  try { handle = await open(target, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)) } catch { return { state: 'unreadable' } }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > CLAUDE_CODE_CONFIG_MAX_BYTES || info.nlink > 1) return { state: 'unreadable' }
    if (platform === 'win32' ? (info.mode & 0o200) === 0 : info.uid !== process.getuid?.()) return { state: 'unreadable' }
    const raw = await handle.readFile()
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)
    const root: unknown = JSON.parse(text)
    if (!isRecord(root) || (root.mcpServers !== undefined && !isRecord(root.mcpServers))) return { state: 'unreadable' }
    const indent = /^\{\n([ \t]+)"/u.exec(text)?.[1] ?? ''
    const newline = text.endsWith('\n')
    if (JSON.stringify(root, null, indent) + (newline ? '\n' : '') !== text) return { state: 'unreadable' }
    return { state: 'ready', target, raw, text, hash: sha256(raw), mode: info.mode & 0o777, root, indent, newline }
  } catch {
    return { state: 'unreadable' }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * What Claude Code has to send while MCP authentication is on: the profile's token, which Hronaut writes, or any other
 * credential the listener takes, such as a capability profile's.
 */
export interface ClaudeCodeCredential {
  token: string
  accepts?: (bearer: string) => boolean
}

/** With authentication on, Claude Code sends the token in the header the copied command adds. */
const entryFor = (endpoint: string, token: string | undefined) => token === undefined
  ? { type: 'http', url: endpoint }
  : { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } }
const pointsAt = (entry: unknown, endpoint: string): entry is Record<string, unknown> => isRecord(entry) && entry.type === 'http' && entry.url === endpoint

/** The credential an entry's Authorization header sends, read as the listener reads it. */
function bearerOf(entry: Record<string, unknown>): string | undefined {
  if (!isRecord(entry.headers)) return undefined
  const header = Object.entries(entry.headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  return typeof header === 'string' ? /^Bearer +(\S+)$/iu.exec(header)?.[1] : undefined
}

/** While authentication is off, Hronaut ignores any header, so an entry with an old token still connects. */
function sendsAccepted(entry: Record<string, unknown>, credential: ClaudeCodeCredential | undefined): boolean {
  if (credential === undefined) return true
  const bearer = bearerOf(entry)
  return bearer !== undefined && (bearer === credential.token || (credential.accepts?.(bearer) ?? false))
}

const isEntryFor = (entry: unknown, endpoint: string, credential: ClaudeCodeCredential | undefined): boolean =>
  pointsAt(entry, endpoint) && sendsAccepted(entry, credential)
/** The entry as Home and the dialog show it: the token stays in main. */
const shownEntry = (endpoint: string, token: string | undefined) => token === undefined
  ? entryFor(endpoint, undefined)
  : { type: 'http', url: endpoint, headers: { Authorization: 'Bearer •••' } }
const hronautEntry = (config: Extract<ConfigRead, { state: 'ready' }>): unknown => (config.root.mcpServers as Record<string, unknown> | undefined)?.hronaut

/** An address without sign-in details or a query, either of which can carry a token. */
function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!url.username && !url.password && !url.search) return value
    const query = url.search ? '?•••' : ''
    url.username = ''; url.password = ''; url.search = ''
    return `${url.href}${query}`
  } catch { return '•••' }
}

/**
 * An existing entry as Home and the dialog show it: its type and address, and only the names of anything else, since
 * headers, environment values and arguments can hold a token.
 */
function describeExisting(entry: unknown): string {
  const shown = isRecord(entry)
    ? Object.fromEntries(Object.entries(entry).map(([key, value]) => [key,
      key === 'type' && typeof value === 'string' ? value
        : key === 'url' && typeof value === 'string' ? safeUrl(value)
          : isRecord(value) ? Object.fromEntries(Object.keys(value).map(name => [name, '•••'])) : '•••']))
    : '•••'
  const text = JSON.stringify(shown, null, 2)
  return text.length > PREVIEW_MAX_CHARACTERS ? `${text.slice(0, PREVIEW_MAX_CHARACTERS)}…` : text
}

/**
 * What Claude Code's settings say about Hronaut at this endpoint, with this credential, or none while authentication
 * is off. Never runs Claude Code.
 */
export async function claudeCodeSetupStatus(
  path: string,
  endpoint: string,
  credential: ClaudeCodeCredential | undefined,
  platform: NodeJS.Platform = process.platform
): Promise<ClaudeCodeSetupStatus> {
  const config = await readConfig(path, platform)
  if (config.state !== 'ready') return { state: config.state, path }
  const entry = hronautEntry(config)
  if (entry === undefined) return { state: 'not-configured', path }
  if (!pointsAt(entry, endpoint)) return { state: 'other-address', path }
  return { state: sendsAccepted(entry, credential) ? 'configured' : 'other-token', path }
}

interface Plan {
  endpoint: string
  token: string | undefined
  target: string
  hash: string
  next: string
  mode: number
  owner: number
  expiresAt: number
  preview: ClaudeCodeSetupPreview
}

export interface ClaudeCodeSetupOptions {
  path: string
  /** Read on each step: the MCP port can change in Settings. */
  endpoint: () => string
  /**
   * What Claude Code has to send, or undefined while authentication is off. Read on each step, since authentication
   * can be turned on or off in Settings.
   */
  credential?: () => ClaudeCodeCredential | undefined
  /** Whether Hronaut may write the entry now. Checked again after the dialog and just before the file is replaced. */
  allowed?: () => boolean
  now?: () => number
  /** Asks the person in a dialog main shows, which no page can answer, whether to make exactly this change. */
  confirm: (preview: ClaudeCodeSetupPreview) => Promise<boolean>
  platform?: NodeJS.Platform
}

/**
 * Adds `mcpServers.hronaut` to Claude Code's settings in two steps. `prepare` shows the page the exact change and a
 * single-use plan bound to the file's bytes and to the page that asked; `apply` asks the person through main, writes a
 * byte-for-byte backup and the new file beside it, checks once more that the file did not change, replaces it and reads
 * it back. File contents never leave main.
 */
export class ClaudeCodeSetup {
  private readonly plans = new Map<string, Plan>()
  private readonly now: () => number
  private readonly platform: NodeJS.Platform

  constructor(private readonly options: ClaudeCodeSetupOptions) {
    this.now = options.now ?? Date.now
    this.platform = options.platform ?? process.platform
  }

  get path(): string { return this.options.path }

  status(): Promise<ClaudeCodeSetupStatus> {
    return claudeCodeSetupStatus(this.options.path, this.options.endpoint(), this.credential(), this.platform)
  }

  async prepare(owner: number): Promise<ClaudeCodeSetupPreview> {
    this.forgetExpired()
    const config = await readConfig(this.options.path, this.platform)
    if (config.state !== 'ready') throw new ClaudeCodeSetupError(config.state)
    const servers = (config.root.mcpServers as Record<string, unknown> | undefined) ?? {}
    const before = servers.hronaut
    const endpoint = this.options.endpoint()
    const credential = this.credential()
    const token = credential?.token
    const after = entryFor(endpoint, token)
    if (isEntryFor(before, endpoint, credential)) throw new ClaudeCodeSetupError('configured')
    // Spreading keeps every other key, and an existing entry's place, exactly as they were.
    const next = { ...config.root, mcpServers: { ...servers, hronaut: after } }
    const nextText = JSON.stringify(next, null, config.indent) + (config.newline ? '\n' : '')
    const id = randomBytes(16).toString('hex')
    const preview: ClaudeCodeSetupPreview = {
      planId: id,
      path: this.options.path,
      before: before === undefined ? null : describeExisting(before),
      after: JSON.stringify(shownEntry(endpoint, token), null, 2),
      tokenHidden: token !== undefined,
      backupName: await this.freeBackupName(config.target)
    }
    // A file that now holds the token is for this account alone; one without it keeps its exact mode.
    const mode = token === undefined || this.platform === 'win32' ? config.mode : config.mode & 0o700
    // One plan per page: preparing again replaces what that page was shown.
    for (const [key, plan] of this.plans) if (plan.owner === owner) this.plans.delete(key)
    this.plans.set(id, { endpoint, token, target: config.target, hash: config.hash, next: nextText, mode, owner, expiresAt: this.now() + PLAN_LIFETIME_MS, preview })
    return preview
  }

  async apply(planId: unknown, owner: number): Promise<ClaudeCodeSetupResult> {
    this.forgetExpired()
    const plan = typeof planId === 'string' ? this.plans.get(planId) : undefined
    if (!plan || plan.owner !== owner) throw new ClaudeCodeSetupError('expired')
    this.plans.delete(planId as string)
    this.assertStillValid(plan)
    if (!await this.options.confirm(plan.preview)) return { outcome: 'cancelled' }
    // The port, authentication or the token can change while the dialog is open.
    this.assertStillValid(plan)
    const current = await this.readUnchanged(plan)
    const directory = dirname(plan.target)
    const backup = join(directory, plan.preview.backupName)
    const temporary = join(directory, `.${basename(plan.target)}.${randomUUID()}.tmp`)
    let replaced = false
    try {
      try {
        await writeNewFile(backup, current.raw, 0o600)
        await writeNewFile(temporary, Buffer.from(plan.next, 'utf8'), plan.mode)
        // The mode given when creating a file is reduced by the umask; give the new file the planned one exactly.
        await chmod(temporary, plan.mode)
      } catch {
        throw new ClaudeCodeSetupError('write-failed')
      }
      // Claude Code rewrites this file often, and authentication can change during the writes: check both once more
      // just before replacing it.
      await this.readUnchanged(plan)
      this.assertStillValid(plan)
      try {
        await rename(temporary, plan.target)
        replaced = true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // On Windows a file another program holds open cannot be replaced.
        if (this.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) throw new ClaudeCodeSetupError('busy')
        throw new ClaudeCodeSetupError('write-failed')
      }
      await flushDirectory(directory).catch(() => undefined)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
      // Nothing was changed, so the copy is not needed.
      if (!replaced) await rm(backup, { force: true }).catch(() => undefined)
    }
    const written = await readConfig(this.options.path, this.platform)
    if (written.state === 'ready' && (written.text === plan.next || isEntryFor(hronautEntry(written), plan.endpoint, plan.token === undefined ? undefined : { token: plan.token }))) {
      return { outcome: 'applied', backupName: plan.preview.backupName }
    }
    // Replaced, then changed again right after, most likely by a running Claude Code.
    return { outcome: 'overwritten', backupName: plan.preview.backupName }
  }

  private credential(): ClaudeCodeCredential | undefined {
    return this.options.credential?.()
  }

  private assertStillValid(plan: Plan): void {
    if (plan.endpoint !== this.options.endpoint() || plan.token !== this.credential()?.token || !(this.options.allowed?.() ?? true)) {
      throw new ClaudeCodeSetupError('expired')
    }
  }

  /** The file as the plan saw it, at the same real path, or a refusal. */
  private async readUnchanged(plan: Plan): Promise<Extract<ConfigRead, { state: 'ready' }>> {
    const current = await readConfig(this.options.path, this.platform)
    if (current.state !== 'ready' || current.target !== plan.target || current.hash !== plan.hash) throw new ClaudeCodeSetupError('changed')
    return current
  }

  /** `<name>.hronaut-backup-<UTC time>`, with a number added when a backup from the same second exists. */
  private async freeBackupName(target: string): Promise<string> {
    const stamp = new Date(this.now()).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '')
    const base = `${basename(target)}.hronaut-backup-${stamp}`
    for (let attempt = 1; attempt <= 100; attempt++) {
      const name = attempt === 1 ? base : `${base}-${attempt}`
      if (!await exists(join(dirname(target), name))) return name
    }
    throw new ClaudeCodeSetupError('write-failed')
  }

  private forgetExpired(): void {
    const now = this.now()
    for (const [key, plan] of this.plans) if (plan.expiresAt <= now) this.plans.delete(key)
  }
}

/** Creates `path`, which must not exist yet, with exactly these bytes, and flushes it to disk. */
async function writeNewFile(path: string, bytes: Buffer, mode: number): Promise<void> {
  const handle = await open(path, 'wx', mode)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}

/** A reason the page can name in the person's language; it carries no file contents. */
export class ClaudeCodeSetupError extends Error {
  constructor(readonly code: ClaudeCodeSetupErrorCode) {
    super(`claude-code-setup:${code}`)
  }
}
