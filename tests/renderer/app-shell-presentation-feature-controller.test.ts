import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import {
  useAppShellPresentationFeatureController,
  type AppShellPresentationFeatureController
} from '../../src/renderer/src/composables/useAppShellPresentationFeatureController.js'
import type { WindowChromeState } from '../../src/shared/types.js'

const foley = vi.hoisted(() => ({ play: vi.fn(), set: vi.fn() }))
vi.mock('@foleyjs/core', () => foley)

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

function chrome(overrides: Partial<WindowChromeState> = {}): WindowChromeState {
  return { platform: 'linux', mode: 'overlay', mainWindow: true, ...overrides }
}

function mountFeature(options: {
  search?: string
  windowChrome?: WindowChromeState
}) {
  const settings = ref({
    ...DEFAULT_RENDERER_SETTINGS,
    tabPosition: 'left' as const
  })
  const systemTheme = ref<'light' | 'dark'>('dark')
  let controller!: AppShellPresentationFeatureController
  const wrapper = mount(defineComponent({
    setup() {
      controller = useAppShellPresentationFeatureController({
        settings,
        systemTheme,
        search: options.search ?? '',
        translate: (key, params) => key === 'panels.title'
          ? `${String(params?.panel)} — Hronaut`
          : key === 'panels.network'
            ? 'Network'
            : key === 'panels.console'
              ? 'Console'
              : key,
        targetDocument: document,
        windowChrome: options.windowChrome ?? chrome()
      })
      return () => h('div')
    }
  }))
  return { controller, settings, systemTheme, wrapper }
}

function unmount(wrapper: VueWrapper): void {
  wrapper.unmount()
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: memoryStorage({ 'hronaut:panel-dock': 'bottom' })
  })
})

afterEach(() => {
  foley.play.mockReset()
  foley.set.mockReset()
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
  document.documentElement.removeAttribute('data-panel-window')
  document.documentElement.removeAttribute('data-title-bar-mode')
  document.documentElement.removeAttribute('data-desktop-platform')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-preference')
  document.documentElement.style.colorScheme = ''
  document.title = ''
})

describe('useAppShellPresentationFeatureController', () => {
  it('composes the main-window title bar, appearance, and saved panel dock', () => {
    const { controller, wrapper } = mountFeature({})

    expect(controller.isDetachedPanelWindow).toBe(false)
    expect(controller.detachedPanelId).toBeNull()
    expect(controller.overlayEnabled).toBe(true)
    expect(controller.tabOrientation.value).toBe('vertical')
    expect(controller.tabRailWidth.value).toBe(280)
    expect(controller.panelDock.value).toBe('bottom')
    expect(controller.keepsSeparatePanelOpen()).toBe(false)
    expect(document.documentElement.dataset.titleBarMode).toBe('overlay')
    expect(document.documentElement.dataset.desktopPlatform).toBe('linux')
    expect(document.documentElement.dataset.theme).toBe('dark')

    unmount(wrapper)
  })

  it('propagates detached-panel identity into rail and dock presentation', () => {
    const { controller, wrapper } = mountFeature({
      search: '?hronautPanel=network',
      windowChrome: chrome({ mode: 'system', mainWindow: false })
    })

    expect(controller.detachedPanelId).toBe('network')
    expect(controller.isDetachedPanelWindow).toBe(true)
    expect(controller.overlayEnabled).toBe(false)
    expect(controller.tabOrientation.value).toBe('horizontal')
    expect(controller.tabRailWidth.value).toBe(0)
    expect(controller.panelDock.value).toBe('window')
    expect(controller.keepsSeparatePanelOpen()).toBe(true)
    expect(document.title).toBe('Network — Hronaut')

    controller.setActivePanelTitle('console')
    expect(document.title).toBe('Console — Hronaut')

    unmount(wrapper)
  })
})
