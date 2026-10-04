import { defineComponent, ref, watch } from 'vue'
import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsNavigation from '../../src/renderer/src/components/SettingsNavigation.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

import { useSettingsSectionSearch } from '../../src/renderer/src/composables/useSettingsSectionSearch.js'
import type { SettingsSection } from '../../src/renderer/src/composables/useSettingsDialogController.js'

const icon = defineComponent({ template: '<svg />' })
function navigation() {
  const change = vi.fn()
  const Harness = defineComponent({
    components: { SettingsNavigation },
    setup() {
      const section = ref<SettingsSection>('appearance')
      watch(section, change)
      const items = ref([
        { section: 'appearance' as const, label: 'Appearance', description: 'Theme and window', icon },
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
      expect(screen.getAllByRole('button')).toHaveLength(3)
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
