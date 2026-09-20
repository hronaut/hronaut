import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function prepareWebsiteOutput(repositoryRoot = process.cwd()): Promise<void> {
  const outputDirectory = resolve(repositoryRoot, 'docs')

  await Promise.all([
    rm(resolve(outputDirectory, 'assets'), { recursive: true, force: true }),
    rm(resolve(outputDirectory, 'index.html'), { force: true })
  ])
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) await prepareWebsiteOutput()
