import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CredentialPicker from '../../src/renderer/src/components/CredentialPicker.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { CredentialSummary } from '../../src/shared/types.js'

function credential(id: string, username: string): CredentialSummary {
  return {
    id,
    origin: 'https://example.test',
    username,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z'
  }
}

describe('CredentialPicker', () => {
  it('returns focus to its invoking control after close', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const view = render(CredentialPicker, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: false,
        credentials: [credential('alice', 'Alice')],
        origin: 'https://example.test',
        fillCredential: vi.fn()
      }
    })

    await view.rerender({ open: true })
    await screen.findByRole('dialog', { name: 'Choose an account' })
    screen.getByRole('combobox', { name: 'Search saved accounts' }).focus()
    await view.rerender({ open: false })

    await vi.waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
  })

  it('owns accessible filtering and delegates the selected credential', async () => {
    const fillCredential = vi.fn(async () => undefined)
    const view = render(CredentialPicker, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        credentials: [credential('alice', 'Alice'), credential('bob', 'Bob')],
        origin: 'https://example.test',
        fillCredential
      }
    })
    const user = userEvent.setup()
    const search = screen.getByRole('combobox', { name: 'Search saved accounts' })

    expect(screen.getByRole('dialog', { name: 'Choose an account' })).toBeVisible()
    await user.type(search, 'bob')
    expect(screen.getByRole('option', { name: /Bob/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(fillCredential).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob' })))
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('ignores pointer selection caused by a live credential-list reflow', async () => {
    let now = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const bob = credential('bob', 'Bob')
    const view = render(CredentialPicker, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        credentials: [credential('alice', 'Alice'), bob],
        origin: 'https://example.test',
        fillCredential: vi.fn()
      }
    })
    const bobOption = screen.getByRole('option', { name: /Bob/ })

    await fireEvent.pointerMove(bobOption, { clientX: 40, clientY: 80 })
    expect(bobOption).toHaveAttribute('aria-selected', 'true')
    await view.rerender({ credentials: [credential('carol', 'Carol'), credential('alice', 'Alice'), bob] })
    const carolOption = screen.getByRole('option', { name: /Carol/ })
    await fireEvent.pointerMove(carolOption, { clientX: 42, clientY: 40 })
    expect(bobOption).toHaveAttribute('aria-selected', 'true')
    now += 151
    await fireEvent.pointerMove(carolOption, { clientX: 43, clientY: 40 })
    expect(carolOption).toHaveAttribute('aria-selected', 'true')
    nowSpy.mockRestore()
  })

  it('accepts the first pointer move after opening over recently loaded credentials', async () => {
    const now = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const view = render(CredentialPicker, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: false,
        credentials: [],
        origin: 'https://example.test',
        fillCredential: vi.fn()
      }
    })

    await view.rerender({ credentials: [credential('alice', 'Alice'), credential('bob', 'Bob')] })
    await view.rerender({ open: true })
    const bobOption = screen.getByRole('option', { name: /Bob/ })
    await fireEvent.pointerMove(bobOption, { clientX: 40, clientY: 80 })

    expect(bobOption).toHaveAttribute('aria-selected', 'true')
    nowSpy.mockRestore()
  })
})
