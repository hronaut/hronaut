import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

async function flushDirectory(path: string): Promise<void> {
  // Windows does not support opening directories through Node's file API.
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } catch (error) {
    // Some filesystems cannot fsync directories. Preserve their existing
    // file-flush guarantee, but do not conceal actual storage failures.
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw error
  } finally {
    await handle.close()
  }
}

export async function writeTextFileAtomically(
  path: string,
  contents: string,
  mode = 0o600
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      mode,
      flag: 'wx',
      flush: true
    })
    await rename(temporaryPath, path)
    await flushDirectory(dirname(path))
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
