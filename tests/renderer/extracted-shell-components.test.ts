import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import BrowserAddressBar from '../../src/renderer/src/components/BrowserAddressBar.vue'
import DetachedPanelUnavailableState from '../../src/renderer/src/components/DetachedPanelUnavailableState.vue'
import PageProblemBar from '../../src/renderer/src/components/PageProblemBar.vue'
import {
  useActiveTabPresentationController,
  type ActiveTabPresentationController
} from '../../src/renderer/src/composables/useActiveTabPresentationController.js'
import type { AddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { EmulationController } from '../../src/renderer/src/composables/useEmulationController.js'
import type { PageToolsPresentationController } from '../../src/renderer/src/composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
import {
  useSitePermissionsController,
  type SitePermissionsController
} from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState, SitePermissionEntry } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }
const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

function tab(pageProblem?: BrowserTabState['pageProblem']): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app',
    loading: false,
    navigationGeneration: 0,
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
      decision: 'deny',
      workspaceId: WORKSPACE
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
      message: ref(''),
      refresh: vi.fn()
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
        activeTab: tab(),
        addressController,
        activeTabPresentation,
        emulationController,
        pageToolsPresentation,
        siteDataController,
        sitePermissionsController,
        locale: 'en-US',
        formatNumber: (value: number) => String(value),
        runAction: (action: () => unknown) => action(),
        keepsSeparatePanelOpen: () => false,
        actions: {
          toggleSiteControls: vi.fn(),
          resetActiveTabEmulation: vi.fn(),
          clearActiveCssStatePreview: vi.fn(),
          stopActiveVirtualPasskey: vi.fn(),
          stopActiveLogpoints: vi.fn(),
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

  it('does not reopen site controls or steal focus after a permission reset becomes stale', async () => {
    const permission: SitePermissionEntry = {
      origin: 'https://example.test',
      permission: 'camera',
      decision: 'deny',
      workspaceId: WORKSPACE
    }
    let finishReset!: (removed: boolean) => void
    const resetPermission = vi.fn(() => new Promise<boolean>((resolve) => {
      finishReset = resolve
    }))
    const activeTabPresentation = {
      activeWebUrl: ref('https://example.test/app'),
      activeOrigin: ref('https://example.test'),
      activeHostname: ref('example.test'),
      activeSitePermissions: ref([permission]),
      activeAddressKind: ref('Secure HTTPS connection'),
      activeTabUsesDefaultProfile: ref(true)
    } as unknown as ActiveTabPresentationController
    const view = render(BrowserAddressBar, {
      global,
      props: {
        siteControlsOpen: true,
        panelDock: 'right',
        activeTab: tab(),
        addressController: {
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
          submit: vi.fn()
        } as unknown as AddressBarController,
        activeTabPresentation,
        emulationController: {
          activeEmulation: ref(undefined),
          resetPending: ref(false),
          label: vi.fn(),
          describe: vi.fn()
        } as unknown as EmulationController,
        pageToolsPresentation: { activeNetworkRouteCount: ref(0) } as unknown as PageToolsPresentationController,
        siteDataController: {
          summary: ref(null),
          state: ref('idle'),
          message: ref(''),
          refresh: vi.fn()
        } as unknown as SiteDataSummaryController,
        sitePermissionsController: {
          permissionLabel: (value: string) => value === 'camera' ? 'Camera' : value,
          isPending: () => false
        } as unknown as SitePermissionsController,
        locale: 'en-US',
        formatNumber: (value: number) => String(value),
        runAction: (action: () => unknown) => action(),
        keepsSeparatePanelOpen: () => false,
        actions: {
          toggleSiteControls: vi.fn(),
          resetActiveTabEmulation: vi.fn(),
          clearActiveCssStatePreview: vi.fn(),
          stopActiveVirtualPasskey: vi.fn(),
          stopActiveLogpoints: vi.fn(),
          openRequestConditions: vi.fn(),
          setSitePermission: vi.fn(async () => true),
          resetSitePermission: resetPermission,
          openSitePermissionSettings: vi.fn(),
          openSitePrivacySettings: vi.fn()
        }
      }
    })
    const user = userEvent.setup()
    const resetButton = screen.getByRole('button', { name: /Reset Camera permission/ })
    await user.click(resetButton)

    await view.rerender({
      siteControlsOpen: false,
      activeTab: { ...tab(), id: 'tab-2', url: 'https://other.test/' }
    })
    const newerTarget = document.createElement('button')
    document.body.append(newerTarget)
    newerTarget.focus()

    finishReset(true)
    await vi.waitFor(() => expect(resetPermission).toHaveBeenCalledOnce())
    await nextTick()

    expect(view.emitted()['update:siteControlsOpen']).toBeUndefined()
    expect(document.activeElement).toBe(newerTarget)
    newerTarget.remove()
  })

  it('changes exactly the tab’s workspace decision in Site controls', async () => {
    const saved: SitePermissionEntry = { origin: 'https://example.test', permission: 'geolocation', decision: 'allow', workspaceId: WORKSPACE }
    const i18n = createHronautI18n('en-US')
    const activeTab = ref<BrowserTabState | undefined>({ ...tab(), mcpGroupId: WORKSPACE })
    let finishSave!: (entry: SitePermissionEntry) => void
    const api = {
      set: vi.fn((_origin: string, _permission: string, _decision: string, _scope?: unknown) => (
        new Promise<SitePermissionEntry>((resolve) => { finishSave = resolve })
      )),
      remove: vi.fn(async () => true),
      clear: vi.fn(async () => undefined)
    }
    const sitePermissionsController = useSitePermissionsController({
      api,
      translate: (key, parameters) => i18n.global.t(key, parameters ?? {}),
      workspaces: () => [{ id: WORKSPACE, name: 'Client A', archived: false }],
      fileSaving: { enabled: () => false, set: async () => undefined },
      onError: vi.fn()
    })
    sitePermissionsController.replace([saved])
    const activeTabPresentation = useActiveTabPresentationController({
      state: ref({ tabs: [activeTab.value!], closedTabs: [], activeTabId: 'tab-1', allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', mcpTabGroups: [], savedTabGroups: [] }),
      activeTab,
      sitePermissions: sitePermissionsController.entries,
      credentials: ref([]),
      downloads: ref([]),
      bookmarks: ref([]),
      translate: (key) => key,
      formatNumber: (value) => String(value),
      describeEmulation: () => ''
    })
    render(BrowserAddressBar, {
      global: { plugins: [i18n] },
      props: {
        siteControlsOpen: true,
        panelDock: 'right',
        activeTab: activeTab.value,
        addressController: {
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
          submit: vi.fn()
        } as unknown as AddressBarController,
        activeTabPresentation,
        emulationController: { activeEmulation: ref(undefined), resetPending: ref(false), label: vi.fn(), describe: vi.fn() } as unknown as EmulationController,
        pageToolsPresentation: { activeNetworkRouteCount: ref(0) } as unknown as PageToolsPresentationController,
        siteDataController: { summary: ref(null), state: ref('idle'), message: ref(''), refresh: vi.fn() } as unknown as SiteDataSummaryController,
        sitePermissionsController,
        locale: 'en-US',
        formatNumber: (value: number) => String(value),
        runAction: (action: () => unknown) => action(),
        keepsSeparatePanelOpen: () => false,
        actions: {
          toggleSiteControls: vi.fn(),
          resetActiveTabEmulation: vi.fn(),
          clearActiveCssStatePreview: vi.fn(),
          stopActiveVirtualPasskey: vi.fn(),
          stopActiveLogpoints: vi.fn(),
          openRequestConditions: vi.fn(),
          setSitePermission: sitePermissionsController.setDecision,
          resetSitePermission: sitePermissionsController.remove,
          openSitePermissionSettings: vi.fn(),
          openSitePrivacySettings: vi.fn()
        }
      }
    })
    const user = userEvent.setup()
    const control = screen.getByRole('combobox', { name: 'Location permission for https://example.test' })
    await user.selectOptions(control, 'deny')
    expect(api.set).toHaveBeenCalledExactlyOnceWith('https://example.test', 'geolocation', 'deny', { workspaceId: WORKSPACE })
    expect(control).toBeDisabled()

    finishSave({ ...saved, decision: 'deny' })
    await vi.waitFor(() => expect(control).not.toBeDisabled())
    expect(control).toHaveValue('deny')
    expect(screen.getByRole('button', { name: 'Reset Location permission for https://example.test' })).toBeVisible()
    expect(sitePermissionsController.entries.value).toEqual([{ ...saved, decision: 'deny' }])
  })

  it('shows an active forced CSS state in the address bar and lets the person end it', async () => {
    const clearPreview = vi.fn()
    const stopPasskey = vi.fn()
    const stopLogpoints = vi.fn()
    const preview = {
      states: ['hover', 'active'] as Array<'hover' | 'active'>,
      selector: '#card',
      startedAt: '2026-10-15T12:00:00.000Z',
      expiresAt: '2026-10-15T12:00:30.000Z'
    }
    const props = {
      siteControlsOpen: false,
      panelDock: 'right' as const,
      activeTab: tab(),
      addressController: {
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
        submit: vi.fn()
      } as unknown as AddressBarController,
      activeTabPresentation: {
        activeWebUrl: ref('https://example.test/app'),
        activeOrigin: ref('https://example.test'),
        activeHostname: ref('example.test'),
        activeSitePermissions: ref([]),
        activeAddressKind: ref('Secure HTTPS connection'),
        activeTabUsesDefaultProfile: ref(true)
      } as unknown as ActiveTabPresentationController,
      emulationController: {
        activeEmulation: ref(undefined),
        resetPending: ref(false),
        label: vi.fn(),
        describe: vi.fn()
      } as unknown as EmulationController,
      pageToolsPresentation: { activeNetworkRouteCount: ref(0) } as unknown as PageToolsPresentationController,
      siteDataController: { summary: ref(null), state: ref('idle'), message: ref(''), refresh: vi.fn() } as unknown as SiteDataSummaryController,
      sitePermissionsController: { permissionLabel: (value: string) => value, isPending: () => false } as unknown as SitePermissionsController,
      locale: 'en-US' as const,
      formatNumber: (value: number) => String(value),
      runAction: (action: () => unknown) => action(),
      keepsSeparatePanelOpen: () => false,
      actions: {
        toggleSiteControls: vi.fn(),
        resetActiveTabEmulation: vi.fn(),
        clearActiveCssStatePreview: clearPreview,
        stopActiveVirtualPasskey: stopPasskey,
        stopActiveLogpoints: stopLogpoints,
        openRequestConditions: vi.fn(),
        setSitePermission: vi.fn(async () => true),
        resetSitePermission: vi.fn(async () => true),
        openSitePermissionSettings: vi.fn(),
        openSitePrivacySettings: vi.fn()
      }
    }
    const view = render(BrowserAddressBar, { global, props })
    expect(screen.queryByTestId('css-state-preview-pill')).toBeNull()

    await view.rerender({ activeTab: { ...tab(), cssStatePreview: preview } })
    const pill = screen.getByRole('button', { name: 'Stop forcing :hover :active on #card' })
    expect(pill).toHaveTextContent('Forced :hover :active')
    expect(pill).not.toHaveClass('offline')
    await userEvent.setup().click(pill)
    expect(clearPreview).toHaveBeenCalledOnce()

    // A removal Hronaut could not confirm stays visible with a retry, never silently disappears.
    await view.rerender({ activeTab: { ...tab(), cssStatePreview: { ...preview, states: ['hover'], resetUncertain: true } } })
    const retry = screen.getByRole('button', { name: 'Try again to remove forced :hover from #card' })
    expect(retry).toHaveTextContent('Forced :hover not confirmed removed')
    expect(retry).toHaveClass('offline')

    // An agent's virtual passkey is always visible, with the person's stop.
    expect(screen.queryByTestId('virtual-passkey-pill')).toBeNull()
    await view.rerender({ activeTab: { ...tab(), virtualPasskey: { origin: 'http://localhost:3000', expiresAt: '2026-10-19T06:00:00.000Z' } } })
    const passkey = screen.getByRole('button', { name: 'Stop the virtual passkey for http://localhost:3000' })
    expect(passkey).toHaveTextContent('Virtual passkey')
    await userEvent.setup().click(passkey)
    expect(stopPasskey).toHaveBeenCalledOnce()

    // An agent's armed logpoints are always visible, with the person's stop.
    expect(screen.queryByTestId('logpoints-pill')).toBeNull()
    await view.rerender({ activeTab: { ...tab(), logpoints: { origin: 'https://shop.example', probes: 2, expiresAt: '2026-10-19T06:00:00.000Z' } } })
    const logpoints = screen.getByRole('button', { name: 'Stop the agent\'s logpoints on https://shop.example' })
    expect(logpoints).toHaveTextContent('Logpoints')
    await userEvent.setup().click(logpoints)
    expect(stopLogpoints).toHaveBeenCalledOnce()
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
