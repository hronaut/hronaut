import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BrowserAddressBar from '../../src/renderer/src/components/BrowserAddressBar.vue'
import type { ActiveTabPresentationController } from '../../src/renderer/src/composables/useActiveTabPresentationController.js'
import type { AddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { EmulationController } from '../../src/renderer/src/composables/useEmulationController.js'
import type { PageToolsPresentationController } from '../../src/renderer/src/composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
import type { SitePermissionsController } from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { addressSecurity } from '../../src/shared/address-security.js'
import type { BrowserTabState, SupportedLocale } from '../../src/shared/types.js'

const realResizeObserver = globalThis.ResizeObserver

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver
})

/** A layout that gives the address field this width, as the shell window would. */
function fieldWidth(width: number): void {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this)
    }
    unobserve(): void {}
    disconnect(): void {}
  }
}

/** The address bar showing a page at `url`. */
function renderAddressBar(url: string, locale: SupportedLocale = 'en-US') {
  const parsed = new URL(url)
  const tab = { id: 'tab-1', title: 'Page', url, loading: false, navigationGeneration: 0, active: true } as BrowserTabState
  const addressController = {
    address: ref(url),
    input: ref<HTMLInputElement | null>(null),
    form: ref<HTMLFormElement | null>(null),
    selection: ref(-1),
    suggestions: ref([]),
    visible: ref(false),
    selected: ref(undefined),
    switchFocused: ref(false),
    keyword: ref(null),
    keywordHint: ref(null),
    suggestionId: vi.fn(),
    switchSuggestionId: vi.fn(),
    suggestionMeta: vi.fn(),
    handleFocus: vi.fn(),
    handleInput: vi.fn(),
    handlePaste: vi.fn(),
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDrop: vi.fn(),
    handleFocusOut: vi.fn(),
    handleKeydown: vi.fn(),
    submit: vi.fn()
  } as unknown as AddressBarController
  return render(BrowserAddressBar, {
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      siteControlsOpen: false,
      panelDock: 'right',
      activeTab: tab,
      addressController,
      activeTabPresentation: {
        activeWebUrl: ref(url),
        activeOrigin: ref(parsed.origin),
        activeHostname: ref(parsed.hostname),
        activeSitePermissions: ref([]),
        activeSecurity: ref(addressSecurity(url)),
        activeAddressKind: ref('HTTP address')
      } as unknown as ActiveTabPresentationController,
      emulationController: { activeEmulation: ref(undefined), resetPending: ref(false), label: vi.fn(), describe: vi.fn() } as unknown as EmulationController,
      pageToolsPresentation: { activeNetworkRouteCount: ref(0) } as unknown as PageToolsPresentationController,
      siteDataController: { summary: ref(null), state: ref('idle'), message: ref(''), refresh: vi.fn() } as unknown as SiteDataSummaryController,
      sitePermissionsController: { permissionLabel: (value: string) => value, isPending: () => false } as unknown as SitePermissionsController,
      locale,
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
        resetSitePermission: vi.fn(async () => true),
        openSitePermissionSettings: vi.fn(),
        openSitePrivacySettings: vi.fn()
      }
    }
  })
}

describe('the address bar’s connection, as in Chrome', () => {
  it('shows “Not secure” on the site controls button of an HTTP page and says it first', () => {
    fieldWidth(640)
    renderAddressBar('http://192.168.1.20:3000/admin')
    const button = screen.getByRole('button', { name: 'Not secure. Site controls for 192.168.1.20' })
    expect(button).toHaveTextContent('Not secure')
    expect(button).toHaveClass('not-secure')
  })

  it('says it in the interface language', () => {
    fieldWidth(640)
    renderAddressBar('http://dev.example/', 'de-DE')
    expect(screen.getByRole('button', { name: 'Nicht sicher. Website-Einstellungen für dev.example' })).toHaveTextContent('Nicht sicher')
  })

  it('keeps only the icon in a narrow address field, and still says it', async () => {
    fieldWidth(300)
    renderAddressBar('http://dev.example/')
    const button = screen.getByRole('button', { name: 'Not secure. Site controls for dev.example' })
    await vi.waitFor(() => expect(button).not.toHaveTextContent('Not secure'))
    expect(button).not.toHaveClass('not-secure')
  })

  it.each(['https://example.test/login', 'http://localhost:5173/', 'http://127.0.0.1:8080/'])(
    'shows no “Not secure” for %s',
    (url) => {
      fieldWidth(640)
      renderAddressBar(url)
      const button = screen.getByRole('button', { name: `Site controls for ${new URL(url).hostname}` })
      expect(button).not.toHaveTextContent('Not secure')
      expect(button).not.toHaveClass('not-secure')
    }
  )
})
