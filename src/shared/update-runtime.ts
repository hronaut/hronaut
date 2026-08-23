import type { UpdateOperation } from './update-errors.js'
import type { UpdateStatus } from './types.js'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function canStartUpdateOperation(
  status: UpdateStatus,
  activeOperation: UpdateOperation | null,
  requestedOperation: UpdateOperation
): boolean {
  if (activeOperation !== null) return false
  if (requestedOperation === 'check') return status !== 'installing'
  if (requestedOperation === 'download') return status === 'available'
  return status === 'downloaded' || status === 'install-error'
}

export function replacedPackageVersion(runningVersion: string, packageManifest: string): string | null {
  try {
    const parsed = JSON.parse(packageManifest) as { version?: unknown }
    const installedVersion = typeof parsed.version === 'string' ? parsed.version.trim() : ''
    if (!VERSION_PATTERN.test(installedVersion) || installedVersion === runningVersion) return null
    return installedVersion
  } catch {
    return null
  }
}
