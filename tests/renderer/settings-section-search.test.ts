import { defineComponent, ref, watch } from 'vue'
import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsNavigation from '../../src/renderer/src/components/SettingsNavigation.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

import { useSettingsSectionSearch } from '../../src/renderer/src/composables/useSettingsSectionSearch.js'
import { SETTINGS_NAVIGATION } from '../../src/renderer/src/settings-navigation.js'
import { translate } from '../../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import type { SettingsSection } from '../../src/renderer/src/composables/useSettingsDialogController.js'

const icon = defineComponent({ template: '<svg />' })
/** The sections Settings lists for a search in an interface language, best first. */
function sectionsFound(locale: string, query: string): SettingsSection[] {
  const items = ref(SETTINGS_NAVIGATION.map(item => ({
    section: item.section,
    label: translate(locale as never, item.labelKey as never),
    description: translate(locale as never, item.descriptionKey as never),
    keywords: translate(locale as never, `settingsSections.keywords.${item.section}` as never),
    icon
  })))
  let search!: ReturnType<typeof useSettingsSectionSearch>
  render(defineComponent({ setup() { search = useSettingsSectionSearch(items, ref('appearance')); return {} }, template: '<div />' }), {
    global: { plugins: [createHronautI18n(locale as never)] }
  })
  search.query.value = query
  return search.matches.value.map(item => item.section)
}
function navigation() {
  const change = vi.fn()
  const Harness = defineComponent({
    components: { SettingsNavigation },
    setup() {
      const section = ref<SettingsSection>('appearance')
      watch(section, change)
      const items = ref([
        { section: 'appearance' as const, label: 'Appearance', description: 'Theme and window', keywords: 'theme dark', icon },
        { section: 'general' as const, label: 'General', description: 'Language, startup, agents', keywords: 'tray attention sound', icon },
        { section: 'mcp' as const, label: 'MCP security', description: 'Local authentication', icon },
        { section: 'downloads' as const, label: 'Downloads', description: 'Location and prompts', icon }
      ])
      return { section, ...useSettingsSectionSearch(items, section) }
    },
    template: `<header><input v-model="query" type="search" aria-label="Find a section…" @keydown="searchKeydown"></header><SettingsNavigation v-model="section" :items="matches" />`
  })
  render(Harness, { global: { plugins: [createHronautI18n('en-US')] } })
  return { change, input: screen.getByRole('searchbox', { name: 'Find a section…' }) }
}

