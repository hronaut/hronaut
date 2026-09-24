import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Recognize direct execution through either the real path or a filesystem alias. */
export function isMainModule(moduleUrl: string, entryPoint = process.argv[1]): boolean {
  if (!entryPoint) return false
  try {
    return realpathSync(entryPoint) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}
