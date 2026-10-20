import type { ElectronApplication } from '@playwright/test'

export interface AskedConfirmation {
  message: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}

/**
 * Answers every native message box main shows from now on, as choosing OK or Cancel would, and records what each one
 * asked. Hronaut's own confirmations are native dialogs, which Playwright cannot press; each test gets its own app, so
 * nothing needs restoring.
 */
export async function answerConfirmations(app: ElectronApplication, answer: 'ok' | 'cancel'): Promise<() => Promise<AskedConfirmation[]>> {
  await app.evaluate(({ dialog }, answer) => {
    const scope = globalThis as typeof globalThis & { __askedConfirmations?: AskedConfirmation[] }
    scope.__askedConfirmations = []
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      writable: true,
      value: async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.MessageBoxOptions
        scope.__askedConfirmations!.push({ message: options.message, buttons: options.buttons ?? [], defaultId: options.defaultId, cancelId: options.cancelId })
        return { response: answer === 'ok' ? 1 : 0, checkboxChecked: false }
      }
    })
  }, answer)
  return () => app.evaluate(() => (globalThis as typeof globalThis & { __askedConfirmations?: AskedConfirmation[] }).__askedConfirmations ?? [])
}