describe('settings section search', () => {
  it.each([
    { mode: 0, delta: 30, distance: 30, lineHeight: '20px' },
    { mode: 1, delta: 3, distance: 60, lineHeight: '20px' },
    { mode: 1, delta: -3, distance: -60, lineHeight: '20px' },
    { mode: 1, delta: 3, distance: 48, lineHeight: 'normal' },
    { mode: 2, delta: 1, distance: 240, lineHeight: '20px' },
    { mode: 2, delta: -1, distance: -240, lineHeight: '20px' }
  ])('normalizes section-rail wheel units: %j', ({ mode, delta, distance, lineHeight }) => {
    navigation()
    const rail = screen.getByRole('navigation', { name: 'Settings sections' })
    rail.style.lineHeight = lineHeight
    Object.defineProperties(rail, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 1200 },
      scrollLeft: { configurable: true, writable: true, value: 300 }
    })
    const wheel = new WheelEvent('wheel', { deltaMode: mode, deltaY: delta, cancelable: true })
    rail.dispatchEvent(wheel)
    expect(rail.scrollLeft).toBe(300 + distance)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('keeps dynamic icon components out of Vue reactivity', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      navigation()
      expect(warning.mock.calls.flat().join(' ')).not.toContain('Component that was made a reactive object')
    } finally {
      warning.mockRestore()
    }
  })

  // Searching for a setting by its name, such as the tray or the attention sound, found no section.
  it('finds a section by the settings it holds', async () => {
    const { input, change } = navigation()
    await userEvent.type(input, 'tray')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([expect.stringContaining('General')])
    await userEvent.keyboard('{Enter}')
    expect(change).toHaveBeenCalledOnce()
    expect(change.mock.calls.at(-1)?.[0]).toBe('general')
    await userEvent.clear(input)
    await userEvent.type(input, 'sound attention')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  // The words were matched exactly, so a setting searched in another form of its word, as Russian puts it after
  // another word ("ключ лицензии"), found nothing.
  it.each([
    { locale: 'ru-RU', query: 'ключ лицензии', sections: ['support'] },
    { locale: 'ru-RU', query: 'кошелёк', sections: ['wallets'] },
    { locale: 'ru-RU', query: 'обновить', sections: ['updates'] },
    { locale: 'ru-RU', query: 'очистить историю', sections: ['privacy'] },
    { locale: 'ru-RU', query: 'тёмный режим', sections: ['appearance'] },
    { locale: 'ru-RU', query: 'автозапуск', sections: ['general'] },
    { locale: 'ru-RU', query: 'язык', sections: ['general'] },
    { locale: 'uk-UA', query: 'трей', sections: ['general'] },
    { locale: 'en-US', query: 'attention sound', sections: ['general'] },
    { locale: 'en-US', query: 'interface language', sections: ['general'] },
    { locale: 'en-US', query: 'system tray', sections: ['general'] },
    { locale: 'ru-RU', query: 'язык интерфейса', sections: ['general'] },
    { locale: 'en-US', query: 'updated', sections: ['updates'] },
    { locale: 'en-US', query: 'dark mode', sections: ['appearance'] },
    { locale: 'en-US', query: 'proxy', sections: [] }
  ])('finds $query in $locale by the sections Settings shows', ({ locale, query, sections }) => {
    expect(sectionsFound(locale, query)).toEqual(sections)
  })

  // The words for a section's settings and other forms of a word find more sections, which came first in their usual
  // order, so Enter opened Downloads for "local" instead of MCP security, whose description says it.
  it.each([
    { locale: 'en-US', query: 'local', first: 'mcp' },
    { locale: 'en-US', query: 'profile', first: 'privacy' },
    { locale: 'ru-RU', query: 'вкладки', first: 'performance' }
  ])('lists first the section whose name or description has $query in $locale', ({ locale, query, first }) => {
    const found = sectionsFound(locale, query)
    expect(found[0]).toBe(first)
    expect(found.length).toBeGreaterThan(1)
  })

  it('has search words for every section in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const item of SETTINGS_NAVIGATION) {
        const key = `settingsSections.keywords.${item.section}` as Parameters<typeof translate>[1]
        expect(translate(locale, key), `${locale} ${item.section}`).not.toBe(key)
        expect(translate(locale, key).trim().length, `${locale} ${item.section}`).toBeGreaterThan(0)
      }
    }
  })

  it('finds descriptions across words and opens the result with Enter', async () => {
    const { input, change } = navigation()
    await userEvent.type(input, 'LOCAL security')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.keyboard('{Enter}')
    expect(change.mock.calls.at(-1)?.[0]).toBe('mcp')
  })

  it('keeps the active section unchanged for no matches and clears with Escape', async () => {
    const { input, change } = navigation()
    const escaped = vi.fn()
    document.addEventListener('keydown', escaped)
    try {
      await userEvent.type(input, 'nothing matches')
      expect(screen.getByRole('status')).toHaveTextContent('No matching sections')
      await userEvent.keyboard('{Enter}')
      expect(change).not.toHaveBeenCalled()
      escaped.mockClear()
      await userEvent.keyboard('{Escape}')
      expect(input).toHaveValue('')
      expect(screen.getAllByRole('button')).toHaveLength(4)
      expect(escaped).not.toHaveBeenCalled()
      await userEvent.keyboard('{Escape}')
      expect(escaped).toHaveBeenCalledOnce()
    } finally {
      document.removeEventListener('keydown', escaped)
    }
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'preserves the query and section during IME key events: %j', async (composition) => {
      const { input, change } = navigation()
      await userEvent.type(input, 'security')
      await fireEvent.keyDown(input, { key: 'Enter', ...composition })
      expect(change).not.toHaveBeenCalled()
      await fireEvent.keyDown(input, { key: 'Escape', ...composition })
      expect(input).toHaveValue('security')
      expect(screen.getAllByRole('button')).toHaveLength(1)

      await fireEvent.keyDown(input, { key: 'Enter' })
      expect(change.mock.calls.at(-1)?.[0]).toBe('mcp')
      await fireEvent.keyDown(input, { key: 'Escape' })
      expect(input).toHaveValue('')
    }
  )
})
