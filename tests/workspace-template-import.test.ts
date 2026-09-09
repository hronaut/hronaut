import { describe, expect, it, vi } from 'vitest'
import { WorkspaceTemplateImporter, type WorkspaceTemplateImportPort } from '../src/main/browser/workspace-template-import.js'
import { RetainedBrowserWorkspaceError } from '../src/main/browser/workspace-errors.js'

function template(names = ['First', 'Second']): string {
  return JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: names.map(name => ({ name, color: 'blue', startPages: ['https://example.com/'] })) })
}
function setup() {
  const existing = [{ id: 'personal', name: 'Personal' }]
  let next = 0
  const port = {
    existingWorkspaces: vi.fn(() => [...existing]),
    create: vi.fn<WorkspaceTemplateImportPort['create']>(async entry => {
      const id = `new-${++next}`
      existing.push({ id, name: entry.name })
      return id
    }),
    openStartPages: vi.fn<WorkspaceTemplateImportPort['openStartPages']>(async () => undefined),
    remove: vi.fn<WorkspaceTemplateImportPort['remove']>(async id => {
      const index = existing.findIndex(workspace => workspace.id === id)
      if (index >= 0) existing.splice(index, 1)
    })
  }
  return { importer: new WorkspaceTemplateImporter(port), port, existing }
}

describe('workspace template import recovery', () => {
  it('allocates the whole batch before opening approved start pages', async () => {
    const { importer, port, existing } = setup()
    port.openStartPages.mockImplementation(async () => { expect(existing).toHaveLength(3) })
    expect(await importer.import(template())).toEqual({ status: 'completed', workspaceIds: ['new-1', 'new-2'] })
    expect(port.openStartPages).toHaveBeenNthCalledWith(1, 'new-1', ['https://example.com/'])
    expect(port.remove).not.toHaveBeenCalled()
  })
  it('validates the entire manifest and current names before allocating', async () => {
    const { importer, port } = setup()
    await expect(importer.import(template(['Personal']))).rejects.toThrow('collisions')
    await expect(importer.import(template(['First', 'FIRST']))).rejects.toThrow('Duplicate')
    await expect(importer.import('{')).rejects.toThrow('JSON')
    expect(port.create).not.toHaveBeenCalled()
  })
  it('rolls back only newly allocated profiles after a later creation fails', async () => {
    const { importer, port, existing } = setup()
    port.create.mockImplementationOnce(async entry => { existing.push({ id: 'new-1', name: entry.name }); return 'new-1' }).mockRejectedValueOnce(new Error('disk failure'))
    expect(await importer.import(template())).toEqual({ status: 'rolled-back', workspaceIds: [] })
    expect(port.remove.mock.calls).toEqual([['new-1']])
    expect(port.openStartPages).not.toHaveBeenCalled()
    expect(existing).toEqual([{ id: 'personal', name: 'Personal' }])
  })
  it('tracks a newly retained failed creation and reports failed rollback without private error text', async () => {
    const { importer, port } = setup()
    port.create.mockRejectedValueOnce(new RetainedBrowserWorkspaceError([], 'retained-new', '/private/path'))
    port.remove.mockRejectedValueOnce(new Error('secret storage detail'))
    expect(await importer.import(template())).toEqual({ status: 'partial', workspaceIds: ['retained-new'] })
    expect(port.remove.mock.calls).toEqual([['retained-new']])
  })
  it('continues cleanup after one failure and keeps only failed identities', async () => {
    const { importer, port, existing } = setup()
    port.openStartPages.mockRejectedValueOnce(new Error('page failed'))
    port.remove.mockRejectedValueOnce(new Error('cleanup failed'))
    expect(await importer.import(template())).toEqual({ status: 'partial', workspaceIds: ['new-2'] })
    expect(port.remove.mock.calls).toEqual([['new-2'], ['new-1']])
    expect(existing.map(workspace => workspace.id)).toEqual(['personal', 'new-2'])
  })
  it.each(['returned', 'thrown'])('never cleans up a pre-existing identity when it is %s by allocation', async mode => {
    const { importer, port } = setup()
    if (mode === 'returned') port.create.mockResolvedValueOnce('personal')
    else port.create.mockRejectedValueOnce(new RetainedBrowserWorkspaceError([], 'personal', 'failure'))
    expect(await importer.import(template())).toEqual({ status: 'rolled-back', workspaceIds: [] })
    expect(port.remove).not.toHaveBeenCalled()
  })
  it('serializes commits and rechecks collisions after a queued import', async () => {
    const { importer, port } = setup()
    const first = importer.import(template(['First']))
    const second = importer.import(template(['First']))
    await expect(first).resolves.toMatchObject({ status: 'completed' })
    await expect(second).rejects.toThrow('collisions')
    expect(port.create).toHaveBeenCalledTimes(1)
    await expect(importer.import(template(['Third']))).resolves.toMatchObject({ status: 'completed' })
  })
})
