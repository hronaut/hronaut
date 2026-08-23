import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SitePermissionsSettingsPanel from '../../src/renderer/src/components/SitePermissionsSettingsPanel.vue'
import { useSitePermissionsController } from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SitePermissionEntry } from '../../src/shared/types.js'

const locationPermission: SitePermissionEntry = {
  origin: 'https://example.test',
  permission: 'geolocation',
  decision: 'allow'
}

function deferred<Value>() {
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((_resolve, fail) => { reject = fail })
  return { promise, reject }
}

function renderPanel() {
  const api = {
    set: vi.fn(async (_origin: string, _name: string, decision: 'allow' | 'deny') => ({
      ...locationPermission,
      decision
    })),
    remove: vi.fn(async () => true),
    clear: vi.fn(async () => undefined)
  }
  const controller = useSitePermissionsController({
    api,
    onError: vi.fn(),
    translate: (key) => key === 'runtime.permissions.location' ? 'Location' : key
  })
  controller.replace([locationPermission])
  render(SitePermissionsSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { api, controller }
}

describe('SitePermissionsSettingsPanel', () => {
  it('renders grouped permission decisions through the extracted controller', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'Site permissions' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'https://example.test' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Location permission for https://example.test' })).toHaveValue('allow')
    controller.dispose()
  })

  it('disables row actions while saving and restores the select after failure', async () => {
    const saving = deferred<SitePermissionEntry>()
    const { api, controller } = renderPanel()
    const user = userEvent.setup()
    api.set.mockImplementationOnce(() => saving.promise)
    const select = screen.getByRole('combobox', { name: 'Location permission for https://example.test' })
    const remove = screen.getByRole('button', { name: 'Forget Location permission for https://example.test' })

    await user.selectOptions(select, 'deny')

    expect(select).toBeDisabled()
    expect(remove).toBeDisabled()
    saving.reject(new Error('cannot save permission'))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot save permission')
    expect(select).toHaveValue('allow')
    expect(select).not.toBeDisabled()
    controller.dispose()
  })
})
