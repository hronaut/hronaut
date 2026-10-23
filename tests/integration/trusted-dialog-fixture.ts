import type { Locator, Page } from '@playwright/test'
import { expect } from './fixtures.js'

/**
 * Hronaut's own dialog that main asks through the shell, such as a website's permission request. It replaced the system
 * dialog these tests used to answer by replacing `dialog.showMessageBox` in main; they now answer the real dialog.
 */
export function trustedDialog(window: Page): Locator {
  return window.getByTestId('trusted-dialog')
}

/** The dialog's headline, as the person reads it. */
export async function trustedDialogHeadline(window: Page): Promise<string> {
  return (await trustedDialog(window).locator('h2').innerText()).trim()
}

/** The id of the request the dialog shows now; it changes when the next queued request replaces it. */
export async function trustedDialogRequestId(window: Page): Promise<string> {
  await expect(trustedDialog(window)).toBeVisible()
  return (await trustedDialog(window).getAttribute('data-request-id')) ?? ''
}

/** Clicks one of the dialog's buttons once it takes answers; a dialog that just appeared ignores clicks for a moment. */
export async function answerTrustedDialog(window: Page, button: string): Promise<void> {
  const dialog = trustedDialog(window)
  await expect(dialog).toHaveAttribute('data-armed', 'true')
  await dialog.locator('.ui-dialog__footer').getByRole('button', { name: button, exact: true }).click()
}

interface TrustedDialogAnswerer {
  prompts: string[]
  observer?: MutationObserver
}

/**
 * Answers every dialog the shell shows from now on with the button labeled `button`, and records each one's headline,
 * for tests about what happens after the person answers rather than about the dialog itself.
 */
export async function answerEveryTrustedDialog(window: Page, button: string): Promise<void> {
  await window.evaluate((label) => {
    const globals = globalThis as typeof globalThis & { __trustedDialogAnswerer?: TrustedDialogAnswerer }
    globals.__trustedDialogAnswerer?.observer?.disconnect()
    const answerer: TrustedDialogAnswerer = { prompts: [] }
    globals.__trustedDialogAnswerer = answerer
    const answered = new Set<string>()
    const answer = (): void => {
      const dialog = document.querySelector('[data-testid="trusted-dialog"][data-armed="true"]')
      const id = dialog?.getAttribute('data-request-id')
      if (!dialog || !id || answered.has(id)) return
      const target = [...dialog.querySelectorAll<HTMLButtonElement>('button[data-response]')]
        .find((candidate) => candidate.textContent?.trim() === label)
      if (!target) return
      answered.add(id)
      answerer.prompts.push(dialog.querySelector('h2')?.textContent?.trim() ?? '')
      target.click()
    }
    answerer.observer = new MutationObserver(answer)
    answerer.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-armed', 'data-request-id'] })
    answer()
  }, button)
}

/** The headlines of the dialogs `answerEveryTrustedDialog` answered, in order. */
export async function answeredTrustedDialogs(window: Page): Promise<string[]> {
  return window.evaluate(() => [
    ...((globalThis as typeof globalThis & { __trustedDialogAnswerer?: TrustedDialogAnswerer }).__trustedDialogAnswerer?.prompts ?? [])
  ])
}
