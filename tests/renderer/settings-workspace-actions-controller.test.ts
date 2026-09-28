import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSettingsWorkspaceActionsController } from '../../src/renderer/src/composables/useSettingsWorkspaceActionsController.js'

function fixture() {
  const options = {
    closeSettings: vi.fn(),
    openExisting: vi.fn(async (_id: string) => {}),
    openNew: vi.fn(async () => {}),
    openTransfer: vi.fn(async (_id?: string) => {}),
    onError: vi.fn()
  }
  return { options, controller: useSettingsWorkspaceActionsController(options) }
}

describe('Settings workspace actions', () => {
  it.each(['manage', 'create', 'transfer'] as const)('reports a failed %s action after closing Settings', async (action) => {
    const { options, controller } = fixture()
    const error = new Error('Workspace state unavailable')
    options.openExisting.mockRejectedValue(error)
    options.openNew.mockRejectedValue(error)
    options.openTransfer.mockRejectedValue(error)
    const operation = action === 'create' ? controller.create() : controller[action]('workspace-1')
    expect(options.closeSettings).toHaveBeenCalledOnce()
    expect(options.openExisting).not.toHaveBeenCalled()
    expect(options.openNew).not.toHaveBeenCalled()
    expect(options.openTransfer).not.toHaveBeenCalled()
    await expect(operation).resolves.toBeUndefined()
    expect(options.onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('forwards workspace targets and allows a fresh action after a failure', async () => {
    const { options, controller } = fixture()
    options.openExisting.mockRejectedValueOnce(new Error('Temporary failure'))
    await controller.manage('workspace-1')
    await controller.manage('workspace-2')
    expect(options.openExisting).toHaveBeenLastCalledWith('workspace-2')
    await controller.transfer('workspace-3')
    expect(options.openTransfer).toHaveBeenLastCalledWith('workspace-3')
    await controller.transfer()
    expect(options.openTransfer).toHaveBeenLastCalledWith(undefined)
    await controller.create()
    await nextTick()
    expect(options.openNew).toHaveBeenCalledOnce()
    expect(options.onError).toHaveBeenCalledOnce()
  })
})
