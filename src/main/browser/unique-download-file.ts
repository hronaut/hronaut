import { mkdir, open, rm } from 'node:fs/promises'
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
    try {
      validate()
      await handle.writeFile(data)
      validate()
      await handle.close()
      return candidate
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(candidate, { force: true }).catch(() => undefined)
      throw error
    }
  }
  throw new Error(`Could not allocate a unique download path for ${filename}`)
}
