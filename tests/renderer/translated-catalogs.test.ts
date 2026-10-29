import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import ResponsivePreviewPanel from '../../src/renderer/src/features/emulation/ResponsivePreviewPanel.vue'
import SearchSettingsPanel from '../../src/renderer/src/features/settings/SearchSettingsPanel.vue'
import { useSearchSettingsController } from '../../src/renderer/src/features/settings/useSearchSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import { searchEngineMessages } from '../../src/shared/locales/search-engines.js'
import { viewportPresetMessages } from '../../src/shared/locales/viewport-presets.js'
import { SEARCH_ENGINE_OPTIONS } from '../../src/shared/search-engine.js'
import type { AppSettings, BrowserState, BrowserTabState } from '../../src/shared/types.js'
import { BROWSER_VIEWPORT_PRESETS } from '../../src/shared/viewport-presets.js'

describe('translated preset and search engine catalogs', () => {
  it('names every viewport preset and search engine in every language, with English matching the shared catalog', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(viewportPresetMessages[locale]).sort()).toEqual(BROWSER_VIEWPORT_PRESETS.map((preset) => preset.id).sort())
      expect(Object.keys(searchEngineMessages[locale]).sort()).toEqual(SEARCH_ENGINE_OPTIONS.map((engine) => engine.id).sort())
    }
    for (const preset of BROWSER_VIEWPORT_PRESETS) {
      expect(viewportPresetMessages['en-US'][preset.id]).toEqual({ label: preset.label, description: preset.description })
    }
    for (const engine of SEARCH_ENGINE_OPTIONS) {
      expect(searchEngineMessages['en-US'][engine.id]).toBe(engine.description)
    }
  })

  it('shows the responsive presets in the interface language', () => {
    let mutation = 0
    render(ResponsivePreviewPanel, {
      global: { plugins: [createHronautI18n('de-DE')] },
      props: {
        open: true,
        dock: 'right',
        activeTab: { id: 'tab-1', url: 'https://example.test/', title: 'Example' } as BrowserTabState,
        locale: 'de-DE',
        setTabViewport: vi.fn(async () => ({}) as BrowserState),
        syncState: vi.fn(async (operation: Promise<BrowserState>) => { await operation }),
        beginMutation: () => ++mutation,
        isMutationCurrent: (sequence: number) => sequence === mutation,
        closeTransientPanels: vi.fn(),
        keepsSeparatePanelOpen: () => false
      }
    })

    const presets = screen.getByRole('group', { name: 'Voreinstellung des responsiven Ansichtsbereichs' })
    expect(presets).toHaveTextContent('Kompaktes Smartphone')
    expect(presets).toHaveTextContent('Schmale mobile Layouts')
    expect(presets).toHaveTextContent('Breite Desktop-Layouts')
    expect(presets).not.toHaveTextContent('Compact phone')
    expect(presets).not.toHaveTextContent('Narrow mobile')
  })

  it('describes the search engines in the interface language and keeps brand names', () => {
    const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
    const controller = useSearchSettingsController({ settings, setSearchEngine: vi.fn(async () => settings.value), addSiteSearch: vi.fn(), updateSiteSearch: vi.fn(), removeSiteSearch: vi.fn(), onError: vi.fn() })
    render(SearchSettingsPanel, {
      global: { plugins: [createHronautI18n('de-DE')] },
      props: { controller }
    })

    try {
      const duckDuckGo = screen.getByTestId('search-engine-duckduckgo')
      expect(duckDuckGo).toHaveTextContent('DuckDuckGo')
      expect(duckDuckGo).toHaveTextContent('Suche ohne personalisiertes Tracking')
      expect(screen.getByTestId('search-engine-google')).not.toHaveTextContent('Broad web results')
    } finally {
      controller.dispose()
    }
  })
})
