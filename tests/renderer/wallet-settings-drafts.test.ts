// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WalletsSettingsPanel from '../../src/renderer/src/components/WalletsSettingsPanel.vue'
import { useWalletsController } from '../../src/renderer/src/composables/useWalletsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { HronautWalletsApi } from '../../src/shared/types.js'
import type { WalletDescriptor, WalletPolicy, WalletServiceStatus, WalletUpdateInput } from '../../src/shared/wallet.js'

const global = { plugins: [createHronautI18n('en-US')] }
const workspaces = [{ id: 'workspace-a', name: 'Workspace A' }, { id: 'workspace-b', name: 'Workspace B' }]

function signingWallet(workspaceIds: string[]): WalletDescriptor {
  return {
    id: 'signing',
    name: 'Signing wallet',
    kind: 'managed',
    chainFamily: 'evm',
    publicAddress: '0x1111111111111111111111111111111111111111',
    network: { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'https://11155111.rpc.thirdweb.com' },
    capabilities: ['read', 'sign', 'send'],
    workspaceIds,
    policyIds: [],
    recoveryConfirmed: true,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
  }
}

/**
 * Main's wallet service as the real controller sees it: every read is a fresh copy, as IPC delivers it, so after any
 * Settings change the refreshed list holds new objects for the same wallets.
 */
function walletsApi(workspaceIds = ['workspace-a'], holdPolicySaves = false) {
  let saved = signingWallet(workspaceIds)
  const policies: WalletPolicy[] = []
  const status: WalletServiceStatus = { managedWallets: 'ready', backend: 'safe-storage', watchOnlyAvailable: true }
  const pendingSaves: Array<() => void> = []
  const storePolicy = (policy: WalletPolicy): WalletPolicy => {
    policies.push(structuredClone(policy))
    saved = { ...saved, policyIds: [...saved.policyIds, policy.id] }
    return structuredClone(policy)
  }
  const update = vi.fn(async (_walletId: string, changes: WalletUpdateInput) => {
    saved = { ...saved, ...changes, updatedAt: '2026-09-01T00:00:00.000Z' }
    return structuredClone(saved)
  })
  const setPolicy = vi.fn((policy: WalletPolicy) => holdPolicySaves
    ? new Promise<WalletPolicy>((resolve) => { pendingSaves.push(() => resolve(storePolicy(policy))) })
    : Promise.resolve(storePolicy(policy)))
  const api = {
    status: vi.fn(async () => structuredClone(status)),
    list: vi.fn(async () => [structuredClone(saved)]),
    setupPassphrase: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    generate: vi.fn(),
    prepareImport: vi.fn(),
    confirmImport: vi.fn(),
    cancelImport: vi.fn(async () => true),
    addWatchOnly: vi.fn(),
    update,
    remove: vi.fn(),
    listPolicies: vi.fn(async () => structuredClone(policies)),
    setPolicy,
    removePolicy: vi.fn(),
    listPermissions: vi.fn(async () => []),
    revokePermission: vi.fn(),
    listRequests: vi.fn(async () => []),
    approveRequest: vi.fn(),
    rejectRequest: vi.fn(),
    auditHistory: vi.fn(async () => []),
    onChanged: vi.fn(() => () => undefined),
    onStatusChanged: vi.fn(() => () => undefined),
    onRequestsChanged: vi.fn(() => () => undefined)
  } satisfies HronautWalletsApi
  return { api, update, setPolicy, finishPolicySave: () => pendingSaves.shift()?.() }
}

async function renderPanel(api: HronautWalletsApi) {
  const controller = useWalletsController({ api, formatError: (error) => String(error), reportRequestError: vi.fn() })
  await controller.initialize()
  const view = render(WalletsSettingsPanel, { props: { controller, workspaces }, global })
  await screen.findByLabelText('Allowed origin')
  return { controller, view }
}

async function typePolicyDraft(user: ReturnType<typeof userEvent.setup>, origin: string): Promise<void> {
  await user.type(screen.getByLabelText('Allowed origin'), origin)
  await user.type(screen.getByLabelText('Recipient, spender or operator'), '0x0000000000000000000000000000000000000001')
  await user.type(screen.getByLabelText('Method / instruction'), 'transfer')
}

afterEach(() => vi.restoreAllMocks())

