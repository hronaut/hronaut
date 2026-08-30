import { join } from 'node:path'
import {
  emptyWalletAuthorityState,
  encodeWalletAuthorityState,
  WalletAuthorityPersistence
} from '../../src/main/wallet/authority-state.js'
import { SafeStorageWalletKeyWrapper, type WalletSafeStorage } from '../../src/main/wallet/key-provider.js'
import { WalletVault } from '../../src/main/wallet/vault.js'

function testSafeStorage(): WalletSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value) => Buffer.from(`test:${value}`, 'utf8'),
    decryptStringAsync: async (value) => ({
      result: value.toString('utf8').replace(/^test:/, ''),
      shouldReEncrypt: false
    })
  }
}

export async function createTestWalletAuthority(directory: string): Promise<WalletAuthorityPersistence> {
  const vault = new WalletVault(join(directory, 'vault.json'), new SafeStorageWalletKeyWrapper(testSafeStorage()))
  await vault.initialize(undefined, encodeWalletAuthorityState(emptyWalletAuthorityState()))
  const authority = new WalletAuthorityPersistence(() => vault, directory)
  await authority.load([])
  return authority
}

export async function loadTestWalletAuthority(directory: string): Promise<WalletAuthorityPersistence> {
  const vault = new WalletVault(join(directory, 'vault.json'), new SafeStorageWalletKeyWrapper(testSafeStorage()))
  await vault.load()
  const authority = new WalletAuthorityPersistence(() => vault, directory)
  await authority.load(vault.list())
  return authority
}
