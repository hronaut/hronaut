import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CredentialImportCard from '../../src/renderer/src/features/credentials/CredentialImportCard.vue'
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

  it('shows a main-process import failure without Electron\'s IPC wrapper', async () => {
    const importFromCsv = vi.fn().mockRejectedValueOnce(new Error("Error invoking remote method 'credentials:import-csv': Error: The CSV must contain url, username, and password columns."))
    renderCard(importFromCsv)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose browser CSV…' }))

    expect(await screen.findByText('The CSV must contain url, username, and password columns.')).toBeVisible()
    expect(document.body).not.toHaveTextContent('Error invoking remote method')
  })
})

describe('CredentialImportCard focus after an import', () => {
  // JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  // The import button was disabled while the native file chooser and import ran, so Chromium moved its focus to the
  // document body, and nothing gave it back once the import finished or was canceled.
  it.each([
    ['finishes', { canceled: false, added: 1, updated: 0, skipped: 0 }],
    ['is canceled', { canceled: true, added: 0, updated: 0, skipped: 0 }]
  ] as const)('gives the focus back to the import button once the import %s', async (_outcome, result) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let finish!: (value: CredentialImportResult) => void
    const view = renderCard(() => new Promise((resolve) => { finish = resolve }))
    try {
      const button = screen.getByRole('button', { name: 'Choose browser CSV…' })
      await userEvent.setup().click(button)
      expect(button).toBeDisabled()
      dropFocusLikeChromium(button)
      finish(result)
      await vi.waitFor(() => expect(button).toBeEnabled())
      await vi.waitFor(() => expect(button).toHaveFocus())
    } finally {
      view.unmount()
      vi.restoreAllMocks()
    }
  })

  it('leaves the focus alone while Hronaut is in the background', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    let finish!: (value: CredentialImportResult) => void
    const view = renderCard(() => new Promise((resolve) => { finish = resolve }))
    try {
      const button = screen.getByRole('button', { name: 'Choose browser CSV…' })
      await userEvent.setup().click(button)
      dropFocusLikeChromium(button)
      finish({ canceled: true, added: 0, updated: 0, skipped: 0 })
      await vi.waitFor(() => expect(button).toBeEnabled())
      expect(document.body).toHaveFocus()
    } finally {
      view.unmount()
      vi.restoreAllMocks()
    }
  })
})
