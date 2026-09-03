import { describe, expect, it, vi } from 'vitest'
import { AGENT_GUIDE_IDS } from '../src/shared/agent-guides.js'
import {
  AGENT_GUIDE_URLS,
  SETUP_HELP_URL,
  SETUP_FEEDBACK_URL,
  agentGuideHandler,
  setupHelpHandler,
  setupFeedbackHandler
} from '../src/main/setup-feedback-links.js'

describe('setup feedback links', () => {
  it('opens only fixed Hronaut-owned documentation for every supported client ID', async () => {
    const assertTrustedSender = vi.fn()
    const openExternal = vi.fn(async (_url: string) => undefined)
    const handler = agentGuideHandler(assertTrustedSender, openExternal)
    const event = { sender: 'home' }

    expect(Object.isFrozen(AGENT_GUIDE_URLS)).toBe(true)
    expect(Object.keys(AGENT_GUIDE_URLS)).toEqual(AGENT_GUIDE_IDS)
    for (const [clientId, url] of Object.entries(AGENT_GUIDE_URLS)) {
      await handler(event, clientId)
      expect(new URL(url).origin).toBe('https://hronaut.dev')
    }

    expect(assertTrustedSender).toHaveBeenCalledTimes(Object.keys(AGENT_GUIDE_URLS).length)
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual(Object.values(AGENT_GUIDE_URLS))
    expect(AGENT_GUIDE_URLS.opencode).toBe('https://hronaut.dev/opencode-browser-mcp')
    expect(AGENT_GUIDE_URLS.vscode).toBe('https://hronaut.dev/github-copilot-browser-mcp')
    expect(AGENT_GUIDE_URLS.windsurf).toBe('https://hronaut.dev/setup#client-configurations')
    expect(AGENT_GUIDE_URLS['grok-build']).toBe('https://hronaut.dev/grok-build-browser-mcp')
    expect(AGENT_GUIDE_URLS['qwen-code']).toBe('https://hronaut.dev/qwen-code-browser-mcp')
    expect(AGENT_GUIDE_URLS.goose).toBe('https://hronaut.dev/goose-browser-mcp')
    expect(AGENT_GUIDE_URLS.generic).toBe('https://hronaut.dev/setup#client-configurations')
  })

  it('rejects unknown client IDs without opening a renderer-controlled URL', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = agentGuideHandler(() => undefined, openExternal)

    await expect(handler({}, 'https://attacker.example/setup')).rejects.toThrow('Invalid Hronaut Home agent guide ID')
    await expect(handler({}, 42)).rejects.toThrow('Invalid Hronaut Home agent guide ID')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('validates the trusted Home sender before resolving a client guide', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = agentGuideHandler(() => { throw new Error('Untrusted Home sender') }, openExternal)

    await expect(handler({}, 'opencode')).rejects.toThrow('Untrusted Home sender')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('checks the trusted Home sender and opens the fixed privacy-safe form URL', async () => {
    const assertTrustedSender = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const handler = setupFeedbackHandler(assertTrustedSender, openExternal)
    const event = { sender: 'home' }

    await handler(event)

    expect(assertTrustedSender).toHaveBeenCalledWith(event)
    expect(openExternal).toHaveBeenCalledWith(SETUP_FEEDBACK_URL)
    expect(SETUP_FEEDBACK_URL).toBe('https://hronaut.dev/go/desktop-setup-feedback')
    expect(new URL(SETUP_FEEDBACK_URL).search).toBe('')
    expect(new URL(SETUP_FEEDBACK_URL).hash).toBe('')
  })

  it('does not open anything for an untrusted sender', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = setupFeedbackHandler(() => { throw new Error('Untrusted Home sender') }, openExternal)

    await expect(handler({})).rejects.toThrow('Untrusted Home sender')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens only the fixed privacy-safe troubleshooting URL for a trusted Home sender', async () => {
    const assertTrustedSender = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const handler = setupHelpHandler(assertTrustedSender, openExternal)
    const event = { sender: 'home' }

    await handler(event)

    expect(assertTrustedSender).toHaveBeenCalledWith(event)
    expect(openExternal).toHaveBeenCalledWith(SETUP_HELP_URL)
    expect(SETUP_HELP_URL).toBe('https://hronaut.dev/go/desktop-setup-help')
    expect(new URL(SETUP_HELP_URL).search).toBe('')
    expect(new URL(SETUP_HELP_URL).hash).toBe('')
  })

  it('does not open troubleshooting for an untrusted sender', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = setupHelpHandler(() => { throw new Error('Untrusted Home sender') }, openExternal)

    await expect(handler({})).rejects.toThrow('Untrusted Home sender')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
