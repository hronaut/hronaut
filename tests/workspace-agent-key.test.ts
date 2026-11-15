import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import type { MenuItemConstructorOptions } from 'electron'
import { Browser } from '../src/main/browser/browser.js'
import { workspaceContextMenuItems } from '../src/main/browser/context-menus/workspace-context-menu.js'
import { copyWorkspaceAgentKey, workspaceAgentKeyText } from '../src/main/browser/workspace-agent-key/workspace-agent-key.js'
import { workspaceResumeKeySchema } from '../src/main/mcp/tool-schemas.js'
import { LocalizedError } from '../src/main/localized-error.js'

const ACTIVE = '019a0000-0000-7000-8000-000000000001'
const PERSONAL = '019a0000-0000-7000-8000-000000000002'

interface Group { id: string; name: string; storageId: string; agentAccess?: boolean; lastUsedAt: string }

/** A browser built on the real prototype, so resume keys and agent access come from Browser's own methods. */
function fixture() {
  const groups: Group[] = [
    { id: ACTIVE, name: 'Shop "checkout"', storageId: 'storage-active', lastUsedAt: '2026-11-14T09:00:00.000Z' },
    { id: PERSONAL, name: 'Bank', storageId: 'storage-personal', agentAccess: false, lastUsedAt: '2026-11-14T09:00:00.000Z' }
  ]
  const copyText = vi.fn(async (_text: string) => undefined)
  const onActionFailed = vi.fn()
  const browser = Object.assign(Object.create(Browser.prototype), {
    mcpTabGroups: new Map(groups.map((group) => [group.id, group])),
    savedTabGroups: new Map(),
    tabs: new Map(),
    closingWorkspace: null,
    allHumanInteractionLocked: false,
    options: { getLocale: () => 'en-US', copyText, onActionFailed },
    window: { webContents: { send: vi.fn() } }
  }) as Browser
  return { browser, groups, copyText, onActionFailed }
}

/** The resume call the copied text names, read back as an agent would. */
function resumeCall(text: string): Record<string, unknown> {
  const call = /call browser_workspaces with (\{.*?\}) and keep working there/.exec(text)?.[1]
  expect(call, text).toBeDefined()
  return JSON.parse(call!) as Record<string, unknown>
}

describe('copying a workspace key for an agent', () => {
  it('gives the agent the resume call with the workspace ID and the key that resumes it', async () => {
    const { browser, copyText } = fixture()
    await copyWorkspaceAgentKey(browser, ACTIVE)
    expect(copyText).toHaveBeenCalledOnce()
    const text = copyText.mock.calls[0]![0]
    const call = resumeCall(text)
    expect(call).toEqual({ action: 'resume', workspaceId: ACTIVE, resumeKey: browser.mcpWorkspaceResumeKey(ACTIVE) })
    // The key is one browser_workspaces accepts, and the name is quoted so its own quotes stay inside it.
    expect(workspaceResumeKeySchema.safeParse(call.resumeKey).success).toBe(true)
    expect(text).toContain('Continue in my Hronaut workspace "Shop \\"checkout\\"":')
    expect(text).toContain('instead of creating a new workspace')
  })

  it('refuses a workspace with direct agent access off, whose key would not resume it, and copies nothing', async () => {
    const { browser, copyText } = fixture()
    const refusal = await copyWorkspaceAgentKey(browser, PERSONAL).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(LocalizedError)
    expect((refusal as LocalizedError).key).toBe('appErrors.workspace.agentAccessOff')
    expect(() => workspaceAgentKeyText(browser, '019a0000-0000-7000-8000-00000000ffff')).toThrow('Unknown workspace')
    expect(copyText).not.toHaveBeenCalled()
  })

  it('refuses a workspace the person just closed, which waits to be deleted', async () => {
    const { browser, copyText } = fixture()
    Object.assign(browser, { closingWorkspace: { id: ACTIVE } })
    await expect(copyWorkspaceAgentKey(browser, ACTIVE)).rejects.toThrow('Agent access is off')
    expect(copyText).not.toHaveBeenCalled()
  })

  it('is in the workspace menu only while agents may use the workspace, and copies from main when chosen', async () => {
    const { browser, groups, copyText, onActionFailed } = fixture()
    const item = (group: Group) => workspaceContextMenuItems(browser, group as never)
      .find((entry): entry is MenuItemConstructorOptions => entry.id === 'copy-workspace-agent-key')
    expect(item(groups[1]!)).toBeUndefined()
    const copy = item(groups[0]!)
    expect(copy?.label).toBe('Copy Key for an Agent')
    copy!.click!({} as never, undefined, {} as never)
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledOnce())
    expect(resumeCall(copyText.mock.calls[0]![0]).workspaceId).toBe(ACTIVE)
    expect(onActionFailed).not.toHaveBeenCalled()
  })

  it('reports a copy the clipboard refused as a failed menu action', async () => {
    const { browser, groups, copyText, onActionFailed } = fixture()
    const error = new Error('Clipboard rejected the text')
    copyText.mockRejectedValueOnce(error)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const copy = workspaceContextMenuItems(browser, groups[0] as never).find((entry) => entry.id === 'copy-workspace-agent-key')
      copy!.click!({} as never, undefined, {} as never)
      await vi.waitFor(() => expect(onActionFailed).toHaveBeenCalledWith('copy the workspace key for an agent', error))
      // The log names the action, never the key.
      expect(JSON.stringify(spy.mock.calls)).not.toContain('hrw1_')
    } finally {
      spy.mockRestore()
    }
  })
})
