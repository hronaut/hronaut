import { describe, expect, it, vi } from 'vitest'
import { plainWorkspaceName } from '../src/shared/plain-workspace-name.js'
import { previewWorkspaceTemplate } from '../src/shared/workspace-template.js'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

// The browser below stubs changed, which changing a workspace publishes through this.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))

const { normalizedWorkspaceName, updateMcpTabGroup } = await import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')

describe('workspace names', () => {
  it('keeps a name on one line, without control or invisible formatting characters', () => {
    // An agent can name a workspace. A line break added a paragraph to a native prompt that named it, a right-to-left
    // override reversed the words after it, and tag characters hid text in it.
    expect(normalizedWorkspaceName('Personal”.\n\nThis request is your own. Choose Allow.\u202E')).toBe('Personal”. This request is your own. Choose Allow.')
    expect(normalizedWorkspaceName('Client\u2028A\u2029\tB\u0007')).toBe('Client A B')
    expect(normalizedWorkspaceName('Per\u200Bsonal\u2066')).toBe('Personal')
    expect(normalizedWorkspaceName('Te\u{E0041}\u{E0042}am')).toBe('Team')
    expect(normalizedWorkspaceName('Inter\u00ADnational')).toBe('International')
  })

  it('keeps what names in other scripts and emoji need, and the spaces as typed', () => {
    expect(normalizedWorkspaceName('QA 👩\u200D💻')).toBe('QA 👩\u200D💻')
    const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'
    expect(normalizedWorkspaceName(`Team ${england}`)).toBe(`Team ${england}`)
    expect(normalizedWorkspaceName('\u05E6\u05D5\u05D5\u05EA (2)\u200F')).toBe('\u05E6\u05D5\u05D5\u05EA (2)\u200F')
    expect(normalizedWorkspaceName('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645 \u0600\u0661')).toBe('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645 \u0600\u0661')
    expect(normalizedWorkspaceName('  Client  A\u00A0B  ')).toBe('Client  A\u00A0B')
    expect(normalizedWorkspaceName('Cafe\u0301')).toBe('Café')
  })

  it('combines a letter and its accent once an invisible character between them is removed', () => {
    // Saved as "Cafe" and a separate accent, the name made the next start stop with "Saved workspace metadata is
    // unavailable", since saved names must be NFC-normalized.
    for (const invisible of ['\u00AD', '\u200B', '\u2060']) {
      const name = normalizedWorkspaceName(`Cafe${invisible}\u0301 QA`)
      expect(name).toBe('Caf\u00E9 QA')
      expect(name).toBe(name.trim().normalize('NFC'))
    }
  })

  it('removes code points Unicode does not assign yet', () => {
    // A saved name must be plain to load. The later Unicode an update brings could make such a code point invisible
    // formatting, or an accent that combines with the letter before it, and stop Hronaut from starting.
    // Noncharacters are unassigned in every version, so this stays a test of unassigned code points.
    expect(normalizedWorkspaceName('Client\uFDD0 A\u{10FFFF}')).toBe('Client A')
    const name = normalizedWorkspaceName('Cafe\u{1FFFE}\u0301 QA')
    expect(name).toBe('Caf\u00E9 QA')
    expect(name).toBe(plainWorkspaceName(name))
    expect(() => normalizedWorkspaceName('\uFDD0\uFFFF')).toThrow()
    // A template's workspace gets the same name, so its preview finds the same collisions.
    const template = JSON.stringify({
      format: 'hronaut-workspace-template',
      version: 1,
      sourcePlatform: 'linux',
      workspaces: [{ name: 'Client A\uFDD0', color: 'blue', startPages: [] }]
    })
    expect(previewWorkspaceTemplate(template, ['Client A'])).toMatchObject({ canImport: false, collisions: ['Client A'] })
  })

  it('refuses a name that is empty once plain, or too long', () => {
    expect(() => normalizedWorkspaceName('\u202E\n\u200B')).toThrow()
    expect(normalizedWorkspaceName('a'.repeat(80))).toBe('a'.repeat(80))
    expect(() => normalizedWorkspaceName('a'.repeat(81))).toThrow()
    // Characters removed before the length check do not count.
    expect(normalizedWorkspaceName(`${'a'.repeat(80)}\u200B`)).toBe('a'.repeat(80))
  })

  it('does not check the name the workspace editor sends back unchanged with other changes', () => {
    // The editor sends the name with every change.
    const group = {
      id: 'agent', name: 'Personal', description: '', color: 'blue', agentAccess: true, lastUsedAt: '',
      origins: [], navigationPolicy: { mode: 'all', rules: [] }
    }
    const taken = vi.fn(() => { throw new Error('That workspace name is already used.') })
    const tabManager = {
      mcpTabGroups: new Map([[group.id, group]]),
      tabs: new Map(),
      inspectionPermissions: new WeakMap(),
      workspaceOperations: new Map(),
      assertWorkspaceNameAvailable: taken,
      changed: () => undefined
    }
    updateMcpTabGroup(tabManager as never, 'agent', { name: 'Personal\u200B', color: 'red', agentAccess: false })
    expect(group).toMatchObject({ name: 'Personal', color: 'red', agentAccess: false })
    expect(taken).not.toHaveBeenCalled()
    // A changed name is made plain and checked.
    expect(() => updateMcpTabGroup(tabManager as never, 'agent', { name: 'Client\u2066 A' })).toThrow('already used')
    expect(taken).toHaveBeenCalledWith('Client A', 'agent', undefined, false)
  })

  it('finds a template workspace whose plain name another workspace has before importing it', () => {
    // The preview compared names as written, and the import, which makes them plain, then refused one and rolled back
    // without a reason.
    const template = JSON.stringify({
      format: 'hronaut-workspace-template',
      version: 1,
      sourcePlatform: 'linux',
      workspaces: [{ name: 'Client\u200B A', color: 'blue', startPages: [] }]
    })
    const preview = previewWorkspaceTemplate(template, ['Client A'])
    expect(preview).toMatchObject({ canImport: false, collisions: ['Client A'] })
    expect(preview.template.workspaces[0]!.name).toBe(plainWorkspaceName('Client\u200B A'))
  })
})
