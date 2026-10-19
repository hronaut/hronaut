import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SiteControlsPanel from '../../src/renderer/src/components/SiteControlsPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SitePermissionDecision, SitePermissionEntry } from '../../src/shared/types.js'
import { getByTooltip } from './helpers/tooltip.js'

const cameraPermission: SitePermissionEntry = {
  origin: 'https://example.test',
  permission: 'media',
  decision: 'allow'
}

function renderPanel(options: {
  setPermission?: (entry: SitePermissionEntry, decision: SitePermissionDecision) => boolean | Promise<boolean>
  permissionPending?: () => boolean
  permissions?: SitePermissionEntry[]
} = {}) {
  const setPermission = options.setPermission ?? vi.fn(() => true)
  const resetPermission = vi.fn(() => true)
  const openPermissionSettings = vi.fn()
  const openPrivacySettings = vi.fn()
  const view = render(SiteControlsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      dock: 'right',
      hostname: 'example.test',
      addressKind: 'Secure',
      origin: 'https://example.test',
      summary: { origin: 'https://example.test', cookieCount: 2, historyEntries: 3, historyVisits: 5 },
      state: 'idle',
      message: '',
      permissions: options.permissions ?? [cameraPermission],
      locale: 'en-US',
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
    const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
    const embedded = { origin: 'https://widget.test', permission: 'geolocation', decision: 'allow' as const, workspaceId, embeddedIn: 'https://example.test' }
    const { setPermission } = renderPanel({ permissions: [
      { ...cameraPermission, workspaceId },
      { origin: 'https://example.test', permission: 'geolocation', decision: 'deny' },
      embedded
    ] })
    const user = userEvent.setup()
    expect(screen.getByText('All workspaces')).toBeVisible()
    expect(screen.getByText('https://widget.test')).toBeVisible()
    const ownLocation = screen.getByRole('combobox', { name: 'Location permission for https://example.test' })
    const widgetLocation = screen.getByRole('combobox', { name: 'Location permission for https://widget.test' })
    expect(ownLocation.id).not.toBe(widgetLocation.id)
    expect(screen.getByLabelText(/Location\s+https:\/\/widget\.test/)).toBe(widgetLocation)
    await user.selectOptions(widgetLocation, 'deny')
    expect(setPermission).toHaveBeenCalledWith(embedded, 'deny')
  })
})
