import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerWalletIpc } from '../src/main/wallet/ipc.js'
import type { WalletBroker } from '../src/main/wallet/broker.js'
import type { WalletService } from '../src/main/wallet/service.js'

type Host = Parameters<typeof registerWalletIpc>[1]
type Listener = Parameters<IpcMain['handle']>[1]
const shellChannels = [
  'wallets:status', 'wallets:list', 'wallets:setup-passphrase', 'wallets:unlock',
  'wallets:lock', 'wallets:generate', 'wallets:prepare-import', 'wallets:confirm-import',
  'wallets:cancel-import', 'wallets:add-watch-only', 'wallets:update', 'wallets:remove',
  'wallets:list-policies', 'wallets:set-policy', 'wallets:remove-policy',
  'wallets:list-permissions', 'wallets:revoke-permission', 'wallets:list-requests',
  'wallets:approve-request', 'wallets:reject-request', 'wallets:audit-history'
]

function fixture() {
  const service = {
    list: vi.fn<WalletService['list']>(() => []),
    setupPassphrase: vi.fn<WalletService['setupPassphrase']>(),
    unlock: vi.fn<WalletService['unlock']>(),
    prepareImport: vi.fn<WalletService['prepareImport']>(),
    confirmImport: vi.fn<WalletService['confirmImport']>(),
    cancelImport: vi.fn<WalletService['cancelImport']>(),
    addWatchOnly: vi.fn<WalletService['addWatchOnly']>(),
    auditHistory: vi.fn<WalletService['auditHistory']>(async () => []),
    policies: { list: vi.fn<WalletService['policies']['list']>(() => []) },
    permissions: { list: vi.fn<WalletService['permissions']['list']>(() => []) }
  }
  const broker = {
    providerRequest: vi.fn<WalletBroker['providerRequest']>(),
    lock: vi.fn<WalletBroker['lock']>(),
    updateWallet: vi.fn<WalletBroker['updateWallet']>(),
    removeWallet: vi.fn<WalletBroker['removeWallet']>(),
    setPolicy: vi.fn<WalletBroker['setPolicy']>(),
    removePolicy: vi.fn<WalletBroker['removePolicy']>(),
    revokePermission: vi.fn<WalletBroker['revokePermission']>(),
    listPending: vi.fn<WalletBroker['listPending']>(() => []),
    approve: vi.fn<WalletBroker['approve']>(),
    reject: vi.fn<WalletBroker['reject']>()
  }
  const context = {
    workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 7,
    topLevelOrigin: 'https://wallet.example',
    requester: { type: 'website' as const, id: 'https://wallet.example' }
  }
  const host = {
    assertMainShellSender: vi.fn<Host['assertMainShellSender']>(),
    assertWalletPageSender: vi.fn<Host['assertWalletPageSender']>(() => context),
    service: vi.fn<Host['service']>(() => service),
    broker: vi.fn<Host['broker']>(() => broker),
    status: vi.fn<Host['status']>(() => ({ managedWallets: 'disabled', backend: 'unavailable', watchOnlyAvailable: false })),
    generateWallet: vi.fn<Host['generateWallet']>()
  }
  const listeners = new Map<string, Listener>()
  registerWalletIpc({ handle: (channel, listener) => { listeners.set(channel, listener) } }, host)
  const event = {} as IpcMainInvokeEvent
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => listeners.get(channel)!(event, ...args))
  return { service, broker, host, context, listeners, event, invoke }
}

it.each(shellChannels)('requires the primary shell before accessing %s', async channel => {
  const { host, invoke, event } = fixture()
  host.assertMainShellSender.mockImplementation(() => { throw new Error('Non-primary renderer') })
  await expect(invoke(channel)).rejects.toThrow('Non-primary renderer')
  expect(host.assertMainShellSender).toHaveBeenCalledWith(event)
  expect(host.assertWalletPageSender).not.toHaveBeenCalled()
  expect(host.service).not.toHaveBeenCalled()
  expect(host.broker).not.toHaveBeenCalled()
  expect(host.status).not.toHaveBeenCalled()
  expect(host.generateWallet).not.toHaveBeenCalled()
})

