import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SiteControlsPanel from '../../src/renderer/src/components/SiteControlsPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SitePermissionDecision, SitePermissionEntry, SupportedLocale } from '../../src/shared/types.js'
import { getByTooltip } from './helpers/tooltip.js'

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'
const cameraPermission: SitePermissionEntry = {
  origin: 'https://example.test',
  permission: 'media',
  decision: 'allow',
  workspaceId: WORKSPACE
}

function renderPanel(options: {
  setPermission?: (entry: SitePermissionEntry, decision: SitePermissionDecision) => boolean | Promise<boolean>
  permissionPending?: () => boolean
  permissions?: SitePermissionEntry[]
  locale?: SupportedLocale
  summary?: { cookieCount: number; historyEntries: number; historyVisits: number }
} = {}) {
  const setPermission = options.setPermission ?? vi.fn(() => true)
  const resetPermission = vi.fn(() => true)
  const openPermissionSettings = vi.fn()
  const openPrivacySettings = vi.fn()
  const view = render(SiteControlsPanel, {
    global: { plugins: [createHronautI18n(options.locale ?? 'en-US')] },
    props: {
      open: true,
      dock: 'right',
      hostname: 'example.test',
      addressKind: 'Secure',
      origin: 'https://example.test',
      summary: { origin: 'https://example.test', ...(options.summary ?? { cookieCount: 2, historyEntries: 3, historyVisits: 5 }) },
      state: 'idle',
      message: '',
      permissions: options.permissions ?? [cameraPermission],
      locale: options.locale ?? 'en-US',
      permissionLabel: (permission: string) => permission === 'geolocation' ? 'Location' : 'Camera',
      permissionPending: options.permissionPending ?? (() => false),
      setPermission,
      resetPermission,
      openPermissionSettings,
      openPrivacySettings
    }
  })
  return { view, setPermission, resetPermission, openPermissionSettings, openPrivacySettings }
}

describe('SiteControlsPanel', () => {
  it('owns site summary and permission interactions', async () => {
    const { setPermission, resetPermission, openPermissionSettings, openPrivacySettings } = renderPanel()
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: 'example.test' })).toBeVisible()
    expect(screen.getByText('2')).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: /Camera/ }), 'deny')
    await user.click(getByTooltip('Reset to default'))
    await user.click(screen.getByRole('button', { name: 'All site settings' }))
    await user.click(screen.getByRole('button', { name: 'Site storage' }))

    expect(setPermission).toHaveBeenCalledWith(cameraPermission, 'deny')
    expect(resetPermission).toHaveBeenCalledWith(cameraPermission)
    expect(openPermissionSettings).toHaveBeenCalledOnce()
    expect(openPrivacySettings).toHaveBeenCalledOnce()
  })

  it('emits dock and close model changes', async () => {
    const { view } = renderPanel()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock site controls' }), 'bottom')
    await user.click(screen.getByRole('button', { name: 'Close site controls' }))

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('restores the authoritative permission when persistence fails', async () => {
    const setPermission = vi.fn(async () => false)
    renderPanel({ setPermission })
    const user = userEvent.setup()
    const permission = screen.getByRole('combobox', { name: /Camera/ })

    await user.selectOptions(permission, 'deny')

    expect(permission).toHaveValue('allow')
    expect(setPermission).toHaveBeenCalledWith(cameraPermission, 'deny')
  })

  it('tells a website embedded in the page and a decision for all workspaces apart from the page’s own', async () => {
    // The controls' names never said so, since each name replaced its label, which did.
    const embedded = { origin: 'https://widget.test', permission: 'geolocation', decision: 'allow' as const, workspaceId: WORKSPACE, embeddedIn: 'https://example.test' }
    const { setPermission } = renderPanel({ permissions: [
      cameraPermission,
      { origin: 'https://example.test', permission: 'geolocation', decision: 'deny' },
      embedded
    ] })
    const user = userEvent.setup()
    expect(screen.getByText('All workspaces')).toBeVisible()
    expect(screen.getByText('https://widget.test')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Camera permission for https://example.test' })).toBeVisible()
    const ownLocation = screen.getByRole('combobox', { name: 'Location permission for https://example.test (All workspaces)' })
    const widgetLocation = screen.getByRole('combobox', { name: 'Location permission for https://widget.test (on https://example.test)' })
    expect(ownLocation.id).not.toBe(widgetLocation.id)
    expect(screen.getByLabelText(/Location\s+https:\/\/widget\.test/)).toBe(widgetLocation)
    expect(screen.getByRole('button', { name: 'Reset Location permission for https://widget.test (on https://example.test)' })).toBeVisible()
    await user.selectOptions(widgetLocation, 'deny')
    expect(setPermission).toHaveBeenCalledWith(embedded, 'deny')
  })

  it('does not offer to forget a decision for all workspaces, which would forget it in every one', () => {
    // Reset on a row for all workspaces forgot the decision in every workspace.
    const { resetPermission } = renderPanel({ permissions: [{ origin: 'https://example.test', permission: 'geolocation', decision: 'deny' }] })
    expect(screen.getByRole('combobox', { name: 'Location permission for https://example.test (All workspaces)' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Reset / })).not.toBeInTheDocument()
    expect(resetPermission).not.toHaveBeenCalled()
  })

  it('counts the custom decisions in the interface language', () => {
    // The count read "2 customized" in every language.
    const permissions: SitePermissionEntry[] = [cameraPermission, { ...cameraPermission, permission: 'geolocation' }]
    const english = renderPanel({ permissions })
    expect(screen.getByText('2 customized')).toBeVisible()
    english.view.unmount()
    renderPanel({ permissions, locale: 'uk-UA' })
    expect(screen.getByText('Налаштовано: 2')).toBeVisible()
  })

  it('names cookies, history pages and visits in the form each count takes', () => {
    // The words followed English's one-or-many choice, and the history's spoken summary took one form for both
    // counts: "5 файлы cookie", "5 посещения", "1 history page and 4 visit".
    const english = renderPanel({ summary: { cookieCount: 1, historyEntries: 1, historyVisits: 4 } })
    expect(screen.getByRole('article', { name: '1 history page and 4 visits' })).toBeVisible()
    expect(screen.getByText('cookie')).toBeVisible()
    expect(screen.getByText('history page · 4 visits')).toBeVisible()
    english.view.unmount()

    const russian = renderPanel({ locale: 'ru-RU', summary: { cookieCount: 5, historyEntries: 1, historyVisits: 5 } })
    expect(screen.getByRole('article', { name: '1 страница истории и 5 посещений' })).toBeVisible()
    expect(screen.getByText('файлов cookie')).toBeVisible()
    expect(screen.getByText('страница истории · 5 посещений')).toBeVisible()
    russian.view.unmount()

    renderPanel({ locale: 'uk-UA', summary: { cookieCount: 2, historyEntries: 3, historyVisits: 22 } })
    expect(screen.getByRole('article', { name: '3 сторінки історії та 22 відвідування' })).toBeVisible()
    expect(screen.getByText('файли cookie')).toBeVisible()
    expect(screen.getByText('сторінки історії · 22 відвідування')).toBeVisible()
  })
})
