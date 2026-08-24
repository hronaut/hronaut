import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import BrowserAddressBar from '../../src/renderer/src/components/BrowserAddressBar.vue'
import DetachedPanelUnavailableState from '../../src/renderer/src/components/DetachedPanelUnavailableState.vue'
import PageProblemBar from '../../src/renderer/src/components/PageProblemBar.vue'
import type { ActiveTabPresentationController } from '../../src/renderer/src/composables/useActiveTabPresentationController.js'
import type { AddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { EmulationController } from '../../src/renderer/src/composables/useEmulationController.js'
import type { PageToolsPresentationController } from '../../src/renderer/src/composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
import type { SitePermissionsController } from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState, SitePermissionEntry } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

function tab(pageProblem?: BrowserTabState['pageProblem']): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...(pageProblem ? { pageProblem } : {})
  }
}

describe('extracted shell components', () => {
  it('keeps address submission, route actions, and site-permission focus recovery inside the address bar', async () => {
    const permission: SitePermissionEntry = {
      origin: 'https://example.test',
      permission: 'camera',
      decision: 'deny'
    }
    const submit = vi.fn()
    const openRoutes = vi.fn()
    const resetPermission = vi.fn(async () => true)
    const addressController = {
      address: ref('https://example.test/app'),
      input: ref<HTMLInputElement | null>(null),
      form: ref<HTMLFormElement | null>(null),
      selection: ref(-1),
      suggestions: ref([]),
      visible: ref(false),
      selected: ref(undefined),
      suggestionId: vi.fn(),
      suggestionMeta: vi.fn(),
      handleFocus: vi.fn(),
      handleInput: vi.fn(),
      handleFocusOut: vi.fn(),
      handleKeydown: vi.fn(),
      submit
    } as unknown as AddressBarController
    const activeTabPresentation = {
      activeWebUrl: ref('https://example.test/app'),
      activeOrigin: ref('https://example.test'),
      activeHostname: ref('example.test'),
      activeSitePermissions: ref([permission]),
      activeAddressKind: ref('Secure HTTPS connection'),
      activeTabUsesDefaultProfile: ref(true)
    } as unknown as ActiveTabPresentationController
    const emulationController = {
      activeEmulation: ref(undefined),
      resetPending: ref(false),
      label: vi.fn(),
      describe: vi.fn()
    } as unknown as EmulationController
    const pageToolsPresentation = {
      activeNetworkRouteCount: ref(2)
    } as unknown as PageToolsPresentationController
    const siteDataController = {
      summary: ref({ origin: 'https://example.test', cookieCount: 2, historyEntries: 3, historyVisits: 5 }),
      state: ref('idle'),
      message: ref('')
    } as unknown as SiteDataSummaryController
    const sitePermissionsController = {
      permissionLabel: (value: string) => value === 'camera' ? 'Camera' : value,
      isPending: () => false
    } as unknown as SitePermissionsController
    const view = render(BrowserAddressBar, {
      global,
      props: {
        siteControlsOpen: true,
        panelDock: 'right',
        addressController,
        activeTabPresentation,
        emulationController,
        pageToolsPresentation,
        siteDataController,
        sitePermissionsController,
        locale: 'en-US',
        formatNumber: (value: number) => String(value),
        runAction: (action: () => unknown) => action(),
        actions: {
          toggleSiteControls: vi.fn(),
          resetActiveTabEmulation: vi.fn(),
          openRequestConditions: openRoutes,
          setSitePermission: vi.fn(async () => true),
          resetSitePermission: resetPermission,
          openSitePermissionSettings: vi.fn(),
          openSitePrivacySettings: vi.fn()
        }
      }
    })
    const user = userEvent.setup()

    const address = screen.getByRole('combobox', { name: 'Address' })
    await user.click(address)
    await user.keyboard('{Enter}')
    expect(submit).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: /Open 2 temporary request conditions/ }))
    expect(openRoutes).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: /Reset Camera permission for https:\/\/example\.test/ }))
    expect(resetPermission).toHaveBeenCalledWith(permission)
    expect(screen.getByRole('button', { name: 'Site controls for example.test' })).toHaveFocus()
    expect(view.emitted()['update:siteControlsOpen']).toBeUndefined()
  })

  it('renders page failure details and delegates a retry', async () => {
    const view = render(PageProblemBar, {
      global,
      props: {
        tab: tab({
          kind: 'load-error',
          title: 'Site unavailable',
          message: 'Hronaut could not load this page.',
          url: 'https://example.test/app',
          errorCode: -105,
          errorDescription: 'ERR_NAME_NOT_RESOLVED'
        }),
        details: () => 'ERR_NAME_NOT_RESOLVED (-105)'
      }
    })

    expect(screen.getByRole('alert')).toHaveTextContent('ERR_NAME_NOT_RESOLVED (-105)')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(view.emitted().retry).toHaveLength(1)
  })

  it('owns the unavailable detached-panel state, docking, and close action', async () => {
    const view = render(DetachedPanelUnavailableState, {
      global,
      props: { label: 'Network', dock: 'window' }
    })
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: 'Network' })).toHaveTextContent('Open a website tab')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock panel' }), 'right')
    await user.click(screen.getByRole('button', { name: 'Close Network' }))

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['right'])
    expect(view.emitted().close).toHaveLength(1)
  })
})
