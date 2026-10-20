// @vitest-environment jsdom
// Home buttons that wait for main (Open guide, Open in VS Code, the help links, Use port and Set up Claude Code) are
// disabled meanwhile, and Chromium then moves their keyboard focus to the page body, so the next Tab started at the
// top of Home. Each gets the focus back once it works again, unless the person moved it or left Home.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeCodeSetupPreview, HomeSetupState } from '../src/shared/claude-code-setup.js'
import type { HomeDashboard, HronautHomeApi } from '../src/shared/home.js'
import type { McpPortMoveResult } from '../src/shared/types.js'
import { baseDashboard, byId, deferred, flush, installHomeHooks, mountTestHome, query, words } from './qa-home-harness.js'

installHomeHooks()

let windowFocused: ReturnType<typeof vi.spyOn>
beforeEach(() => { windowFocused = vi.spyOn(document, 'hasFocus').mockReturnValue(true) })

/** Chromium moves the focus of a button that becomes disabled to the page body; jsdom keeps it on the button. */
function blurWhenDisabled(button: HTMLButtonElement): void {
  const disabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled')!
  Object.defineProperty(button, 'disabled', {
    configurable: true,
    get(this: HTMLButtonElement) { return disabled.get!.call(this) as boolean },
    set(this: HTMLButtonElement, value: boolean) {
      // jsdom does not blur a button that is already disabled.
      if (value && document.activeElement === this) this.blur()
      disabled.set!.call(this, value)
    }
  })
}

const openView = (view: 'connect' | 'tools') => byId<HTMLButtonElement>(`home-tab-${view}`).click()
const chooseGuide = (id: string) => query<HTMLButtonElement>(`#agent-list [data-guide="${id}"]`).click()

type LinkMethod = 'openAgentGuide' | 'openVsCodeInstall' | 'openSetupHelp' | 'openSetupFeedback'
const links: Array<{ name: string; method: LinkMethod; button: () => HTMLButtonElement; open: () => void; authenticationDisabled?: boolean }> = [
  { name: 'Open guide', method: 'openAgentGuide', button: () => query('[data-agent-guide]'), open: () => openView('connect') },
  {
    name: 'Open in VS Code', method: 'openVsCodeInstall', button: () => query('[data-vscode-install]'),
    open: () => { openView('connect'); chooseGuide('vscode') }, authenticationDisabled: true
  },
  { name: 'Troubleshoot', method: 'openSetupHelp', button: () => byId('support-troubleshoot'), open: () => openView('tools') },
  { name: 'Report trouble', method: 'openSetupFeedback', button: () => byId('support-feedback'), open: () => openView('tools') }
]

/** Mounts Home with the link's bridge method held open, focuses its button and presses it. */
async function pressLink(link: (typeof links)[number]) {
  const answer = deferred<void>()
  const api: Partial<HronautHomeApi> = { [link.method]: vi.fn(() => answer.promise) }
  mountTestHome({ api, authenticationDisabled: link.authenticationDisabled })
  await flush()
  link.open()
  const button = link.button()
  expect(button.closest('[hidden]')).toBeNull()
  blurWhenDisabled(button)
  button.focus()
  button.click()
  await flush()
  expect(button.disabled).toBe(true)
  // What Chromium does, and what the person used to be left with.
  expect(document.activeElement).toBe(document.body)
  return { answer, button }
}

