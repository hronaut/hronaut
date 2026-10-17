import { createHash, randomBytes } from 'node:crypto'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { writeTextFileAtomically } from './atomic-file.js'
import type { ClaudeCodeSetupErrorCode, ClaudeCodeSetupPreview, ClaudeCodeSetupResult, ClaudeCodeSetupStatus } from '../shared/claude-code-setup.js'

/** Larger files are not Claude Code's settings as people keep them; Hronaut leaves them to the copied command. */
export const CLAUDE_CODE_CONFIG_MAX_BYTES = 16 * 1024 * 1024
const PLAN_LIFETIME_MS = 2 * 60_000

/** Claude Code keeps its user-scope MCP servers in `.claude.json`, under `CLAUDE_CONFIG_DIR` when that is set. */
export function claudeCodeConfigPath(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const directory = environment.CLAUDE_CONFIG_DIR?.trim()
  return join(directory || home, '.claude.json')
}

type ConfigRead =
  | { state: 'not-found' }
  | { state: 'unreadable' }
  | { state: 'ready'; target: string; text: string; hash: string; mode: number; root: Record<string, unknown>; indent: string; newline: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Reads the settings file only when Hronaut can write it back exactly as it was apart from its own entry: a JSON object
 * whose `mcpServers` is an object, and whose text is what `JSON.stringify` gives with the file's own indentation. Anything
 * else (comments, other formatting, duplicate keys, a byte-order mark) is left alone.
 */
async function readConfig(path: string): Promise<ConfigRead> {
  let target: string
  try { target = await realpath(path) } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'not-found' } : { state: 'unreadable' }
  }
  try {
    const info = await stat(target)
    if (!info.isFile() || info.size > CLAUDE_CODE_CONFIG_MAX_BYTES) return { state: 'unreadable' }
    const text = await readFile(target, 'utf8')
    const root: unknown = JSON.parse(text)
    if (!isRecord(root) || (root.mcpServers !== undefined && !isRecord(root.mcpServers))) return { state: 'unreadable' }
    const indent = /^\{\n([ \t]+)"/u.exec(text)?.[1] ?? ''
    const newline = text.endsWith('\n')
    if (JSON.stringify(root, null, indent) + (newline ? '\n' : '') !== text) return { state: 'unreadable' }
    return { state: 'ready', target, text, hash: sha256(text), mode: info.mode & 0o777, root, indent, newline }
  } catch {
    return { state: 'unreadable' }
  }
}

const entryFor = (endpoint: string) => ({ type: 'http', url: endpoint })
const describe = (value: unknown): string => JSON.stringify(value, null, 2)

/** What Claude Code's settings say about Hronaut at this endpoint. Never runs Claude Code. */
export async function claudeCodeSetupStatus(path: string, endpoint: string): Promise<ClaudeCodeSetupStatus> {
  const config = await readConfig(path)
  if (config.state !== 'ready') return { state: config.state, path }
  const entry = (config.root.mcpServers as Record<string, unknown> | undefined)?.hronaut
  if (entry === undefined) return { state: 'not-configured', path }
  return { state: isRecord(entry) && entry.type === 'http' && entry.url === endpoint ? 'configured' : 'other-address', path }
}

interface Plan {
  endpoint: string
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
  now?: () => number
  /** Asks the person in a native dialog, outside any page, whether to make exactly this change. */
  confirm: (preview: ClaudeCodeSetupPreview) => Promise<boolean>
  platform?: NodeJS.Platform
}

/**
 * Adds `mcpServers.hronaut` to Claude Code's settings in two steps. `prepare` shows the page the exact change and a
 * single-use plan bound to the file's contents and to the page that asked; `apply` asks the person natively, checks the
 * file did not change, writes a backup and then the new file atomically, and reads it back. File contents never leave
 * main.
 */
export class ClaudeCodeSetup {
  private readonly plans = new Map<string, Plan>()
  private readonly now: () => number

  constructor(private readonly options: ClaudeCodeSetupOptions) {
    this.now = options.now ?? Date.now
  }

  get path(): string { return this.options.path }

  status(): Promise<ClaudeCodeSetupStatus> {
    return claudeCodeSetupStatus(this.options.path, this.options.endpoint())
  }

  async prepare(owner: number): Promise<ClaudeCodeSetupPreview> {
    this.forgetExpired()
    const config = await readConfig(this.options.path)
    if (config.state !== 'ready') throw new ClaudeCodeSetupError(config.state)
    const servers = (config.root.mcpServers as Record<string, unknown> | undefined) ?? {}
    const before = servers.hronaut
    const endpoint = this.options.endpoint()
    const after = entryFor(endpoint)
    if (isRecord(before) && before.type === 'http' && before.url === after.url) throw new ClaudeCodeSetupError('configured')
    // Spreading keeps every other key, and an existing entry's place, exactly as they were.
    const next = { ...config.root, mcpServers: { ...servers, hronaut: after } }
    const nextText = JSON.stringify(next, null, config.indent) + (config.newline ? '\n' : '')
    const id = randomBytes(16).toString('hex')
    const stamp = new Date(this.now()).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '')
    const preview: ClaudeCodeSetupPreview = {
      planId: id,
      path: this.options.path,
      before: before === undefined ? null : describe(before),
      after: describe(after),
      backupName: `${basename(config.target)}.hronaut-backup-${stamp}`
    }
    // One plan per page: preparing again replaces what that page was shown.
    for (const [key, plan] of this.plans) if (plan.owner === owner) this.plans.delete(key)
    this.plans.set(id, { endpoint, target: config.target, hash: config.hash, next: nextText, mode: config.mode, owner, expiresAt: this.now() + PLAN_LIFETIME_MS, preview })
    return preview
  }

  async apply(planId: unknown, owner: number): Promise<ClaudeCodeSetupResult> {
    this.forgetExpired()
    const plan = typeof planId === 'string' ? this.plans.get(planId) : undefined
    if (!plan || plan.owner !== owner) throw new ClaudeCodeSetupError('expired')
    this.plans.delete(planId as string)
    if (plan.endpoint !== this.options.endpoint()) throw new ClaudeCodeSetupError('expired')
    if (!await this.options.confirm(plan.preview)) return { outcome: 'cancelled' }
    const current = await readConfig(plan.target)
    if (current.state !== 'ready' || current.hash !== plan.hash) throw new ClaudeCodeSetupError('changed')
    const backup = join(dirname(plan.target), plan.preview.backupName)
    try {
      const handle = await open(backup, 'wx', 0o600)
      try { await handle.writeFile(current.text, 'utf8'); await handle.sync() } finally { await handle.close() }
      await writeTextFileAtomically(plan.target, plan.next, plan.mode)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((this.options.platform ?? process.platform) === 'win32' && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) throw new ClaudeCodeSetupError('busy')
      throw new ClaudeCodeSetupError('write-failed')
    }
    const written = await readConfig(plan.target)
    if (written.state !== 'ready' || written.text !== plan.next) throw new ClaudeCodeSetupError('write-failed')
    return { outcome: 'applied', backupName: plan.preview.backupName }
  }

  private forgetExpired(): void {
    const now = this.now()
    for (const [key, plan] of this.plans) if (plan.expiresAt <= now) this.plans.delete(key)
  }
}

/** A reason the page can name in the person's language; it carries no file contents. */
export class ClaudeCodeSetupError extends Error {
  constructor(readonly code: ClaudeCodeSetupErrorCode) {
    super(`claude-code-setup:${code}`)
  }
}
