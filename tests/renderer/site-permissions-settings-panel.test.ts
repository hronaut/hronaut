import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SitePermissionsSettingsPanel from '../../src/renderer/src/components/SitePermissionsSettingsPanel.vue'
import {
  useSitePermissionsController,
  type SitePermissionWorkspace
} from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SitePermissionEntry, SitePermissionScope, SupportedLocale } from '../../src/shared/types.js'

const CLIENT = '01912345-6789-7abc-8def-0123456789ab'
const REMOVED = '01912345-678a-7abc-8def-0123456789ab'
const ARCHIVED = '01912345-678c-7abc-8def-0123456789ab'
const workspaces: SitePermissionWorkspace[] = [{ id: CLIENT, name: 'Client A', archived: false }]

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

function renderPanel(
  entries = [locationPermission],
  locale: SupportedLocale = 'en-US',
  knownWorkspaces: () => readonly SitePermissionWorkspace[] | null = () => workspaces
) {
  const i18n = createHronautI18n(locale)
  const api = {
    set: vi.fn(async (origin: string, permission: string, decision: 'allow' | 'deny', scope?: SitePermissionScope) => ({
      origin,
      permission,
      decision,
      ...scope
    })),
    remove: vi.fn(async () => true),
    clear: vi.fn(async () => undefined)
  }
  const controller = useSitePermissionsController({
    api,
    onError: vi.fn(),
    translate: (key, parameters) => i18n.global.t(key, parameters ?? {}),
    workspaces: knownWorkspaces
  })
  controller.replace(entries)
  const view = render(SitePermissionsSettingsPanel, {
    global: { plugins: [i18n] },
    props: { controller }
  })
  return { api, controller, view, i18n }
}

const searchablePermissions: SitePermissionEntry[] = [
  locationPermission,
  { ...locationPermission, permission: 'media', decision: 'deny' },
  { ...locationPermission, origin: 'http://localhost:4173', permission: 'notifications' }
]

it.each([
  [' EXAMPLE.TEST ', 2],
  ['CAMERA', 1],
  ['geolocation', 1],
  ['localhost:4173', 1],
  ['example.test camera', 1],
  [' CAMERA   EXAMPLE.TEST ', 1],
  ['example.test geolocation', 1],
  ['example.test camera media', 1],
  ['localhost:4173 notifications', 1],
  ['localhost:4173 location', 0],
  ['example.test notifications', 0],
  ['example.test deny', 0],
  ['example.test [a-z]', 0],
  ['   ', 3],
  ['[a-z]', 0]
] as const)('filters saved decisions by literal origin or permission query %s', async (query, count) => {
  const { api, controller } = renderPanel(searchablePermissions)
  const user = userEvent.setup()
  const search = screen.getByRole('searchbox', { name: 'Search saved site permissions' })
  await user.click(search)
  await user.paste(query)
  expect(screen.queryAllByRole('combobox')).toHaveLength(count)
  expect(screen.getByRole('status')).toHaveTextContent(`${count} of 3 saved decisions`)
  expect(search).toHaveFocus()
  expect(controller.entries.value).toHaveLength(3)
  expect(api.set).not.toHaveBeenCalled()
  expect(api.remove).not.toHaveBeenCalled()
  expect(api.clear).not.toHaveBeenCalled()
  await user.clear(search)
  expect(screen.getAllByRole('combobox')).toHaveLength(3)
  controller.dispose()
})

it('distinguishes no matches from an empty store and updates matches without stealing search focus', async () => {
  const { controller } = renderPanel(searchablePermissions)
  const user = userEvent.setup()
  const search = screen.getByRole('searchbox', { name: 'Search saved site permissions' })
  await user.type(search, 'new.example.test')
  expect(screen.getByText('No saved decisions match this search.')).toBeVisible()
  expect(screen.queryByText('No saved decisions', { exact: true })).not.toBeInTheDocument()
  const added = { ...locationPermission, origin: 'https://new.example.test' }
  controller.replace([...searchablePermissions, added])
  await vi.waitFor(() => expect(screen.getByRole('combobox')).toHaveAccessibleName('Location permission for https://new.example.test'))
  expect(screen.getByRole('status')).toHaveTextContent('1 of 4 saved decisions')
  expect(search).toHaveFocus()
  controller.replace(searchablePermissions)
  await screen.findByText('No saved decisions match this search.')
  expect(search).toHaveValue('new.example.test')
  expect(search).toHaveFocus()
  controller.dispose()
})