describe('Home links that open outside Home', () => {
  it.each(links)('give the focus back to $name when opening fails', async link => {
    const { answer, button } = await pressLink(link)
    answer.reject(new Error('No browser is set up.'))
    await flush()
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)
  })

  it.each(links)('give the focus back to $name once it opened', async link => {
    const { answer, button } = await pressLink(link)
    answer.resolve()
    await flush()
    expect(document.activeElement).toBe(button)
  })

  it('leaves the focus where the person moved it meanwhile', async () => {
    const { answer } = await pressLink(links[0]!)
    const search = byId('agent-search')
    search.focus()
    answer.reject(new Error('No browser is set up.'))
    await flush()
    expect(document.activeElement).toBe(search)
  })

  it.each(links)('give the focus back to $name when the person comes back after it opened in front of Hronaut', async link => {
    const { answer, button } = await pressLink(link)
    windowFocused.mockReturnValue(false)
    answer.resolve()
    await flush()
    // The focus does not move while another app is in front.
    expect(document.activeElement).toBe(document.body)
    windowFocused.mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(button)
  })

  it('leaves the focus where the person put it before coming back', async () => {
    const { answer } = await pressLink(links[0]!)
    windowFocused.mockReturnValue(false)
    answer.resolve()
    await flush()
    const search = byId('agent-search')
    search.focus()
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(search)
  })

  it('keeps Troubleshoot connection, and its focus, while it opens the guide after agents succeeded', async () => {
    const opening = deferred<void>()
    const openSetupHelp = vi.fn().mockRejectedValueOnce(new Error('No browser is set up.')).mockReturnValueOnce(opening.promise)
    const home = mountTestHome({ api: { openSetupHelp } })
    await flush()
    openView('tools')
    const help = byId<HTMLButtonElement>('support-troubleshoot')
    help.click()
    await flush()
    // The failure keeps it on screen with a Retry, beside agents' successful steps.
    home.show({ ...baseDashboard, completedToolCalls: 1 })
    expect(help.hidden).toBe(false)
    blurWhenDisabled(help)
    help.focus()
    help.click()
    await flush()
    expect(document.activeElement).toBe(document.body)
    // A status read while it waits used to hide it, as it no longer had the focus or a failure to show.
    home.show({ ...baseDashboard, completedToolCalls: 2 })
    expect(help.hidden).toBe(false)
    opening.resolve()
    await flush()
    expect(document.activeElement).toBe(help)
  })

  it('does not move the focus for a button pressed without it, as the first-run offer presses Set up Claude Code', async () => {
    const opening = deferred<void>()
    mountTestHome({ api: { openAgentGuide: vi.fn(() => opening.promise) } })
    await flush()
    openView('connect')
    const button = query<HTMLButtonElement>('[data-agent-guide]')
    blurWhenDisabled(button)
    button.click()
    opening.resolve()
    await flush()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('Use port', () => {
  const busy: HomeDashboard = {
    ...baseDashboard, status: 'error', startedAt: null, error: 'listen EADDRINUSE: address already in use 127.0.0.1:47812',
    errorCode: 'port-in-use', failedPort: 47812, suggestedPort: 47813
  }

  it.each<[string, McpPortMoveResult | Error]>([
    ['the port was taken meanwhile', { outcome: 'taken', port: 47813 }],
    ['moving failed', { outcome: 'failed', port: 47813 }],
    ['the bridge failed', new Error('Port move failed')]
  ])('gets the focus back when %s', async (_name, result) => {
    const moved = deferred<McpPortMoveResult>()
    mountTestHome({ dashboard: busy, api: { useMcpPort: vi.fn(() => moved.promise) } })
    await flush()
    const button = byId<HTMLButtonElement>('mcp-port-use')
    blurWhenDisabled(button)
    button.focus()
    button.click()
    await flush()
    expect(document.activeElement).toBe(document.body)
    if (result instanceof Error) moved.reject(result)
    else moved.resolve(result)
    await flush()
    expect(words(byId('mcp-port-status'))).not.toBe('')
    expect(document.activeElement).toBe(button)
  })

  it('leaves the focus alone when no free port is left to offer', async () => {
    const moved = deferred<McpPortMoveResult>()
    const home = mountTestHome({ dashboard: busy, api: { useMcpPort: vi.fn(() => moved.promise) } })
    await flush()
    const button = byId<HTMLButtonElement>('mcp-port-use')
    blurWhenDisabled(button)
    button.focus()
    button.click()
    await flush()
    home.show({ ...busy, suggestedPort: undefined })
    moved.resolve({ outcome: 'taken', port: 47813 })
    await flush()
    expect(button.hidden).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('Set up Claude Code', () => {
  const SETTINGS = '/home/person/.claude.json'
  const notConfigured: HomeSetupState = { detected: ['claude-code'], claudeCode: { state: 'not-configured', path: SETTINGS } }

  async function pressStart(after: HomeSetupState) {
    let current = notConfigured
    const prepared = deferred<ClaudeCodeSetupPreview>()
    const api: Partial<HronautHomeApi> = {
      getSetupState: vi.fn(async () => current),
      prepareClaudeCodeSetup: vi.fn(() => prepared.promise),
      applyClaudeCodeSetup: vi.fn()
    }
    mountTestHome({ authenticationDisabled: true, api })
    await flush()
    openView('connect')
    const start = byId<HTMLButtonElement>('claude-setup-start')
    expect(start.closest('[hidden]')).toBeNull()
    blurWhenDisabled(start)
    start.focus()
    start.click()
    await flush()
    expect(document.activeElement).toBe(document.body)
    current = after
    return { prepared, start }
  }

  it('gives the focus back to Start when preparing the change fails', async () => {
    const { prepared, start } = await pressStart(notConfigured)
    prepared.reject(new Error('claude-code-setup:busy'))
    await flush()
    expect(words(byId('claude-setup-status'))).toBe('Quit Claude Code and try again.')
    expect(document.activeElement).toBe(start)
  })

  it('moves the focus to the command when Start is gone after the failure', async () => {
    const { prepared } = await pressStart({ ...notConfigured, claudeCode: { state: 'configured', path: SETTINGS } })
    prepared.reject(new Error('claude-code-setup:configured'))
    await flush()
    expect(byId('claude-setup-start').hidden).toBe(true)
    expect(document.activeElement).toBe(byId('guide-code').closest('pre'))
  })

  it('does not take the focus while Hronaut is in the background', async () => {
    const { prepared } = await pressStart(notConfigured)
    windowFocused.mockReturnValue(false)
    prepared.reject(new Error('claude-code-setup:busy'))
    await flush()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the focus where the person moved it while the change was prepared', async () => {
    const { prepared } = await pressStart(notConfigured)
    const search = byId('agent-search')
    search.focus()
    prepared.reject(new Error('claude-code-setup:busy'))
    await flush()
    expect(document.activeElement).toBe(search)
  })
})
