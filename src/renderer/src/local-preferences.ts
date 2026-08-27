export interface LocalPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LocalPreferenceStorageProvider = () => LocalPreferenceStorage

function browserLocalStorage(): LocalPreferenceStorage {
  return window.localStorage
}

export function readLocalPreference(
  key: string,
  storage: LocalPreferenceStorageProvider = browserLocalStorage
): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

export function writeLocalPreference(
  key: string,
  value: string,
  storage: LocalPreferenceStorageProvider = browserLocalStorage
): boolean {
  try {
    storage().setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeLocalPreference(
  key: string,
  storage: LocalPreferenceStorageProvider = browserLocalStorage
): boolean {
  try {
    storage().removeItem(key)
    return true
  } catch {
    return false
  }
}
