import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadItem, Session } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

// When control of a workspace changes (Pause agents, an MCP session closing, another client resuming it), a live
// transfer leaves the agent's observation, and finished downloads stay in it. Archiving and restoring the workspace
// handed the live transfer back to the agent, and a download that finished after the change stayed hidden for good.

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() }, session: {}, WebContentsView: class {}, nativeImage: {}, app: { getPath: () => '/tmp' }, Menu: {} }))

const { BrowserDownloadsController } = await import('../src/main/browser/downloads-controller.js')
const { WorkspaceRegistry } = await import('../src/main/browser/workspace-registry.js')

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * The real downloads controller on a faked session, in workspace `w` whose observation generation is kept as the tab
 * manager keeps it, and the real workspace registry archiving and restoring `w` as the tab manager wires it.
 */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-download-observation-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const generations = new Map([['w', 0]])
  const session = new EventEmitter()
  const controller = new BrowserDownloadsController({
    getSettings: () => ({ downloadDirectory: directory, saveDialogTitle: 'Save', askWhereToSaveDownloads: false }),
    getSource: () => ({ tabId: 'tab-1', workspaceId: 'w', observationGeneration: generations.get('w')! }),
    workspaceObservationGeneration: id => generations.get(id) ?? 0,
    isAvailable: () => true,
    publish: () => undefined
  })
  cleanups.push(() => controller.destroy())
  controller.attachSession(session as unknown as Session)
  /** A control change, which advances the workspace's observation as suspending its continuity does. */
  const changeControl = () => {
    generations.set('w', generations.get('w')! + 1)
    controller.advanceWorkspaceObservationGeneration('w', generations.get('w')!)
  }
  function download(filename: string) {
    const item = new EventEmitter()
    let savePath = ''
    let state = 'progressing'
    const cancel = vi.fn()
    Object.assign(item, {
      getURL: () => `https://files.example/${filename}`, getURLChain: () => [`https://files.example/${filename}`],
      getContentDisposition: () => '', getFilename: () => filename, getState: () => state,
      getReceivedBytes: () => 1, getTotalBytes: () => 2, isPaused: () => false, pause: vi.fn(), resume: vi.fn(),
      canResume: () => false, getSavePath: () => savePath, setSavePath: (value: string) => { savePath = value },
      setSaveDialogOptions: () => undefined, cancel
    })
    session.emit('will-download', { preventDefault: vi.fn() }, item as unknown as DownloadItem, { id: 1 })
    const entry = controller.listDownloads().find((candidate) => candidate.filename === filename)!
    return {
      entry,
      cancel,
      async complete() {
        await writeFile(savePath, 'downloaded bytes')
        state = 'completed'
        item.emit('done', {}, 'completed')
      }
    }
  }
  const tabs = [{ id: 'tab-1', mcpGroupId: 'w', title: 'Files', url: 'https://files.example/', pinned: false }]
  const registry: InstanceType<typeof WorkspaceRegistry> = new WorkspaceRegistry({
    maxTabs: 50,
    maxArchived: 50,
    tabs: () => tabs,
    requireActive: (id) => ({ id }) as never,
    assertRestoreCapacity: () => undefined,
    withActiveOperation: (_id, _action, run) => run(),
    withArchivedOperation: (_id, _action, run) => run(),
    // Closing the workspace for its archive suspends its continuity, which advances its observation.
    closeActive: async (id) => { tabs.splice(0); registry.active.delete(id); changeControl() },
    createTab: async (tab) => { tabs.push({ id: `tab-${tabs.length + 2}`, ...tab }) },
    selectTab: () => undefined,
    remapDownloads: (from, to) => controller.remapDownloadWorkspaceOwnership(from, to),
    changed: () => undefined
  })
  registry.active.set('w', {
    id: 'w', name: 'Files', description: '', color: 'blue', createdAt: '', lastUsedAt: '', activeTabId: 'tab-1',
    storageId: '8e3da8ea-cba4-41c2-9619-a6e04a493a44', origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] },
    navigationAudit: [], contextClass: 'standard'
  })
  const listed = () => controller.manageWorkspaceDownloads('w', 'list').map((entry) => entry.filename).sort()
  return { controller, registry, changeControl, download, listed }
}

describe('downloads in an agent\'s observation', () => {
  it('keep a live transfer a control change took from the agent out of it after the workspace is archived and restored', async () => {
    const { controller, registry, changeControl, download, listed } = await fixture()
    const transfer = download('big.iso')
    const finished = download('notes.pdf')
    await finished.complete()
    changeControl()
    expect(listed()).toEqual(['notes.pdf'])

    await registry.archive('w')
    await registry.restore('w')

    expect(listed()).toEqual(['notes.pdf'])
    expect(() => controller.manageWorkspaceDownloads('w', 'cancel', transfer.entry.id)).toThrow('Active download not found')
    expect(transfer.cancel).not.toHaveBeenCalled()
  })

  it('include a download that finished after a control change, as one that finished before it', async () => {
    const { controller, changeControl, download, listed } = await fixture()
    const early = download('early.pdf')
    const late = download('late.pdf')
    await early.complete()
    changeControl()
    changeControl()

    await late.complete()

    expect(listed()).toEqual(['early.pdf', 'late.pdf'])
    await expect(controller.completedWorkspaceDownloadFile('w', late.entry.id)).resolves.toMatchObject({ savePath: late.entry.savePath })
  })
})
