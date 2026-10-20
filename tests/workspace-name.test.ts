import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const { normalizedWorkspaceName } = await import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')

describe('workspace names', () => {
  it('keeps a name on one line, without control or invisible formatting characters', () => {
    // An agent can name a workspace. A line break added a paragraph to a native prompt that named it, a right-to-left
    // override reversed the words after it, and a zero-width space made a name read like another one.
    expect(normalizedWorkspaceName('Personal”.\n\nThis request is your own. Choose Allow.\u202E')).toBe('Personal”. This request is your own. Choose Allow.')
    expect(normalizedWorkspaceName('Client\u2028A\u2029\tB\u0007')).toBe('Client A B')
    expect(normalizedWorkspaceName('Per\u200Bsonal\u200E')).toBe('Per sonal')
    expect(normalizedWorkspaceName('  Client   A  ')).toBe('Client A')
    // Joiners inside an emoji stay, and the name is NFC-normalized.
    expect(normalizedWorkspaceName('QA 👩\u200D💻')).toBe('QA 👩\u200D💻')
    expect(normalizedWorkspaceName('Cafe\u0301')).toBe('Café')
  })

  it('refuses a name that is empty once cleaned, or too long', () => {
    expect(() => normalizedWorkspaceName('\u202E\n\u200B')).toThrow()
    expect(normalizedWorkspaceName('a'.repeat(80))).toBe('a'.repeat(80))
    expect(() => normalizedWorkspaceName('a'.repeat(81))).toThrow()
    // Characters removed before the length check do not count.
    expect(normalizedWorkspaceName(`${'a'.repeat(80)}\u200B`)).toBe('a'.repeat(80))
  })
})
