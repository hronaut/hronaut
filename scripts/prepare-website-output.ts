import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isMainModule } from './is-main-module.ts'

export async function prepareWebsiteOutput(repositoryRoot = process.cwd()): Promise<void> {
  const outputDirectory = resolve(repositoryRoot, 'docs')

  await Promise.all([
    rm(resolve(outputDirectory, 'assets'), { recursive: true, force: true }),
    rm(resolve(outputDirectory, 'index.html'), { force: true })
  ])
}

if (isMainModule(import.meta.url)) await prepareWebsiteOutput()
