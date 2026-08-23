import type { UpdateStatus } from './types.js'

export const UPDATE_STATUS_DISMISS_MS = 5_000

export function shouldShowUpdateStatusPill(status: UpdateStatus): boolean {
  return status !== 'idle'
}

export function shouldAutoDismissUpdateStatus(status: UpdateStatus): boolean {
  return status === 'up-to-date'
}

interface ShellHeightOptions {
  shellHeight: number
  viewportHeight: number
  modalOpen: boolean
}

export function shellHeightForBrowserContent(options: ShellHeightOptions): number {
  if (options.modalOpen) return Math.ceil(options.viewportHeight)
  return Math.ceil(options.shellHeight)
}
