// @vitest-environment jsdom
import { ref } from 'vue'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import WalletsSettingsPanel from '../../src/renderer/src/components/WalletsSettingsPanel.vue'
import type { WalletsController } from '../../src/renderer/src/composables/useWalletsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { WalletDescriptor } from '../../src/shared/wallet.js'

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

function wallet(id: string, name: string, workspaceIds: string[]): WalletDescriptor {
  return {
    id,
    name,
    kind: 'watch-only',
    chainFamily: 'evm',
    publicAddress: `0x${id.padEnd(40, '0').slice(0, 40)}`,
    network: { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'https://11155111.rpc.thirdweb.com' },
    capabilities: ['read'],
    workspaceIds,
    policyIds: [],
    recoveryConfirmed: true,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
  }
}

describe('WalletsSettingsPanel', () => {
  it('starts with a coherent EVM preset and keeps custom RPC editing available', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    expect(screen.getByLabelText('Network preset')).toHaveValue('evm-11155111')
    expect(screen.getByLabelText('EVM chain ID')).toHaveValue('11155111')
    expect(screen.getByLabelText('JSON-RPC URL')).not.toHaveValue('http://127.0.0.1:8545')

    await user.selectOptions(screen.getByLabelText('Network preset'), 'custom')
    await user.clear(screen.getByLabelText('Network name'))
    await user.type(screen.getByLabelText('Network name'), 'My private chain')
    await user.clear(screen.getByLabelText('EVM chain ID'))
    await user.type(screen.getByLabelText('EVM chain ID'), '31337')
    await user.clear(screen.getByLabelText('JSON-RPC URL'))
    await user.type(screen.getByLabelText('JSON-RPC URL'), 'http://127.0.0.1:8545')

    expect(screen.getByLabelText('Network preset')).toHaveValue('custom')
  })

  it('shows public RPC guidance only for presets that use a public endpoint', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    expect(screen.getByText(/built-in public RPCs are convenient defaults/i)).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Network preset'), 'evm-31337')
    expect(screen.queryByText(/built-in public RPCs are convenient defaults/i)).not.toBeInTheDocument()
  })

  it('explains malformed custom EVM chain IDs and blocks wallet creation', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Name'), 'Invalid EVM wallet')
    await user.selectOptions(screen.getByLabelText('Network preset'), 'custom')
    await user.clear(screen.getByLabelText('EVM chain ID'))
    await user.type(screen.getByLabelText('EVM chain ID'), 'devnet')

    expect(screen.getByLabelText('EVM chain ID')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/positive whole number within the safe integer range/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeDisabled()
    expect(wallets.generate).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only custom network fields before trusted submission', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Name'), 'Whitespace network')
    await user.selectOptions(screen.getByLabelText('Chain'), 'solana')
    await user.selectOptions(screen.getByLabelText('Network preset'), 'custom')
    await user.clear(screen.getByLabelText('Solana cluster'))
    await user.type(screen.getByLabelText('Solana cluster'), '   ')
    await user.clear(screen.getByLabelText('Network name'))
    await user.type(screen.getByLabelText('Network name'), '   ')

    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeDisabled()
  })

  it('normalizes surrounding whitespace before validating an EVM chain ID', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Name'), 'Whitespace EVM')
    await user.selectOptions(screen.getByLabelText('Network preset'), 'custom')
    await user.clear(screen.getByLabelText('EVM chain ID'))
    await user.type(screen.getByLabelText('EVM chain ID'), ' 31337 ')

    expect(screen.getByLabelText('EVM chain ID')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Add wallet' })).toBeEnabled()
  })

  it('adapts network fields and presets to Solana and Tron', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('Chain'), 'solana')
    expect(screen.getByLabelText('Network preset')).toHaveValue('solana-devnet')
    expect(screen.getByLabelText('Solana cluster')).toHaveValue('devnet')
    expect(screen.getByLabelText('Solana RPC endpoint')).toHaveValue('https://api.devnet.solana.com')
    expect(screen.queryByLabelText('EVM chain ID')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Chain'), 'tron')
    expect(screen.getByLabelText('Network preset')).toHaveValue('tron-shasta')
    expect(screen.getByLabelText('TRON network')).toHaveValue('shasta')
    expect(screen.getByLabelText('Full node HTTP URL')).toHaveValue('https://api.shasta.trongrid.io')
    expect(screen.queryByLabelText('Solana cluster')).not.toBeInTheDocument()
  })

  it('submits the exact selected preset network', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Base wallet')
    await user.selectOptions(screen.getByLabelText('Network preset'), 'evm-8453')
    await user.click(screen.getByRole('button', { name: 'Add wallet' }))

    expect(wallets.generate).toHaveBeenCalledWith(expect.objectContaining({
      chainFamily: 'evm',
      network: {
        id: '8453',
        name: 'Base',
        environment: 'mainnet',
        rpcUrl: 'https://mainnet.base.org'
      }
    }))
    expect(screen.getByRole('alert')).toHaveTextContent(/real funds/i)
  })

  it('freezes the validated chain and network until an import is confirmed or cancelled', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.type(screen.getByLabelText('Name'), 'Prepared EVM wallet')
    await user.type(screen.getByLabelText('Mnemonic / recovery phrase'), 'test secret phrase never retained in Vue state')
    await user.click(screen.getByRole('button', { name: 'Validate wallet secret' }))

    expect(screen.getByLabelText('Chain')).toBeDisabled()
    expect(screen.getByLabelText('Network preset')).toBeDisabled()
    expect(screen.getByLabelText('EVM chain ID')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Confirm and encrypt' }))
    expect(wallets.confirmImport).toHaveBeenCalledOnce()
    const [token, details] = vi.mocked(wallets.confirmImport).mock.calls[0]
    expect(token).toBe('import-token')
    expect(details.network.id).toBe('11155111')
  })

  it('keeps new-wallet workspace choices independent from configured-wallet editing', async () => {
    const wallets = controller({
      wallets: ref([
        wallet('a', 'Wallet A', ['workspace-a']),
        wallet('b', 'Wallet B', ['workspace-b'])
      ])
    })
    render(WalletsSettingsPanel, {
      props: {
        controller: wallets,
        workspaces: [
          { id: 'workspace-a', name: 'Workspace A' },
          { id: 'workspace-b', name: 'Workspace B' },
          { id: 'workspace-new', name: 'New wallet workspace' }
        ]
      },
      global
    })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Independent wallet')
    await user.click(screen.getAllByLabelText('New wallet workspace')[0])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Configured wallets' }), 'b')
    await user.click(screen.getByRole('button', { name: 'Add wallet' }))

    expect(wallets.generate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceIds: ['workspace-new']
    }))
  })

  it('lets the user choose which attached workspace receives a bounded policy', async () => {
    const wallets = controller({
      wallets: ref([
        wallet('a', 'Policy wallet', ['workspace-a', 'workspace-b'])
      ])
    })
    render(WalletsSettingsPanel, {
      props: {
        controller: wallets,
        workspaces: [
          { id: 'workspace-a', name: 'Workspace A' },
          { id: 'workspace-b', name: 'Workspace B' }
        ]
      },
      global
    })
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('Policy workspace'), 'workspace-b')
    expect(screen.getByRole('button', { name: 'Add bounded policy' })).toBeDisabled()
    await user.type(screen.getByLabelText('Allowed origin'), 'https://dapp.example')
    await user.type(screen.getByLabelText('Destination / contract'), '0x0000000000000000000000000000000000000001')
    await user.type(screen.getByLabelText('Method / instruction'), 'transfer')
    await user.click(screen.getByRole('button', { name: 'Add bounded policy' }))

    expect(wallets.setPolicy).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'a',
      workspaceId: 'workspace-b'
    }))
  })

  it('renames a configured wallet inline without relying on unsupported prompt dialogs', async () => {
    const wallets = controller({ wallets: ref([wallet('a', 'Old wallet name', [])]) })
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Wallet name')
    expect(input).toHaveValue('Old wallet name')
    await user.clear(input)
    await user.type(input, 'Treasury testnet')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(wallets.update).toHaveBeenCalledWith('a', { name: 'Treasury testnet' })
  })

  it('lets a configured wallet replace a failed RPC endpoint without recreating its identity', async () => {
    const wallets = controller({ wallets: ref([wallet('a', 'RPC wallet', ['workspace-a'])]) })
    render(WalletsSettingsPanel, {
      props: { controller: wallets, workspaces: [{ id: 'workspace-a', name: 'Workspace A' }] },
      global
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Change RPC endpoint' }))
    const endpoint = screen.getAllByLabelText('JSON-RPC URL').at(-1)!
    expect(endpoint).toHaveValue('https://11155111.rpc.thirdweb.com')
    expect(screen.getByText(/cancels pending wallet requests and removes bounded automatic policies/i)).toBeVisible()
    await user.clear(endpoint)
    await user.type(endpoint, 'http://127.0.0.1:9545')
    await user.click(screen.getByRole('button', { name: 'Save RPC endpoint' }))

    expect(wallets.update).toHaveBeenCalledWith('a', { rpcUrl: 'http://127.0.0.1:9545' })
  })

  it.each([
    ['passphrase-setup-required', 'Create vault passphrase'],
    ['locked', 'Vault passphrase']
  ] as const)('labels the %s vault secret field', (managedWallets, label) => {
    const wallets = controller({
      status: ref({ managedWallets, backend: 'passphrase', watchOnlyAvailable: true })
    })
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })

    expect(screen.getByLabelText(label)).toHaveAttribute('type', 'password')
  })

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
    const recovery = screen.getByLabelText<HTMLTextAreaElement>('Mnemonic / recovery phrase')
    await user.type(recovery, 'test secret phrase never retained in Vue state')
    await user.click(screen.getByRole('button', { name: 'Validate wallet secret' }))

    expect(recovery.value).toBe('')
    expect(wallets.prepareImport).toHaveBeenCalledWith('evm', 'mnemonic', 'test secret phrase never retained in Vue state')
    expect(await screen.findByText('0x1234')).toBeVisible()
  })

  it('uses the secret-format-specific input and clears material when the format changes', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, { props: { controller: wallets, workspaces: [] }, global })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))

    const mnemonic = screen.getByLabelText('Mnemonic / recovery phrase')
    expect(mnemonic.tagName).toBe('TEXTAREA')
    await user.type(mnemonic, 'phrase that must not become a private key')
    await user.selectOptions(screen.getByLabelText('Secret format'), 'private-key')

    expect(screen.queryByLabelText('Mnemonic / recovery phrase')).not.toBeInTheDocument()
    const privateKey = screen.getByLabelText('Private key')
    expect(privateKey.tagName).toBe('INPUT')
    expect(privateKey).toHaveAttribute('type', 'password')
    expect(privateKey).toHaveValue('')
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
    expect(screen.getByText(/unless you later create an exact Bypass Approve policy/i)).toBeVisible()
  })

  it('explains wallet purpose and can make one available to current and future workspaces', async () => {
    const wallets = controller()
    render(WalletsSettingsPanel, {
      props: {
        controller: wallets,
        workspaces: [{ id: 'workspace-1', name: 'Existing workspace' }]
      },
      global
    })
    const user = userEvent.setup()

    expect(screen.getByText(/marks this account as dedicated to agent-requested work/i)).toBeVisible()
    expect(screen.getByText(/does not let an agent approve its own request/i)).toBeVisible()
    expect(screen.getByText(/websites and agents in those workspaces can discover and request this wallet/i)).toBeVisible()
    await user.type(screen.getByLabelText('Name'), 'Everywhere wallet')
    await user.click(screen.getByLabelText('Any workspace'))

    expect(screen.getByLabelText('Existing workspace')).toBeDisabled()
    expect(screen.getByText(/includes workspaces created later/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add wallet' }))
    expect(wallets.generate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Everywhere wallet',
      availableInAllWorkspaces: true,
      workspaceIds: []
    }))
  })

  it('can broaden a configured wallet to future workspaces without implying signing approval', async () => {
    const configured = wallet('configured-wallet', 'Configured wallet', ['workspace-1'])
    const wallets = controller({ wallets: ref([configured]) })
    const { container } = render(WalletsSettingsPanel, {
      props: {
        controller: wallets,
        workspaces: [{ id: 'workspace-1', name: 'Existing workspace' }]
      },
      global
    })
    const accessPanel = within(container.querySelector('.wallet-configured-access') as HTMLElement)
    const user = userEvent.setup()

    await user.click(accessPanel.getByLabelText('Any workspace'))
    expect(accessPanel.getByLabelText('Existing workspace')).toBeDisabled()
    expect(accessPanel.getByText(/never grants signing approval automatically/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save workspace access' }))

    expect(wallets.update).toHaveBeenCalledWith(configured.id, {
      workspaceIds: [],
      availableInAllWorkspaces: true
    })
  })

  it('configures Bypass Approve mode only with explicit mainnet agent-wallet limits', async () => {
    const mainnetAgent: WalletDescriptor = {
      ...wallet('mainnet-agent', 'Mainnet agent', ['workspace-1']),
      kind: 'agent',
      capabilities: ['read', 'sign', 'send'],
      network: {
        id: '1', name: 'Ethereum', environment: 'mainnet', rpcUrl: 'https://ethereum-rpc.publicnode.com'
      }
    }
    const wallets = controller({ wallets: ref([mainnetAgent]) })
    render(WalletsSettingsPanel, {
      props: { controller: wallets, workspaces: [{ id: 'workspace-1', name: 'Agent workspace' }] },
      global
    })
    const user = userEvent.setup()

    expect(screen.getByText(/matching agent transactions run without a per-request approval dialog/i)).toBeVisible()
    await user.click(screen.getByLabelText('Bypass Approve mode'))
    await user.type(screen.getByLabelText('Allowed origin'), 'https://dapp.example')
    await user.type(screen.getByLabelText('Destination / contract'), '0x0000000000000000000000000000000000000002')
    await user.type(screen.getByLabelText('Method / instruction'), 'native-transfer')
    await user.type(screen.getByLabelText('Max native amount'), '0.01')
    await user.type(screen.getByLabelText('Max token amount'), '1')
    await user.type(screen.getByLabelText('Max fee'), '0.001')
    await user.type(screen.getByLabelText('Session native spend'), '0.02')
    await user.type(screen.getByLabelText('Daily native spend'), '0.05')
    await fireEvent.update(screen.getByLabelText('Expires'), '2026-09-05T12:00')
    expect(screen.getByLabelText('Bypass Approve mode')).toBeChecked()
    expect(screen.getByLabelText('Policy workspace')).toHaveValue('workspace-1')
    expect(screen.getByLabelText('Allowed origin')).toHaveValue('https://dapp.example')
    expect(screen.getByLabelText('Destination / contract')).toHaveValue('0x0000000000000000000000000000000000000002')
    expect(screen.getByLabelText('Method / instruction')).toHaveValue('native-transfer')
    expect(screen.getByLabelText('Max native amount')).toHaveValue('0.01')
    expect(screen.getByLabelText('Max token amount')).toHaveValue('1')
    expect(screen.getByLabelText('Max fee')).toHaveValue('0.001')
    expect(screen.getByLabelText('Session native spend')).toHaveValue('0.02')
    expect(screen.getByLabelText('Daily native spend')).toHaveValue('0.05')
    expect(screen.getByLabelText('Expires')).toHaveValue('2026-09-05T12:00')
    expect(screen.getByLabelText('Operation count')).toHaveValue(1)
    const enableBypass = screen.getByRole('button', { name: 'Enable Bypass Approve' })
    expect(enableBypass).toBeEnabled()
    await user.click(enableBypass)

    expect(wallets.setPolicy).toHaveBeenCalledWith(expect.objectContaining({
      walletId: mainnetAgent.id,
      workspaceId: 'workspace-1',
      mode: 'bounded-auto',
      allowMainnetAgentAutomation: true,
      maxNativeAmount: '0.01',
      maxTokenAmount: '1',
      maxFee: '0.001',
      sessionSpendLimit: '0.02',
      dailySpendLimit: '0.05',
      allowMessageSigning: false
    }))
  })

  it('explains locking and unlocks an OS-protected vault without asking for a fake passphrase', async () => {
    const wallets = controller()
    const rendered = render(WalletsSettingsPanel, {
      props: { controller: wallets, workspaces: [] },
      global
    })
    const user = userEvent.setup()

    expect(screen.getByText(/removes decrypted signing keys.*from memory/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Lock signing keys' }))
    expect(wallets.lock).toHaveBeenCalledOnce()

    wallets.status.value = {
      managedWallets: 'locked', backend: 'safe-storage', watchOnlyAvailable: true
    }
    await rendered.rerender({ controller: wallets, workspaces: [] })
    expect(screen.queryByLabelText('Vault passphrase')).not.toBeInTheDocument()
    expect(screen.getByText(/ordinary browsing and watch-only wallets remain available/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Unlock with system secure storage' }))
    expect(wallets.unlock).toHaveBeenCalledWith('')
  })
})