it('derives provider authority from the page sender and keeps it separate from shell access', async () => {
  const { host, broker, context, event, invoke } = fixture()
  const input = { family: 'evm', method: 'eth_requestAccounts', workspaceId: 'spoofed' }
  broker.providerRequest.mockResolvedValue(['account'])
  await expect(invoke('wallet-provider:request', input)).resolves.toEqual(['account'])
  expect(host.assertWalletPageSender).toHaveBeenCalledWith(event)
  expect(host.assertMainShellSender).not.toHaveBeenCalled()
  expect(broker.providerRequest).toHaveBeenCalledWith(context, input)
  host.assertWalletPageSender.mockImplementation(() => { throw new Error('Invalid page') })
  await expect(invoke('wallet-provider:request', input)).rejects.toThrow('Invalid page')
  expect(broker.providerRequest).toHaveBeenCalledOnce()
})

it('registers without reading services and resolves their availability on every request', async () => {
  const { host, listeners, service, invoke } = fixture()
  expect([...listeners.keys()]).toEqual(['wallet-provider:request', ...shellChannels])
  expect(host.service).not.toHaveBeenCalled()
  expect(host.broker).not.toHaveBeenCalled()
  host.service.mockReturnValue(null)
  host.broker.mockReturnValue(null)
  for (const channel of ['wallets:list', 'wallets:list-policies', 'wallets:list-permissions', 'wallets:list-requests', 'wallets:audit-history']) {
    await expect(invoke(channel)).resolves.toEqual([])
  }
  await expect(invoke('wallets:status')).resolves.toEqual(host.status())
  await expect(invoke('wallets:unlock', 'passphrase')).rejects.toThrow('Wallet service is unavailable')
  await expect(invoke('wallets:lock')).rejects.toThrow('Wallet broker is unavailable')
  host.service.mockReturnValue(service)
  await invoke('wallets:unlock', 'passphrase')
  expect(service.unlock).toHaveBeenCalledWith('passphrase')
})

it.each([
  ['wallets:confirm-import', ['']], ['wallets:cancel-import', [' token']],
  ['wallets:update', ['wallet ']], ['wallets:remove', [null]],
  ['wallets:list-policies', [false]], ['wallets:remove-policy', ['x'.repeat(129)]],
  ['wallets:revoke-permission', [{}]], ['wallets:approve-request', [undefined]],
  ['wallets:reject-request', [7]], ['wallets:setup-passphrase', [null]],
  ['wallets:unlock', [false]], ['wallets:prepare-import', ['evm', 'private-key', null]],
  ['wallets:prepare-import', ['invalid-family', 'private-key', 'fixture']],
  ['wallets:prepare-import', ['evm', 'invalid-format', 'fixture']],
  ['wallets:set-policy', [{}]]
] as const)('rejects malformed %s arguments before calling a service operation', async (channel, args) => {
  const { service, broker, invoke } = fixture()
  await expect(invoke(channel, ...args)).rejects.toThrow()
  for (const operation of [...Object.values(service), ...Object.values(broker), service.policies.list, service.permissions.list]) {
    if (typeof operation === 'function') expect(operation).not.toHaveBeenCalled()
  }
})

it('preserves native recovery confirmation and broker ownership of mutations', async () => {
  const { host, service, broker, invoke } = fixture()
  const input = { name: 'Fixture', chainFamily: 'evm', workspaceIds: [] }
  const failure = new Error('Wallet creation cancelled before recovery confirmation')
  host.generateWallet.mockRejectedValueOnce(failure)
  await expect(invoke('wallets:generate', input)).rejects.toBe(failure)
  expect(host.generateWallet).toHaveBeenCalledWith(input)
  expect(host.service).not.toHaveBeenCalled()
  await invoke('wallets:prepare-import', 'evm', 'private-key', 'fixture')
  expect(service.prepareImport).toHaveBeenCalledWith('evm', 'private-key', 'fixture')
  const changes = { workspaceIds: ['workspace-2'] }
  await invoke('wallets:update', 'wallet-1', changes)
  expect(broker.updateWallet).toHaveBeenCalledWith('wallet-1', changes)
  await invoke('wallets:approve-request', 'request-1')
  expect(broker.approve).toHaveBeenCalledWith('request-1')
  await invoke('wallets:reject-request', 'request-2')
  expect(broker.reject).toHaveBeenCalledWith('request-2')
  broker.lock.mockRejectedValueOnce(new Error('Persistence unavailable'))
  await expect(invoke('wallets:lock')).rejects.toThrow('Persistence unavailable')
})
