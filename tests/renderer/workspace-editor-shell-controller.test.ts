import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceEditorShellController } from '../../src/renderer/src/composables/useWorkspaceEditorShellController.js'

describe('useWorkspaceEditorShellController', () => {
  it('owns the closed editor state and safely ignores actions before the panel mounts', async () => {
    const controller = useWorkspaceEditorShellController()

    expect(controller.open.value).toBe(false)
    expect(controller.panel.value).toBeNull()

    await expect(controller.openExisting('workspace-1')).resolves.toBeUndefined()
    await expect(controller.openNew()).resolves.toBeUndefined()
    expect(() => controller.close()).not.toThrow()
  })

  it('routes edit, create, and close actions through the mounted editor panel', async () => {
    const controller = useWorkspaceEditorShellController()
    const panel = {
      openExisting: vi.fn(async () => {}),
      openNew: vi.fn(async () => {}),
      close: vi.fn()
    }
    controller.panel.value = panel

    await controller.openExisting('workspace-2')
    await controller.openNew()
    controller.close()

    expect(panel.openExisting).toHaveBeenCalledOnce()
    expect(panel.openExisting).toHaveBeenCalledWith('workspace-2')
    expect(panel.openNew).toHaveBeenCalledOnce()
    expect(panel.close).toHaveBeenCalledOnce()
  })

  it('preserves editor action failures for the shell action reporter', async () => {
    const controller = useWorkspaceEditorShellController()
    const failure = new Error('workspace state unavailable')
    controller.panel.value = {
      openExisting: vi.fn(async () => { throw failure }),
      openNew: vi.fn(async () => { throw failure }),
      close: vi.fn()
    }

    await expect(controller.openExisting('workspace-3')).rejects.toBe(failure)
    await expect(controller.openNew()).rejects.toBe(failure)
  })
})
