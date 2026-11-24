import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { PersonTypedText } from '../src/main/browser/person-typed-text/person-typed-text-store.js'
import { personHoldsTab } from '../src/main/browser/person-typed-text/person-typed-text.js'
import { calledWorkspaces, hidePersonTypedText, redactPersonTypedResult } from '../src/main/mcp/person-typed-redaction.js'
import { redactTypedText, typedTextForms, typedTextPattern, typedTexts } from '../src/shared/person-typed-text.js'

// After the person takes a page over from its agent, or signs in where it asked them to, what they typed reaches the
// agent nowhere afterwards: every result in that workspace says [redacted] in its place, in every form a page, a
// request or a JSON result gives it.

const tab = { id: 'tab-1', mcpGroupId: 'workspace-a' }
const keys = (store: PersonTypedText, text: string, held = true, target = tab) => {
  for (const key of text) store.key(target, { key, control: false, meta: false, alt: false }, held)
}

describe('text the person typed', () => {
  it('is kept trimmed, whole and line by line, from four characters', () => {
    expect(typedTexts('  person@example.com ')).toEqual(['person@example.com'])
    expect(typedTexts('abc')).toEqual([])
    expect(typedTexts('first line\nok\r\nsecond line')).toEqual(['first line\nok\r\nsecond line', 'first line', 'second line'])
    expect(typedTexts('x'.repeat(1_001))).toEqual([])
  })

  it('is hidden as typed, URL-encoded, as a form value and escaped in JSON, ignoring case, longest first', () => {
    expect(typedTextForms('a b"c')).toEqual(expect.arrayContaining(['a b"c', 'a b\\"c', 'a b\\\\\\"c', 'a%20b%22c', 'a+b%22c']))
    expect(typedTextForms("it's (ok)!")).toEqual(expect.arrayContaining(["it's (ok)!", 'it%27s+%28ok%29%21', 'it%27s%20%28ok%29%21']))
    const pattern = typedTextPattern(['Hunter2 pass', 'hunter2'])
    const body = JSON.stringify({ request: JSON.stringify({ password: 'Hunter2 pass' }) })
    expect(redactTypedText(`${body} q=Hunter2+pass HUNTER2 PASS hunter2x`, pattern))
      .toBe(`${JSON.stringify({ request: JSON.stringify({ password: '[redacted]' }) })} q=[redacted] [redacted] [redacted]x`)
    expect(redactTypedText('x+y', typedTextPattern(['a.b*']))).toBe('x+y')
    expect(redactTypedText('a.b* and a.b*', typedTextPattern(['a.b*']))).toBe('[redacted] and [redacted]')
    expect(typedTextPattern([])).toBeNull()
  })

  it('keeps what the person types while the page is theirs, not each prefix, and ends it with a key that moves on', () => {
    const store = new PersonTypedText()
    keys(store, 'hunter2')
    expect(store.redact('hunt hunter2')).toBe('hunt [redacted]')
    store.key(tab, { key: 'Backspace', control: false, meta: false, alt: false }, true)
    expect(store.redact('hunter2 hunter')).toBe('[redacted]2 [redacted]')
    store.key(tab, { key: 'Shift', control: false, meta: false, alt: false }, true)
    keys(store, 'X')
    expect(store.redact('hunterX hunter')).toBe('[redacted] hunter')
    store.key(tab, { key: 'Tab', control: false, meta: false, alt: false }, true)
    keys(store, 'next')
    expect(store.redact('hunterX next')).toBe('[redacted] [redacted]')
    // Ctrl+V pastes text the page reports; it ends what the person was typing.
    store.key(tab, { key: 'v', control: true, meta: false, alt: false }, true)
    keys(store, 'more')
    expect(store.redact('nextmore more')).toBe('[redacted][redacted] [redacted]')
    // AltGr, on Windows Ctrl+Alt, types a character.
    store.key(tab, { key: '@', control: true, meta: false, alt: true }, true)
    expect(store.redact('more@ more')).toBe('[redacted] more')
  })

  it('counts a value the page reports just after the person handed it back, for two seconds after their last key or click', () => {
    vi.useFakeTimers({ now: 10_000 })
    try {
      const store = new PersonTypedText()
      expect(store.heldLately(tab.id)).toBe(false)
      store.pointer(tab, false)
      expect(store.heldLately(tab.id)).toBe(false)
      store.pointer(tab, true)
      vi.advanceTimersByTime(1_999)
      expect(store.heldLately(tab.id)).toBe(true)
      store.key(tab, { key: 'a', control: false, meta: false, alt: false }, true)
      vi.advanceTimersByTime(2_000)
      expect(store.heldLately(tab.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps nothing the person types while the agent has the page, or outside a workspace', () => {
    const store = new PersonTypedText()
    keys(store, 'agent-time', false)
    keys(store, 'no-workspace', true, { id: 'tab-2', mcpGroupId: undefined as never })
    store.remember(undefined, ['nowhere at all'])
    expect(store.pattern()).toBeNull()
  })

  it('hides a workspace\'s text in that workspace, or in any when a call names none, and keeps the newest 200', () => {
    const store = new PersonTypedText()
    store.remember('workspace-a', ['alpha-secret', undefined])
    store.remember('workspace-b', ['beta-secret'])
    expect(store.redact('alpha-secret beta-secret', ['workspace-a'])).toBe('[redacted] beta-secret')
    expect(store.redact('alpha-secret beta-secret')).toBe('[redacted] [redacted]')
    for (let index = 0; index < 200; index++) store.remember('workspace-a', [`value-${index}`])
    expect(store.redact('alpha-secret value-0 value-199', ['workspace-a'])).toBe('alpha-secret [redacted] [redacted]')
  })

  it('is the person\'s while agents are paused on the tab or an agent waits for the person there', () => {
    const browser = (paused: boolean, attention: boolean) => ({
      allAgentsPaused: false,
      agentPauseOverridesAllowed: true,
      globallyResumedAgentTabIds: new Set<string>(),
      tabs: new Map([[tab.id, { ...tab, tabAgentPaused: paused }]]),
      options: { getTabAttention: () => attention ? { id: 'request' } : undefined }
    }) as never
    expect(personHoldsTab(browser(true, false), tab)).toBe(true)
    expect(personHoldsTab(browser(false, true), tab)).toBe(true)
    expect(personHoldsTab(browser(false, false), tab)).toBe(false)
    expect(personHoldsTab(browser(true, true), { id: tab.id, mcpGroupId: undefined as never })).toBe(false)
  })
})

describe('agent results', () => {
  it('name the workspaces of a call, or none for a call across workspaces', () => {
    expect(calledWorkspaces({ workspaceId: 'a', sourceWorkspaceId: 'b', workspaceIds: ['c', 1] })).toEqual(['a', 'b', 'c'])
    expect(calledWorkspaces({ tabId: 't' })).toBeUndefined()
    expect(calledWorkspaces(undefined)).toBeUndefined()
  })

  it('hide what the person typed in text, resources and structured content, never in images', () => {
    const store = new PersonTypedText()
    store.remember('workspace-a', ['person@example.com'])
    const image = { type: 'image' as const, data: 'cGVyc29uQGV4YW1wbGUuY29t', mimeType: 'image/png' }
    const result: CallToolResult = {
      content: [
        { type: 'text', text: 'Welcome, person@example.com' },
        { type: 'resource', resource: { uri: 'hronaut://x', text: 'person%40example.com' } },
        image
      ],
      structuredContent: { rows: [{ email: 'PERSON@example.com', count: 2 }] }
    }
    const redacted = redactPersonTypedResult({ personTypedText: store }, { workspaceId: 'workspace-a' }, result)
    expect(redacted.content).toEqual([
      { type: 'text', text: 'Welcome, [redacted]' },
      { type: 'resource', resource: { uri: 'hronaut://x', text: '[redacted]' } },
      image
    ])
    expect(redacted.structuredContent).toEqual({ rows: [{ email: '[redacted]', count: 2 }] })
    expect(redactPersonTypedResult({ personTypedText: store }, { workspaceId: 'workspace-b' }, result)).toBe(result)
    expect(redactPersonTypedResult({}, { workspaceId: 'workspace-a' }, result)).toBe(result)
  })

  it('hide it in a call\'s result and in the message of a call that throws', async () => {
    const store = new PersonTypedText()
    store.remember('workspace-a', ['person@example.com'])
    const manager = { personTypedText: store }
    const call = hidePersonTypedText(manager, { workspaceId: 'workspace-a' }, () => Promise.resolve({ content: [{ type: 'text', text: 'person@example.com' }] }))
    await expect(call).resolves.toEqual({ content: [{ type: 'text', text: '[redacted]' }] })
    const thrown = hidePersonTypedText(manager, { tabId: 'tab-1' }, () => Promise.reject(new Error('Uncaught Error: person@example.com')))
    await expect(thrown).rejects.toThrow('Uncaught Error: [redacted]')
  })
})
