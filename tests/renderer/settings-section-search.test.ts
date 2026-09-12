import { defineComponent } from 'vue'
import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsNavigation from '../../src/renderer/src/components/SettingsNavigation.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

const icon = defineComponent({ template: '<svg />' })
function navigation() {
  const change = vi.fn()
  render(SettingsNavigation, {
    props: {
      modelValue: 'appearance',
      'onUpdate:modelValue': change,
      items: [
        { section: 'appearance', label: 'Appearance', description: 'Theme and window', icon },
        { section: 'mcp', label: 'MCP security', description: 'Local authentication', icon },
        { section: 'downloads', label: 'Downloads', description: 'Location and prompts', icon }
      ]
    },
    global: { plugins: [createHronautI18n('en-US')] }
  })
  return { change, input: screen.getByRole('searchbox', { name: 'Find a section…' }) }
}

describe('settings section search', () => {
  it('finds descriptions across words and opens the result with Enter', async () => {
    const { input, change } = navigation()
    await userEvent.type(input, 'LOCAL security')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.keyboard('{Enter}')
    expect(change).toHaveBeenCalledWith('mcp')
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

  it('does not select a section while an IME is composing', async () => {
    const { input, change } = navigation()
    await fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(change).not.toHaveBeenCalled()
  })
})