describe('WalletsSettingsPanel drafts across a refreshed wallet list', () => {
  // The bounded policy's workspace must be attached first, so attaching it is a natural step in the middle of writing
  // a policy. Saving the access refreshed the wallet list, whose new copy of the same wallet counted as choosing
  // another wallet: the policy being written was wiped.
  it('keeps a policy draft when the wallet\'s workspace access is saved', async () => {
    const { api, update } = walletsApi()
    const { view } = await renderPanel(api)
    const user = userEvent.setup()

    await typePolicyDraft(user, 'https://dapp.example')
    await user.click(screen.getByRole('checkbox', { name: 'Workspace B' }))
    await user.click(screen.getByRole('button', { name: 'Save workspace access' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('signing', { workspaceIds: ['workspace-a', 'workspace-b'], availableInAllWorkspaces: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save workspace access' })).toBeEnabled())

    expect(screen.getByLabelText('Allowed origin')).toHaveValue('https://dapp.example')
    expect(screen.getByLabelText('Recipient, spender or operator')).toHaveValue('0x0000000000000000000000000000000000000001')
    expect(screen.getByLabelText('Method / instruction')).toHaveValue('transfer')
    expect(screen.getByRole('checkbox', { name: 'Workspace B' })).toBeChecked()
    view.unmount()
  })

  // addPolicy deliberately keeps a draft edited while its save was pending, but the save's own list refresh wiped it.
  it('keeps a policy draft edited while the previous save was pending, with the real list refresh', async () => {
    const { api, setPolicy, finishPolicySave } = walletsApi(['workspace-a'], true)
    const { view } = await renderPanel(api)
    const user = userEvent.setup()

    await typePolicyDraft(user, 'https://dapp.example')
    await user.click(screen.getByRole('button', { name: 'Add bounded policy' }))
    expect(setPolicy).toHaveBeenCalledOnce()
    await user.clear(screen.getByLabelText('Allowed origin'))
    await user.type(screen.getByLabelText('Allowed origin'), 'https://next.example')
    finishPolicySave()
    await waitFor(() => expect(screen.getByText('Bounded Sepolia policy')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save workspace access' })).toBeEnabled())

    expect(screen.getByLabelText('Allowed origin')).toHaveValue('https://next.example')
    expect(screen.getByLabelText('Method / instruction')).toHaveValue('transfer')
    view.unmount()
  })

  // Unsaved access choices were lost the same way when another change, such as adding a policy, refreshed the list.
  it('keeps unsaved workspace access choices when a policy is added', async () => {
    const { api, setPolicy } = walletsApi()
    const { view } = await renderPanel(api)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: 'Workspace B' }))
    await typePolicyDraft(user, 'https://dapp.example')
    await user.click(screen.getByRole('button', { name: 'Add bounded policy' }))
    await waitFor(() => expect(setPolicy).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByLabelText('Allowed origin')).toHaveValue(''))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save workspace access' })).toBeEnabled())

    expect(screen.getByRole('checkbox', { name: 'Workspace B' })).toBeChecked()
    view.unmount()
  })

  // A refresh now keeps the drafts, so choosing another wallet must still start them over: one wallet's unsaved name,
  // RPC endpoint or workspace access must never be saved onto another.
  it('starts the name, RPC and access drafts over when another wallet is chosen', async () => {
    const { api } = walletsApi(['workspace-a'])
    const treasury: WalletDescriptor = {
      ...signingWallet(['workspace-b']), id: 'treasury', name: 'Treasury wallet',
      publicAddress: '0x2222222222222222222222222222222222222222'
    }
    api.list.mockImplementation(async () => [signingWallet(['workspace-a']), structuredClone(treasury)])
    const { view } = await renderPanel(api)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByLabelText('Wallet name'))
    await user.type(screen.getByLabelText('Wallet name'), 'Unsaved name')
    await user.click(screen.getByRole('button', { name: 'Change RPC endpoint' }))
    await user.click(screen.getByRole('checkbox', { name: 'Workspace B' }))
    await user.click(screen.getByRole('button', { name: /^Treasury wallet/ }))

    await waitFor(() => expect(screen.queryByLabelText('Wallet name')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Change RPC endpoint' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Workspace A' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Workspace B' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: /^Signing wallet/ }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Workspace B' })).not.toBeChecked())
    expect(screen.getByRole('checkbox', { name: 'Workspace A' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByLabelText('Wallet name')).toHaveValue('Signing wallet')
    view.unmount()
  })

  // Without the old reset on every refresh, a workspace attached to a wallet that had none still becomes the policy's.
  it('offers a newly attached workspace for the policy of a wallet that had none', async () => {
    const { api } = walletsApi([])
    const { view } = await renderPanel(api)
    const user = userEvent.setup()

    expect(screen.getByRole('combobox', { name: 'Policy workspace' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Workspace B' }))
    await user.click(screen.getByRole('button', { name: 'Save workspace access' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Policy workspace' })).toBeEnabled())

    expect(screen.getByRole('combobox', { name: 'Policy workspace' })).toHaveValue('workspace-b')
    view.unmount()
  })
})
