import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerHomeIpc } from '../src/main/home-ipc.js'
import { DEFAULT_SETTINGS } from '../src/main/settings-store.js'
import type { HomeSetupState } from '../src/shared/claude-code-setup.js'

const endpoint = 'http://127.0.0.1:47812/mcp'
const TOKEN = 'home-ipc-test-token'
let directory: string
let previous: string | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-home-ipc-'))
  // Home's setup reads Claude Code's settings from CLAUDE_CONFIG_DIR, once, when it first needs them.
  previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  await writeFile(join(directory, '.claude.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`)
})
afterEach(async () => {
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previous
  await rm(directory, { recursive: true, force: true })
})

/** Home's IPC with authentication on and the token from the profile, or from HRONAUT_MCP_TOKEN for this launch. */
function home(source: 'profile' | 'environment') {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const showMessageBox = vi.fn(async () => ({ response: 1, checkboxChecked: false }))
  registerHomeIpc({
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    workspaceStartupFailure: () => undefined,
    tabs: () => null,
    mainWindow: () => null,
    copyTextToClipboard: async () => undefined,
    reportClipboardFailure: () => undefined,
    mcpUrl: () => endpoint,
    settings: () => ({ ...DEFAULT_SETTINGS, mcpAuthentication: true }),
    mcpTokenConfiguration: () => ({ token: TOKEN, source }),
    mcpCredentialAccepted: () => false,
    openExternal: async () => undefined,
    mcpPortRecovery: () => ({ move: vi.fn() }),
    showMessageBox,
    // The key and its parameters, so a test sees what the dialog would say.
    text: (key, parameters) => parameters ? `${key} ${JSON.stringify(parameters)}` : key
  })
  const mainFrame = { url: 'hronaut://home/' }
  const event = { sender: { id: 1, mainFrame }, senderFrame: mainFrame }
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args))
  return { invoke, showMessageBox }
}

describe('Set up Claude Code through Home IPC with MCP authentication on', () => {
  it('adds the profile token after the native dialog, which shows only •••', async () => {
    const { invoke, showMessageBox } = home('profile')
    expect((await invoke('hronaut-home:setup-state') as HomeSetupState).claudeCode?.state).toBe('not-configured')
    const preview = await invoke('hronaut-home:claude-code-prepare') as { planId: string; after: string; tokenHidden: boolean }
    expect(preview).toMatchObject({ tokenHidden: true })
    expect(JSON.stringify(preview)).not.toContain(TOKEN)
    expect(await invoke('hronaut-home:claude-code-apply', preview.planId)).toMatchObject({ outcome: 'applied' })
    expect(JSON.stringify(showMessageBox.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(showMessageBox.mock.calls)).toContain('native.dialog.claudeSetupToken')
    expect(JSON.parse(await readFile(join(directory, '.claude.json'), 'utf8')).mcpServers.hronaut.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect((await invoke('hronaut-home:setup-state') as HomeSetupState).claudeCode?.state).toBe('configured')
  })

  it('offers only the command while the token is given to this launch only', async () => {
    const { invoke, showMessageBox } = home('environment')
    expect((await invoke('hronaut-home:setup-state') as HomeSetupState).claudeCode).toBeUndefined()
    await expect(invoke('hronaut-home:claude-code-prepare')).rejects.toThrow(/HRONAUT_MCP_TOKEN/)
    await expect(invoke('hronaut-home:claude-code-apply', 'any-plan')).rejects.toThrow(/HRONAUT_MCP_TOKEN/)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(await readFile(join(directory, '.claude.json'), 'utf8')).not.toContain(TOKEN)
  })
})
