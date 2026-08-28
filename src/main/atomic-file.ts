import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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
      flag: 'wx'
    })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
