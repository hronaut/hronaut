import type { IpcMain, IpcMainEvent } from 'electron'
import type { AddressSuggestionOverlay } from './windows/address-suggestion-overlay.js'
import type {
  AddressSuggestion,
  AddressSuggestionOverlayRequest,
  AddressSuggestionSelection
} from '../shared/address-suggestions.js'
import { ADDRESS_SUGGESTION_TITLE_MAX_LENGTH, ADDRESS_SUGGESTION_URL_MAX_LENGTH, hasSwitchToTabButton } from '../shared/address-suggestions.js'
import { isResolvedThemeName } from '../shared/theme.js'

interface AddressOverlayIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainEvent): void
  /** Why saved workspaces could not start, if they could not; read on every message. */
  workspaceStartupFailure(): Error | undefined
  /** The suggestions view and its state, which the main window's closing resets too. */
  addressOverlay(): Pick<AddressSuggestionOverlay, 'isAddressOverlaySender' | 'show' | 'hide' | 'measured' | 'select' | 'returnFocus'>
}

function validAddressSuggestion(value: unknown): value is AddressSuggestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const suggestion = value as Record<string, unknown>
  return (
    typeof suggestion.id === 'string'
    && suggestion.id.length > 0
    && suggestion.id.length <= 512
    && (suggestion.kind === 'bookmark' || suggestion.kind === 'history' || suggestion.kind === 'tab')
    && typeof suggestion.title === 'string'
    && suggestion.title.length <= ADDRESS_SUGGESTION_TITLE_MAX_LENGTH
    && typeof suggestion.url === 'string'
    && suggestion.url.length > 0
    && suggestion.url.length <= ADDRESS_SUGGESTION_URL_MAX_LENGTH
    && (
      suggestion.visitCount === undefined
      || (typeof suggestion.visitCount === 'number' && Number.isFinite(suggestion.visitCount) && suggestion.visitCount >= 0)
    )
    // An open tab's row always names its tab.
    && (suggestion.openTabId === undefined ? suggestion.kind !== 'tab' : (
      typeof suggestion.openTabId === 'string' && suggestion.openTabId.length > 0 && suggestion.openTabId.length <= 512
    ))
  )
}

function validatedAddressOverlayRequest(value: unknown): AddressSuggestionOverlayRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid address overlay request')
  const request = value as Record<string, unknown>
  if (typeof request.sessionId !== 'number' || !Number.isSafeInteger(request.sessionId) || request.sessionId < 1) {
    throw new TypeError('Invalid address overlay session')
  }
  const bounds = request.bounds
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) throw new TypeError('Invalid address overlay bounds')
  const rawBounds = bounds as Record<string, unknown>
  if (
    ![rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.maxHeight].every((metric) => (
      typeof metric === 'number' && Number.isFinite(metric)
    ))
    || (rawBounds.x as number) < 0
    || (rawBounds.y as number) < 0
    || (rawBounds.width as number) <= 0
    || (rawBounds.maxHeight as number) <= 0
    || (rawBounds.width as number) > 10_000
    || (rawBounds.maxHeight as number) > 10_000
  ) {
    throw new TypeError('Invalid address overlay bounds')
  }
  if (
    !Array.isArray(request.suggestions)
    || request.suggestions.length < 1
    || request.suggestions.length > 20
    || !request.suggestions.every(validAddressSuggestion)
  ) {
    throw new TypeError('Invalid address overlay suggestions')
  }
  if (
    typeof request.selectedIndex !== 'number'
    || !Number.isInteger(request.selectedIndex)
    || request.selectedIndex < -1
    || request.selectedIndex >= request.suggestions.length
  ) {
    throw new TypeError('Invalid address overlay selection')
  }
  // Only a highlighted bookmark or visit open in another tab has a Switch to this tab button for Tab to go on to.
  if (request.selectedAction !== undefined && (
    request.selectedAction !== 'switch-tab'
    || !hasSwitchToTabButton((request.suggestions as AddressSuggestion[])[request.selectedIndex])
  )) {
    throw new TypeError('Invalid address overlay selection')
  }
  if (!isResolvedThemeName(request.theme)) {
    throw new TypeError('Invalid address overlay theme')
  }
  return request as unknown as AddressSuggestionOverlayRequest
}

/**
 * The shell's requests to show and hide the address field's suggestions, and the suggestions page's own reports.
 * Each message is checked against its sender and validated here before the overlay acts on it; a report from a
 * suggestions view that is no longer the current one is dropped. Dependencies stay lazy because handlers are
 * registered before the window loads.
 */
export function registerAddressOverlayIpc(ipcMain: Pick<IpcMain, 'on'>, host: AddressOverlayIpcHost): void {
  ipcMain.on('address-overlay:show', (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    const request = validatedAddressOverlayRequest(value)
    host.addressOverlay().show(request, event.sender)
  })
  ipcMain.on('address-overlay:hide', (event) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    host.addressOverlay().hide()
  })
  ipcMain.on('address-overlay:return-focus', (event) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    host.addressOverlay().returnFocus()
  })
  ipcMain.on('address-overlay:measured', (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    if (!host.addressOverlay().isAddressOverlaySender(event)) return
    host.addressOverlay().measured(value, event.sender)
  })
  ipcMain.on('address-overlay:select', (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    if (!host.addressOverlay().isAddressOverlaySender(event)) return
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid address suggestion selection')
    }
    const selection = value as AddressSuggestionSelection
    if (!Number.isSafeInteger(selection.sessionId) || selection.sessionId < 1
      || typeof selection.suggestionId !== 'string' || selection.suggestionId.length < 1 || selection.suggestionId.length > 512
      || (selection.disposition !== undefined && selection.disposition !== 'new-background-tab')
      || (selection.action !== undefined && (selection.action !== 'switch-tab' || selection.disposition !== undefined))) {
      throw new TypeError('Invalid address suggestion selection')
    }
    // Only the known fields go on to the shell.
    const { sessionId, suggestionId, disposition, action } = selection
    host.addressOverlay().select(disposition ? { sessionId, suggestionId, disposition } : action ? { sessionId, suggestionId, action } : { sessionId, suggestionId })
  })
}
