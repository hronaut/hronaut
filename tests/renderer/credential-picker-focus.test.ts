import { flushPromises } from '@vue/test-utils'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CredentialPicker from '../../src/renderer/src/features/credentials/CredentialPicker.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { CredentialSummary } from '../../src/shared/types.js'

function account(id: string, origin = 'https://example.test'): CredentialSummary {
  return { id, username: id, origin, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' }
}

async function setup() {
  const fillCredential = vi.fn()
  const view = render(CredentialPicker, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { open: true, origin: 'https://example.test', credentials: [account('Alice'), account('Bob')], fillCredential }
  })
  await flushPromises()
  return { view, fillCredential }
}

const search = () => screen.getByRole('combobox', { name: 'Search saved accounts' })
const close = () => screen.getByRole('button', { name: 'Close account chooser' })
const bob = () => screen.getByRole('option', { name: /Bob/ })

describe('account chooser retained focus', () => {
  for (const [control, target] of [['Close', close], ['search', search], ['account', bob]] as const) {
    it.each(['unchanged', 'unrelated', 'reordered', 'other-removed'] as const)(`preserves ${control} focus after %s metadata`, async change => {
      const { view, fillCredential } = await setup()
      const focused = target()
      focused.focus()
      expect(focused).toHaveFocus()
      const credentials = change === 'reordered' ? [account('Bob'), account('Alice')]
        : change === 'other-removed' ? [account('Bob')]
        : [account('Alice'), account('Bob'), ...(change === 'unrelated' ? [account('Other', 'https://other.test')] : [])]
      await view.rerender({ credentials })
      await flushPromises()
      expect(focused).toHaveFocus()
      expect(fillCredential).not.toHaveBeenCalled()
    })
  }

  it('recovers search when the focused account is removed, including the last account', async () => {
    const { view, fillCredential } = await setup()
    bob().focus()
    await view.rerender({ credentials: [account('Alice')] })
    await flushPromises()
    expect(search()).toHaveFocus()
    screen.getByRole('option', { name: /Alice/ }).focus()
    await view.rerender({ credentials: [] })
    await flushPromises()
    expect(search()).toHaveFocus()
    expect(search()).not.toHaveAttribute('aria-activedescendant')
    expect(fillCredential).not.toHaveBeenCalled()
  })

  it('keeps search filtering and arrow selection after broadcasts without filling', async () => {
    const { view, fillCredential } = await setup()
    const user = userEvent.setup()
    await user.type(search(), 'bOb example')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await flushPromises()
    expect(search()).toHaveFocus()
    await view.rerender({ credentials: [account('Carol'), account('Bob'), account('Alice')] })
    await flushPromises()
    expect(search()).toHaveFocus()
    expect(search()).toHaveAttribute('aria-activedescendant', 'credential-option-Bob')
    await user.clear(search())
    await user.keyboard('{ArrowDown}')
    expect(bob()).toHaveAttribute('aria-selected', 'true')
    expect(fillCredential).not.toHaveBeenCalled()
  })

  it('keeps keyboard Close activation attached to Close after a broadcast', async () => {
    const { view, fillCredential } = await setup()
    const user = userEvent.setup()
    close().focus()
    await view.rerender({ credentials: [account('Alice'), account('Bob')] })
    await flushPromises()
    await user.keyboard('{Enter}')
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    expect(fillCredential).not.toHaveBeenCalled()
  })
})
