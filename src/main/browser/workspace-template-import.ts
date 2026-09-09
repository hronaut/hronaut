import { previewWorkspaceTemplate, type WorkspaceTemplateEntry } from '../../shared/workspace-template.js'
import { RetainedBrowserWorkspaceError } from './workspace-errors.js'

export interface WorkspaceTemplateImportPort {
  existingWorkspaces(): { id: string; name: string }[]
  create(entry: WorkspaceTemplateEntry): Promise<string>
  openStartPages(workspaceId: string, urls: string[]): Promise<void>
  remove(workspaceId: string): Promise<void>
}

export interface WorkspaceTemplateImportResult {
  status: 'completed' | 'rolled-back' | 'partial'
  workspaceIds: string[]
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
    if (!preview.canImport) throw new Error('Resolve workspace name collisions before importing.')
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
      for (const [index, entry] of preview.template.workspaces.entries()) {
        await this.port.openStartPages(created[index]!, entry.startPages)
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
