// @vitest-environment jsdom
import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import WalletsSettingsPanel from '../../src/renderer/src/components/WalletsSettingsPanel.vue'
import type { WalletsController } from '../../src/renderer/src/composables/useWalletsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

const global = { plugins: [createHronautI18n('en-US')] }

function controller(overrides: Partial<WalletsController> = {}): WalletsController {
  return {
    status: ref({ managedWallets: 'ready', backend: 'safe-storage', watchOnlyAvailable: true, reason: 'secure' }),
    wallets: ref([]),
    policies: ref([]),
    permissions: ref([]),
    requests: ref([]),
    audit: ref([]),
    awaitingApproval: ref([]),
    busy: ref(false),
    errorMessage: ref(''),
    initialize: vi.fn(async () => undefined),
    refreshDetails: vi.fn(async () => undefined),
    setupPassphrase: vi.fn(async () => undefined),
    unlock: vi.fn(async () => undefined),
    lock: vi.fn(async () => undefined),
    generate: vi.fn(async () => undefined),
    prepareImport: vi.fn(async () => ({ token: 'import-token', publicAddress: '0x1234' })),
    confirmImport: vi.fn(async () => undefined),
    cancelImport: vi.fn(async () => undefined),
    addWatchOnly: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    setPolicy: vi.fn(async () => undefined),
    removePolicy: vi.fn(async () => undefined),
    revokePermission: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides
  } as WalletsController
}

describe('WalletsSettingsPanel', () => {
  it('presents secure-storage state in human language instead of internal enum values', () => {
    const wallets = controller({
      status: ref({
        managedWallets: 'passphrase-setup-required',
        backend: 'basic_text',
        watchOnlyAvailable: true
      })
    })
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })

    const status = screen.getByText(/managed wallets need a vault passphrase/i)
    expect(status).toHaveTextContent(/operating-system secret store unavailable/i)
    expect(status).not.toHaveTextContent(/passphrase-setup-required|basic_text/i)
  })

  it('disables watch-only onboarding when wallet persistence fails integrity checks', async () => {
    const wallets = controller({
      status: ref({
        managedWallets: 'disabled',
        backend: 'integrity-failure',
        watchOnlyAvailable: false,
        reason: 'Wallet data failed integrity checks. Wallet operations are disabled.'
      })
    })
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Watch only' }))

    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeDisabled()
  })

  it('clears imported secret material from the uncontrolled trusted input immediately', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.type(screen.getByLabelText('Name'), 'Imported wallet')
    const recovery = screen.getByLabelText<HTMLTextAreaElement>('Recovery material')
    await user.type(recovery, 'test secret phrase never retained in Vue state')
    await user.click(screen.getByRole('button', { name: 'Validate wallet secret' }))

    expect(recovery.value).toBe('')
    expect(wallets.prepareImport).toHaveBeenCalledWith('evm', 'mnemonic', 'test secret phrase never retained in Vue state')
    expect(await screen.findByText('0x1234')).toBeVisible()
  })

  it('creates an explicitly designated agent wallet without weakening approval controls', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, {
      props: { controller: wallets, workspaces: [{ id: 'workspace-1', name: 'Agent workspace' }] },
      global
    })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'QA agent wallet')
    await user.click(screen.getByLabelText('Dedicated agent wallet'))
    await user.click(screen.getByLabelText('Agent workspace'))
    await user.click(screen.getByRole('button', { name: 'Add wallet' }))

    expect(wallets.generate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'QA agent wallet',
      dedicatedAgent: true,
      workspaceIds: ['workspace-1']
    }))
    expect(screen.getByText(/mainnet always requires you/i)).toBeVisible()
  })
})
