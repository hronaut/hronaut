import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import WalletsSettingsPanel from '../../src/renderer/src/features/wallets/WalletsSettingsPanel.vue'
import type { WalletsController } from '../../src/renderer/src/features/wallets/useWalletsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { localeMessages } from '../../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import { WALLET_DISABLED_REASONS, type WalletServiceStatus } from '../../src/shared/wallet.js'

// Settings > Wallets named why managed wallets were disabled in English after a translated status, such as
// "Verwaltete Wallets sind deaktiviert. … Wallet data failed integrity checks. Wallet operations are disabled."

function showStatus(status: WalletServiceStatus): void {
  const noop = vi.fn(async () => undefined)
  const controller = {
    status: ref(status), wallets: ref([]), policies: ref([]), permissions: ref([]), requests: ref([]), audit: ref([]), awaitingApproval: ref([]),
    busy: ref(false), errorMessage: ref(''), initialize: noop, refreshDetails: noop, dispose: vi.fn()
  } as unknown as WalletsController
  render(WalletsSettingsPanel, { props: { controller, workspaces: [] }, global: { plugins: [createHronautI18n('de-DE')] } })
}

it('names a failed integrity check in German', () => {
  showStatus({ managedWallets: 'disabled', backend: 'integrity-failure', watchOnlyAvailable: false, reason: WALLET_DISABLED_REASONS.integrityFailure })
  const status = screen.getByText(/Verwaltete Wallets sind deaktiviert/)
  expect(status).toHaveTextContent('Die Wallet-Daten haben die Integritätsprüfung nicht bestanden. Wallet-Vorgänge sind deaktiviert.')
  expect(status).not.toHaveTextContent('integrity checks')
  // The backend sentence would wrongly say no secure backend is available.
  expect(status).not.toHaveTextContent('Kein sicheres Backend')
})

it('names a vault that operating-system secure storage could not unlock in German', () => {
  showStatus({ managedWallets: 'disabled', backend: 'secure-storage-failure', watchOnlyAvailable: false, reason: WALLET_DISABLED_REASONS.unlockFailure })
  expect(screen.getByText(/Verwaltete Wallets sind deaktiviert/)).toHaveTextContent('Der Wallet-Tresor konnte nicht mit dem sicheren Speicher des Betriebssystems entsperrt werden.')
})

it('says wallets are starting without an English reason before main answers', () => {
  showStatus({ managedWallets: 'disabled', backend: 'initializing', watchOnlyAvailable: false })
  expect(screen.getByText(/Verwaltete Wallets sind deaktiviert/)).toHaveTextContent('Verwaltete Wallets sind deaktiviert. Wallet-Sicherheit wird gestartet.')
})

it('shows a reason it does not know as it came', () => {
  showStatus({ managedWallets: 'disabled', backend: 'unavailable', watchOnlyAvailable: true, reason: 'Disabled by policy' })
  expect(screen.getByText(/Verwaltete Wallets sind deaktiviert/)).toHaveTextContent('Disabled by policy')
})

it('has every reason in every language', () => {
  for (const locale of SUPPORTED_LOCALES) {
    expect(Object.keys(localeMessages[locale].wallets.disabledReasons)).toEqual(Object.keys(WALLET_DISABLED_REASONS))
  }
})