it('edits only a visible matching decision and keeps hidden decisions intact', async () => {
  const { api, controller } = renderPanel(searchablePermissions)
  const user = userEvent.setup()
  await user.type(screen.getByRole('searchbox'), 'example.test camera')
  await user.selectOptions(screen.getByRole('combobox'), 'allow')
  expect(api.set).toHaveBeenCalledExactlyOnceWith('https://example.test', 'media', 'allow')
  expect(controller.entries.value.find(entry => entry.permission === 'media')?.decision).toBe('allow')
  expect(controller.entries.value.filter(entry => entry.permission !== 'media')).toEqual(expect.arrayContaining([searchablePermissions[0], searchablePermissions[2]]))
  controller.dispose()
})

it('keeps a newer search focused when a hidden pending Forget completes', async () => {
  const pending = deferred<boolean>()
  const { api, controller } = renderPanel(searchablePermissions)
  api.remove.mockImplementationOnce(() => pending.promise)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Forget Location permission for https://example.test' }))
  const search = screen.getByRole('searchbox')
  await user.type(search, 'example.test camera')
  pending.resolve(true)
  await vi.waitFor(() => expect(controller.entries.value).toHaveLength(2))
  expect(search).toHaveFocus()
  expect(search).toHaveValue('example.test camera')
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 saved decisions')
  controller.dispose()
})

it('forgets a filtered decision without removing hidden rows or claiming the store is empty', async () => {
  const { api, controller } = renderPanel(searchablePermissions)
  const user = userEvent.setup()
  await user.type(screen.getByRole('searchbox'), 'example.test camera')
  await user.click(screen.getByRole('button', { name: 'Forget Camera and microphone permission for https://example.test' }))
  await screen.findByText('No saved decisions match this search.')
  expect(api.remove).toHaveBeenCalledExactlyOnceWith('https://example.test', 'media')
  expect(screen.getByRole('status')).toHaveTextContent('0 of 2 saved decisions')
  expect(screen.getByRole('heading', { name: 'Site permissions' })).toHaveFocus()
  expect(controller.entries.value).toEqual(expect.arrayContaining([searchablePermissions[0], searchablePermissions[2]]))
  controller.dispose()
})

it('keeps section reset scoped to all saved decisions while a search is active', async () => {
  const { api, controller } = renderPanel(searchablePermissions)
  await userEvent.setup().type(screen.getByRole('searchbox'), 'camera')
  await controller.clear()
  await screen.findByText('No saved decisions', { exact: true })
  expect(api.clear).toHaveBeenCalledOnce()
  expect(controller.entries.value).toEqual([])
  expect(screen.getByRole('searchbox')).toHaveValue('camera')
  expect(screen.getByRole('status')).toHaveTextContent('0 of 0 saved decisions')
  controller.dispose()
})

it('reacts to the localized permission label and keeps raw permission-name search available', async () => {
  const { controller, i18n } = renderPanel([{ ...locationPermission, permission: 'media' }])
  const user = userEvent.setup()
  const search = screen.getByRole('searchbox')
  await user.type(search, 'example.test Camera')
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  i18n.global.locale.value = 'de-DE'
  await vi.waitFor(() => expect(screen.queryAllByRole('combobox')).toHaveLength(0))
  await user.clear(search)
  await user.type(search, `example.test ${controller.permissionLabel('media')}`)
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  await user.clear(search)
  await user.type(search, 'media')
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  controller.dispose()
})

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

