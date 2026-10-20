import { previewWorkspaceTemplate, type WorkspaceTemplateEntry, type WorkspaceTemplateImportResult } from '../../shared/workspace-template.js'
import { LocalizedError } from '../localized-error.js'
import { RetainedBrowserWorkspaceError } from './workspace-errors.js'

export interface WorkspaceTemplateImportPort {
  existingWorkspaces(): { id: string; name: string }[]
  /** How many more tabs and open workspaces Hronaut can open now. */
  room(): { tabs: number; workspaces: number }
  create(entry: WorkspaceTemplateEntry): Promise<string>
  /** Opens each address as a background tab of the workspace. */
  openStartPages(workspaceId: string, urls: string[]): Promise<void>
  remove(workspaceId: string): Promise<void>
}

/** Owns only this batch's newly allocated profiles. Never accepts imported IDs. */
export class WorkspaceTemplateImporter {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly port: WorkspaceTemplateImportPort) {}

  import(text: string): Promise<WorkspaceTemplateImportResult> {
    // Serialize commits, not just their previews. A second import must observe
    // the names and profiles created by the first before making any changes.
    const operation = this.tail.then(() => this.commit(text))
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async commit(text: string): Promise<WorkspaceTemplateImportResult> {
    const existing = this.port.existingWorkspaces()
    const preview = previewWorkspaceTemplate(text, existing.map(workspace => workspace.name))
    if (!preview.canImport) throw new LocalizedError('appErrors.workspace.templateCollisions')
    // Each workspace opens its start pages, or one blank tab, under the browser's tab and open workspace limits. A
    // template that cannot fit is refused before anything is created, instead of being rolled back part way.
    const pages = preview.template.workspaces.map(entry => entry.startPages.length ? entry.startPages : ['about:blank'])
    const needed = { tabs: pages.reduce((total, urls) => total + urls.length, 0), workspaces: pages.length }
    const room = this.port.room()
    if (needed.tabs > room.tabs || needed.workspaces > room.workspaces) {
      throw new LocalizedError('appErrors.workspace.templateRoom', {
        tabs: needed.tabs, freeTabs: Math.max(0, room.tabs), workspaces: needed.workspaces, freeWorkspaces: Math.max(0, room.workspaces)
      })
    }
    const existingIds = new Set(existing.map(workspace => workspace.id))
    const created: string[] = []
    try {
      // Allocate the whole batch before opening any start page. Allocation must
      // use scratch storage and disabled direct agent access in the manager.
      for (const entry of preview.template.workspaces) {
        let id: string
        try {
          id = await this.port.create(entry)
        } catch (error) {
          if (error instanceof RetainedBrowserWorkspaceError && !existingIds.has(error.workspaceId) && !created.includes(error.workspaceId)) {
            created.push(error.workspaceId)
          }
          throw error
        }
        if (!id || existingIds.has(id) || created.includes(id)) throw new Error('Workspace allocation did not return a fresh identity.')
        created.push(id)
      }
      for (const [index, urls] of pages.entries()) {
        await this.port.openStartPages(created[index]!, urls)
      }
      return { status: 'completed', workspaceIds: created }
    } catch {
      const retained: string[] = []
      for (const id of [...created].reverse()) {
        try { await this.port.remove(id) } catch { retained.push(id) }
      }
      // Raw errors may contain local paths or page data. The caller receives
      // only bounded status and identities of profiles that still need cleanup.
      return { status: retained.length ? 'partial' : 'rolled-back', workspaceIds: retained.reverse() }
    }
  }
}
