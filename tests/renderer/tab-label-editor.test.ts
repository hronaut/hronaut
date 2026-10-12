import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TabLabelEditor from '../../src/renderer/src/components/TabLabelEditor.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

const original = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => { if (original) Object.defineProperty(window, 'hronaut', original); else Reflect.deleteProperty(window, 'hronaut') })
const tab = { id: 'tab-a', title: 'Real page title', url: 'https://example.test/', label: 'Saved role' } as BrowserTabState
const state = {} as BrowserState
function setup(save = vi.fn(async () => ({ state, status: 'saved' as const })), mounted?: () => void) {
  Object.defineProperty(window, 'hronaut', { configurable: true, value: { setTabLabel: save } })
  const view = render(TabLabelEditor, { props: { tab }, global: { plugins: [createHronautI18n('en-US')], mixins: [{ mounted() { mounted?.() } }] } })
  return { view, save, user: userEvent.setup() }
}

describe('tab label editor', () => {
  it('edits by UUID, focuses the input, and clears with an explicit empty label', async () => {
    const { user, save } = setup()
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    expect(screen.getByRole('textbox', { name: 'Tab label' })).toHaveFocus()
    await user.clear(screen.getByRole('textbox', { name: 'Tab label' }))
    await user.type(screen.getByRole('textbox', { name: 'Tab label' }), 'Customer task')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledWith('tab-a', 'Customer task')
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.click(screen.getByRole('button', { name: 'Clear label' }))
    expect(save).toHaveBeenLastCalledWith('tab-a', '')
  })
  it.each(['original', 'search', 'other editor', 'search then body'] as const)('keeps delayed save focus with %s ownership', async (owner) => {
    let finish!: (value: { state: BrowserState; status: 'saved' }) => void
    const { user, view } = setup(vi.fn(() => new Promise(resolve => { finish = resolve })))
    const search = document.createElement('input')
    search.type = 'search'
    search.setAttribute('aria-label', 'Search tabs')
    view.container.append(search)
    const other = render(TabLabelEditor, { props: { tab: { ...tab, id: 'tab-b', label: 'Other role' } }, global: { plugins: [createHronautI18n('en-US')] } })
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.click(within(view.container as HTMLElement).getByRole('button', { name: 'Save' }))
    let expected: Element | null = null
    if (owner === 'search' || owner === 'search then body') {
      await user.click(search)
      if (owner === 'search then body') search.blur()
      expected = document.activeElement
    } else if (owner === 'other editor') {
      await user.click(screen.getByRole('button', { name: 'Edit label for Other role' }))
      expected = within(other.container as HTMLElement).getByRole('textbox', { name: 'Tab label' })
    }
    finish({ state, status: 'saved' })
    const trigger = await within(view.container as HTMLElement).findByRole('button', { name: 'Edit label for Saved role' })
    await vi.waitFor(() => expect(trigger).toBeEnabled())
    expect(document.activeElement).toBe(owner === 'original' ? trigger : expected)
  })
  it('preserves newer focus acquired while the successful editor closes', async () => {
    let finish!: (value: { state: BrowserState; status: 'saved' }) => void
    const search = document.createElement('input')
    let transferOnMount = false
    let transferred = false
    const { user, view } = setup(vi.fn(() => new Promise(resolve => { finish = resolve })), () => {
      // Vue invokes this restored-button mount hook before close's nextTick
      // continuation, reproducing another control acquiring focus in that gap.
      if (transferOnMount) { search.focus(); transferred = true }
    })
    view.container.append(search)
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    transferOnMount = true
    finish({ state, status: 'saved' })
    await within(view.container as HTMLElement).findByRole('button', { name: 'Edit label for Saved role' })
    expect(transferred).toBe(true)
    expect(search).toHaveFocus()
  })
  it('does not restore focus after the saving row unmounts', async () => {
    let finish!: (value: { state: BrowserState; status: 'saved' }) => void
    const { user, view } = setup(vi.fn(() => new Promise(resolve => { finish = resolve })))
    const search = document.createElement('input')
    document.body.append(search)
    try {
      await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      view.unmount()
      search.focus()
      finish({ state, status: 'saved' })
      await Promise.resolve()
      expect(search).toHaveFocus()
    } finally { search.remove() }
  })
  it('keeps rejected edits visible and leaves the committed label untouched', async () => {
    const { user, save } = setup(vi.fn().mockRejectedValue(new Error('storage unavailable')))
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.clear(screen.getByRole('textbox', { name: 'Tab label' }))
    await user.type(screen.getByRole('textbox', { name: 'Tab label' }), 'Rejected task')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Label was not saved')
    expect(screen.getByRole('textbox')).toHaveValue('Rejected task')
    expect(tab.label).toBe('Saved role')
    expect(save).toHaveBeenCalledOnce()
  })
  it('ignores a canceled completion and preserves the next draft', async () => {
    let finish!: (value: { state: BrowserState; status: 'saved' }) => void
    const { user } = setup(vi.fn(() => new Promise(resolve => { finish = resolve })))
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    finish({ state, status: 'saved' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit label for Saved role' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'New draft')
    expect(screen.getByRole('textbox')).toHaveValue('New draft')
  })
  it('reports unconfirmed durability and preserves a warning when the editor is closed', async () => {
    const { user, view } = setup(vi.fn().mockResolvedValue({ state, status: 'durability-unconfirmed' }))
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('disk durability could not be confirmed')
    await view.rerender({ tab: { ...tab, labelDurabilityUnconfirmed: true } })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alert')).toHaveTextContent('disk durability could not be confirmed')
  })
  it('rejects oversized labels without calling main and supports Escape cancellation', async () => {
    const { user, save } = setup()
    await user.click(screen.getByRole('button', { name: 'Edit label for Saved role' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'x'.repeat(101))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('at most 100')
    expect(save).not.toHaveBeenCalled()
    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit label for Saved role' })).toHaveFocus()
  })
})
