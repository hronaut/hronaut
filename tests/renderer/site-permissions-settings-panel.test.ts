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
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function renderPanel(entries = [locationPermission]) {
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
  controller.replace(entries)
  const view = render(SitePermissionsSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { api, controller, view }
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
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    saving.reject(new Error('cannot save permission'))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot save permission')
    expect(select).toHaveValue('allow')
    expect(select).not.toBeDisabled()
    controller.dispose()
  })
})

const permissions = ['first', 'middle', 'third'].map(name => ({
  ...locationPermission, origin: `https://${name}.example.test`
}))
const forgetName = (entry: SitePermissionEntry) => `Forget Location permission for ${entry.origin}`
const selectName = (entry: SitePermissionEntry) => `Location permission for ${entry.origin}`

it.each([0, 1, 2])('focuses a neighboring permission across site groups after forgetting row %i', async index => {
  const { controller } = renderPanel(permissions)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: forgetName(permissions[index]) }))
  const neighbor = permissions[index === 2 ? 1 : index + 1]
  await vi.waitFor(() => expect(screen.getByRole('button', { name: forgetName(neighbor) })).toHaveFocus())
  controller.dispose()
})

it('focuses the section heading after forgetting the final permission', async () => {
  const { controller } = renderPanel()
  await userEvent.setup().click(screen.getByRole('button', { name: forgetName(locationPermission) }))
  await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Site permissions' })).toHaveFocus())
  expect(screen.getByText('No saved decisions')).toBeVisible()
  controller.dispose()
})

it('keeps a pending Forget action focused and ignores repeated activation', async () => {
  const pending = deferred<boolean>()
  const { api, controller } = renderPanel(permissions)
  api.remove.mockImplementationOnce(() => pending.promise)
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: forgetName(permissions[1]) })
  await user.click(button)
  expect(button).not.toBeDisabled()
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(api.remove).toHaveBeenCalledOnce()
  pending.reject(new Error('Synthetic forget failure'))
  await screen.findByRole('alert')
  expect(button).toHaveFocus()
  expect(button).toHaveAttribute('aria-disabled', 'false')
  controller.dispose()
})

it.each(['select', 'forget'])('recovers a focused %s after a live permission removal', async kind => {
  const { controller } = renderPanel(permissions)
  const role = kind === 'select' ? 'combobox' : 'button'
  const name = kind === 'select' ? selectName : forgetName
  screen.getByRole(role, { name: name(permissions[1]) }).focus()
  controller.replace([permissions[0], permissions[2]])
  await vi.waitFor(() => expect(screen.getByRole(role, { name: name(permissions[2]) })).toHaveFocus())
  controller.dispose()
})

it('keeps newer human focus when a pending removal completes', async () => {
  const pending = deferred<boolean>()
  const { api, controller } = renderPanel(permissions)
  api.remove.mockImplementationOnce(() => pending.promise)
  await userEvent.setup().click(screen.getByRole('button', { name: forgetName(permissions[1]) }))
  const selected = screen.getByRole('combobox', { name: selectName(permissions[0]) })
  selected.focus()
  pending.resolve(true)
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: forgetName(permissions[1]) })).not.toBeInTheDocument())
  expect(selected).toHaveFocus()
  controller.dispose()
})

it('does not restore old permission focus after the panel unmounts', async () => {
  const pending = deferred<boolean>()
  const { api, controller, view } = renderPanel(permissions)
  api.remove.mockImplementationOnce(() => pending.promise)
  await userEvent.setup().click(screen.getByRole('button', { name: forgetName(permissions[1]) }))
  view.unmount()
  const newer = document.createElement('button')
  document.body.append(newer)
  newer.focus()
  pending.resolve(true)
  await vi.waitFor(() => expect(controller.entries.value).toHaveLength(2))
  expect(newer).toHaveFocus()
  newer.remove()
  controller.dispose()
})

it('skips a following pending permission when recovering removal focus', async () => {
  const pending = deferred<boolean>()
  const { api, controller } = renderPanel(permissions)
  api.remove.mockImplementationOnce(() => pending.promise)
  const pendingRemoval = controller.remove(permissions[2])
  await userEvent.setup().click(screen.getByRole('button', { name: forgetName(permissions[1]) }))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: forgetName(permissions[0]) })).toHaveFocus())
  pending.resolve(true)
  await pendingRemoval
  controller.dispose()
})

it('keeps a retained control focused when another site is removed', async () => {
  const { controller } = renderPanel(permissions)
  const retained = screen.getByRole('combobox', { name: selectName(permissions[2]) })
  retained.focus()
  controller.replace([permissions[0], permissions[2]])
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: forgetName(permissions[1]) })).not.toBeInTheDocument())
  expect(retained).toHaveFocus()
  controller.dispose()
})

it('recovers the heading when a live update removes every permission', async () => {
  const { controller } = renderPanel(permissions)
  screen.getByRole('combobox', { name: selectName(permissions[1]) }).focus()
  controller.replace([])
  await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Site permissions' })).toHaveFocus())
  controller.dispose()
})
