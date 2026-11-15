import type { SafeStorage } from 'electron'

/**
 * Whether secure storage encrypts with a key that a keyring keeps, as on Linux it does not always. When no keyring
 * answered as Hronaut started, as when the person dismissed the request to unlock one that stayed locked at sign-in,
 * or none runs, Chromium encrypts with a fallback key built into every Chromium-based app, still reports encryption as
 * available, and keeps that key until Hronaut restarts. What it encrypts starts with "v10"; a keyring's key gives
 * "v11", or "v12" through the desktop portal. macOS and Windows keep the key in their own store.
 */
export async function encryptsWithKeyringKey(
  storage: Pick<SafeStorage, 'encryptStringAsync'>,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (platform !== 'linux') return true
  // An empty text encrypts to nothing, without the key's prefix.
  const sample = await storage.encryptStringAsync('Hronaut')
  return sample.subarray(0, 3).toString('latin1') !== 'v10'
}
