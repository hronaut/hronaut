import { describe, expect, it, vi } from 'vitest'
import type { BrowserWorkspaceNavigationPolicy } from '../src/shared/types.js'

vi.mock('electron', () => ({ session: {}, app: { getPath: () => '/tmp' } }))
vi.mock('../src/main/browser/workspace-storage.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-storage.js')>(),
  transferWorkspaceStorage: vi.fn(async () => ({})),
  destroyWorkspaceStorage: vi.fn(async () => undefined)
}))

const { createMcpTabGroup } = await import('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js')
const { LocalizedError } = await import('../src/main/localized-error.js')

/** Copies a workspace with the given Site access into a new one with the chosen Site access, as the editor does. */
async function copyWorkspace(sourcePolicy: BrowserWorkspaceNavigationPolicy, chosen?: BrowserWorkspaceNavigationPolicy) {
  const source = { id: 'source', name: 'Research', storageId: 'source-storage', origins: [], navigationPolicy: sourcePolicy }
  const workspaces = new Map<string, unknown>([['source', source]])
  const access = {
    mcpTabGroups: () => workspaces,
    savedTabGroups: () => new Map(),
    tabs: () => new Map(),
    options: () => ({ partition: 'persist:test', configureSession: () => undefined }),
    assertWorkspaceNameAvailable: () => undefined,
    assertActiveWorkspaceCapacity: () => undefined,
    isClosingWorkspace: () => false,
    withGlobalWorkspaceStorageOperation: (_action: string, run: () => unknown) => run(),
    withWorkspaceOperation: (_id: string, _action: string, run: () => unknown) => run(),
    createTab: async () => ({}),
    changed: () => undefined
  }
  try {
    const copy = await createMcpTabGroup(access as never, 'Copy', undefined, 'fork-workspace', undefined, false, chosen, 'source')
    return { policy: copy.navigationPolicy, workspaces: workspaces.size }
  } catch (error) {
    return { refused: error, workspaces: workspaces.size }
  }
}

const listed = (...rules: string[]): BrowserWorkspaceNavigationPolicy => ({ mode: 'restricted', rules })
const anySite: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }

describe('Site access of a workspace copy', () => {
  it('keeps the rules chosen for a copy of a workspace that allows every site', async () => {
    // The source's policy used to replace the choice, so this copy allowed every site.
    await expect(copyWorkspace(anySite, listed('https://app.example'))).resolves.toEqual({ policy: listed('https://app.example'), workspaces: 2 })
  })

  it('keeps the source rules when the copy allows any safe website or an agent chose nothing', async () => {
    const source = listed('https://app.example', 'https://docs.example')
    await expect(copyWorkspace(source, anySite)).resolves.toEqual({ policy: source, workspaces: 2 })
    await expect(copyWorkspace(source)).resolves.toEqual({ policy: source, workspaces: 2 })
  })

  it('accepts listed rules written differently from the source and keeps them in normalized form', async () => {
    await expect(copyWorkspace(listed('https://app.example', 'https://docs.example'), listed('HTTPS://App.Example:443/')))
      .resolves.toEqual({ policy: listed('https://app.example'), workspaces: 2 })
  })

  it('refuses a rule the source does not list before creating anything, even beside rules it lists', async () => {
    for (const chosen of [listed('https://other.example'), listed('https://app.example', 'https://other.example')]) {
      const outcome = await copyWorkspace(listed('https://app.example'), chosen)
      expect(outcome.workspaces).toBe(1)
      expect(outcome.refused).toBeInstanceOf(LocalizedError)
      expect((outcome.refused as InstanceType<typeof LocalizedError>).key).toBe('appErrors.workspace.forkSiteAccess')
      expect((outcome.refused as Error).message).toBe('A copy of "Research" can use only Site access rules that "Research" lists. Choose from its rules, or create the copy and then change its Site access.')
    }
  })
})
