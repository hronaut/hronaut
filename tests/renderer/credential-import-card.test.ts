import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CredentialImportCard from '../../src/renderer/src/components/CredentialImportCard.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { CredentialImportResult } from '../../src/shared/types.js'

function renderCard(importFromCsv: () => Promise<CredentialImportResult>) {
  return render(CredentialImportCard, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { importFromCsv }
  })
}

describe('CredentialImportCard', () => {
  it('reports only import counts after the native main-process flow succeeds', async () => {
    const importFromCsv = vi.fn(async () => ({ canceled: false, added: 3, updated: 2, skipped: 1 }))
    renderCard(importFromCsv)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose browser CSV…' }))

    expect(importFromCsv).toHaveBeenCalledOnce()
    expect(screen.getByText('Imported 3 new and updated 2; skipped 1.')).toBeVisible()
    expect(document.body).not.toHaveTextContent('secret')
  })

  it('returns to idle without claiming success when native selection is canceled', async () => {
    const importFromCsv = vi.fn(async () => ({ canceled: true, added: 0, updated: 0, skipped: 0 }))
    renderCard(importFromCsv)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose browser CSV…' }))

    expect(screen.getByRole('button', { name: 'Choose browser CSV…' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Imported/)).not.toBeInTheDocument()
  })

  it('surfaces sanitized import errors and permits retry', async () => {
    const importFromCsv = vi.fn()
      .mockRejectedValueOnce(new Error('The CSV must contain url, username, and password columns.'))
      .mockResolvedValueOnce({ canceled: false, added: 1, updated: 0, skipped: 0 })
    renderCard(importFromCsv)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Choose browser CSV…' }))
    expect(await screen.findByText('The CSV must contain url, username, and password columns.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Choose browser CSV…' }))
    expect(await screen.findByText('Imported 1 new and updated 0; skipped 0.')).toBeVisible()
    expect(importFromCsv).toHaveBeenCalledTimes(2)
  })
})
