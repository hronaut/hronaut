import { rm } from 'node:fs/promises'

type RemoveDirectory = typeof rm

export async function removeTestDirectory(
  path: string,
  remove: RemoveDirectory = rm
): Promise<void> {
  await remove(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  })
}