describe('decisions that belong to a workspace and a page', () => {
  const widget = 'https://widget.example'
  const page = 'https://page.example'
  const scoped: SitePermissionEntry[] = [
    { origin: widget, permission: 'geolocation', decision: 'allow' },
    { origin: widget, permission: 'geolocation', decision: 'deny', workspaceId: CLIENT },
    { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: CLIENT, embeddedIn: page },
    { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: REMOVED }
  ]

  it('lists each decision with its workspace, or All workspaces, and the page it was embedded in', () => {
    // Every decision applied in every workspace and on every page, so Settings listed one row per website and permission.
    const { controller } = renderPanel(scoped)
    expect(screen.getByText('geolocation · All workspaces')).toBeVisible()
    expect(screen.getByText('geolocation · Client A')).toBeVisible()
    expect(screen.getByText('geolocation · Client A · on https://page.example')).toBeVisible()
    expect(screen.getByText('notifications · Removed workspace 6789ab')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Location permission for https://widget.example' })).toHaveValue('allow')
    expect(screen.getByRole('combobox', { name: 'Location permission for https://widget.example (Client A)' })).toHaveValue('deny')
    expect(screen.getByRole('combobox', { name: 'Location permission for https://widget.example (Client A · on https://page.example)' }))
      .toHaveValue('allow')
    expect(screen.getByRole('button', { name: 'Forget Notifications permission for https://widget.example (Removed workspace 6789ab)' })).toBeVisible()
    controller.dispose()
  })

  it.each([
    ['client a', 2],
    ['CLIENT page.example', 1],
    ['all workspaces', 1],
    ['removed notifications', 1],
    ['on https://page.example location', 1],
    ['research', 0]
  ] as const)('finds decisions by their workspace’s name and the page they were embedded in: %s', async (query, count) => {
    const { controller } = renderPanel(scoped)
    const user = userEvent.setup()
    await user.click(screen.getByRole('searchbox', { name: 'Search saved site permissions' }))
    await user.paste(query)
    expect(screen.queryAllByRole('combobox')).toHaveLength(count)
    expect(screen.getByRole('status')).toHaveTextContent(`${count} of 4 saved decisions`)
    controller.dispose()
  })

  it('changes and forgets exactly the decision a row names', async () => {
    const saving = deferred<SitePermissionEntry>()
    const { api, controller } = renderPanel(scoped)
    const user = userEvent.setup()
    api.set.mockImplementationOnce(() => saving.promise)
    const embedded = screen.getByRole('combobox', { name: 'Location permission for https://widget.example (Client A · on https://page.example)' })
    await user.selectOptions(embedded, 'deny')
    expect(api.set).toHaveBeenCalledExactlyOnceWith(widget, 'geolocation', 'deny', { workspaceId: CLIENT, embeddedIn: page })
    // The other decisions for the website and permission stay editable while that one saves.
    expect(embedded).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Location permission for https://widget.example (Client A)' })).not.toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Location permission for https://widget.example' })).not.toBeDisabled()
    saving.resolve({ ...scoped[2], decision: 'deny' })
    await vi.waitFor(() => expect(embedded).not.toBeDisabled())

    await user.click(screen.getByRole('button', { name: 'Forget Location permission for https://widget.example (Client A)' }))
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(widget, 'geolocation', { workspaceId: CLIENT })
    await vi.waitFor(() => expect(controller.entries.value).toEqual([
      scoped[0],
      { ...scoped[2], decision: 'deny' },
      scoped[3]
    ]))
    // A decision saved before decisions had a scope is named as it always was.
    await user.click(screen.getByRole('button', { name: 'Forget Location permission for https://widget.example' }))
    expect(api.remove).toHaveBeenLastCalledWith(widget, 'geolocation')
    controller.dispose()
  })

  it('gives each row’s controls a name of its own when workspaces read alike or are gone', () => {
    // Two workspaces of one name, or two removed ones, gave several rows the same accessible name.
    const twin = '01912345-678d-7abc-8def-0123456789cd'
    const goneA = '01912345-678e-7abc-8def-0123456789ef'
    const goneB = '01912345-678f-7abc-8def-012345678901'
    const { controller } = renderPanel([
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: CLIENT },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: twin },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: ARCHIVED },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: goneA },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: goneB }
    ], 'en-US', () => [
      { id: CLIENT, name: 'Client A', archived: false },
      { id: twin, name: 'Client A', archived: false },
      { id: ARCHIVED, name: 'Client A', archived: true }
    ])
    const names = screen.getAllByRole('combobox').map((control) => control.getAttribute('aria-label'))
    expect(names.sort()).toEqual([
      'Location permission for https://widget.example (Client A (archived))',
      'Location permission for https://widget.example (Client A · 6789ab)',
      'Location permission for https://widget.example (Client A · 6789cd)',
      'Location permission for https://widget.example (Removed workspace 678901)',
      'Location permission for https://widget.example (Removed workspace 6789ef)'
    ])
    expect(new Set(screen.getAllByRole('button', { name: /^Forget / }).map((button) => button.getAttribute('aria-label'))).size).toBe(5)
    controller.dispose()
  })

  it('does not call a workspace removed before the workspaces have loaded', async () => {
    // Until the browser state arrived, no workspace was listed, so every row said its workspace was removed.
    const known = ref<SitePermissionWorkspace[] | null>(null)
    const { controller } = renderPanel([scoped[1]], 'en-US', () => known.value)
    expect(screen.getByText('geolocation · Loading workspace…')).toBeVisible()
    expect(screen.queryByText(/Removed workspace/)).not.toBeInTheDocument()
    known.value = workspaces
    expect(await screen.findByText('geolocation · Client A')).toBeVisible()
    controller.dispose()
  })
})
