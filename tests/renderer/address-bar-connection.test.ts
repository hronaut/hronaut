import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BrowserAddressBar from '../../src/renderer/src/components/BrowserAddressBar.vue'
import type { ActiveTabPresentationController } from '../../src/renderer/src/composables/useActiveTabPresentationController.js'
import type { AddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { EmulationController } from '../../src/renderer/src/features/emulation/useEmulationController.js'
import type { PageToolsPresentationController } from '../../src/renderer/src/composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
import type { SitePermissionsController } from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { addressSecurity } from '../../src/shared/address-security.js'
import type { BrowserTabState, SupportedLocale } from '../../src/shared/types.js'

const realResizeObserver = globalThis.ResizeObserver
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
const realClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth)
  Object.defineProperty(Element.prototype, 'clientWidth', realClientWidth)
})

/**
 * A layout that gives the address text `room` pixels without the label, which is `label` pixels wide, as the shell window
 * would; the field loses the label's width and the button's 7 more while the label shows.
 */
function layout(room: number, label = 70): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains('site-security-label') ? label : 0 }
  })
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      if (!this.classList.contains('address')) return 0
      const shown = document.querySelector('.site-security-label:not(.measured-only)')
      return shown ? room - label - 7 : room
    }
  })
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback([{ target } as unknown as ResizeObserverEntry], this)
    }
    unobserve(): void {}
    disconnect(): void {}
  }
}

/** The "Not secure" label, which stays in the button, out of the layout, while it does not show. */
function securityLabel(): HTMLElement {
  return screen.getByRole('button', { name: /^(Not secure|Nicht sicher)\. / }).querySelector<HTMLElement>('.site-security-label')!
}

/** The address bar showing a page at `url`. */
function renderAddressBar(url: string, locale: SupportedLocale = 'en-US', dirty = ref(false)) {
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
    dirty,
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
  it('shows “Not secure” on the site controls button of an HTTP page and says it first', async () => {
    layout(640)
    renderAddressBar('http://192.168.1.20:3000/admin')
    const button = screen.getByRole('button', { name: 'Not secure. Site controls for 192.168.1.20' })
    await vi.waitFor(() => expect(button).toHaveClass('not-secure'))
    expect(securityLabel()).toHaveTextContent('Not secure')
    expect(securityLabel()).not.toHaveClass('measured-only')
  })

  it('says it in the interface language', async () => {
    layout(640)
    renderAddressBar('http://dev.example/', 'de-DE')
    const button = screen.getByRole('button', { name: 'Nicht sicher. Website-Einstellungen für dev.example' })
    await vi.waitFor(() => expect(button).toHaveClass('not-secure'))
    expect(securityLabel()).toHaveTextContent('Nicht sicher')
  })

  it('keeps only the icon when the address would keep less than 280 pixels beside the label, and still says it', async () => {
    // 360 pixels leave the address 283 beside a 70-pixel label, but only 203 beside a 150-pixel one.
    layout(360, 70)
    const roomy = renderAddressBar('http://dev.example/')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Not secure. Site controls for dev.example' })).toHaveClass('not-secure'))
    roomy.unmount()

    layout(360, 150)
    renderAddressBar('http://dev.example/')
    const button = screen.getByRole('button', { name: 'Not secure. Site controls for dev.example' })
    await vi.waitFor(() => expect(securityLabel()).toHaveClass('measured-only'))
    expect(button).not.toHaveClass('not-secure')
  })

  it('keeps only the icon while you type in the field, as Chrome does', async () => {
    layout(640)
    const dirty = ref(false)
    renderAddressBar('http://dev.example/', 'en-US', dirty)
    const button = screen.getByRole('button', { name: 'Not secure. Site controls for dev.example' })
    await vi.waitFor(() => expect(button).toHaveClass('not-secure'))
    dirty.value = true
    await vi.waitFor(() => expect(button).not.toHaveClass('not-secure'))
    expect(securityLabel()).toHaveClass('measured-only')
    dirty.value = false
    await vi.waitFor(() => expect(button).toHaveClass('not-secure'))
  })

  it.each(['https://example.test/login', 'http://localhost:5173/', 'http://127.0.0.1:8080/'])(
    'shows no “Not secure” for %s',
    (url) => {
      layout(640)
      renderAddressBar(url)
      const button = screen.getByRole('button', { name: `Site controls for ${new URL(url).hostname}` })
      expect(button).not.toHaveTextContent('Not secure')
      expect(button).not.toHaveClass('not-secure')
    }
  )
})
