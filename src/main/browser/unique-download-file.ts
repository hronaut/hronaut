import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** Reserve a new export exclusively and remove its partial contents on failure. */
export async function writeUniqueDownloadFile(
  directory: string,
  filename: string,
  data: Buffer,
  validate: () => void = () => undefined
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length)
  for (let index = 0; index <= 9_999; index += 1) {
    const candidateName = index === 0 ? filename : `${stem} (${index})${extension}`
    const candidate = join(directory, candidateName)
    validate()
    let handle
    try {
      handle = await open(candidate, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    let ownedFile: BigIntStats | undefined
    try {
      ownedFile = await handle.stat({ bigint: true })
      validate()
      await handle.writeFile(data)
      validate()
      await handle.close()
      validate()
      return candidate
    } catch (error) {
      await handle.close().catch(() => undefined)
      // The user may have moved the partial export and reused its name while
      // the write was pending. Never clean up an observed replacement file.
      const currentFile = await lstat(candidate, { bigint: true }).catch(() => undefined)
      if (ownedFile && currentFile && ownedFile.dev === currentFile.dev && ownedFile.ino === currentFile.ino) {
        await rm(candidate, { force: true }).catch(() => undefined)
      }
      throw error
    }
  }
  throw new Error(`Could not allocate a unique download path for ${filename}`)
}
