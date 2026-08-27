import { randomBytes } from 'node:crypto'
import { chmod, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/

export interface McpTokenConfiguration {
  token: string
  tokenPath?: string
  source: 'environment' | 'profile'
}

async function readProfileToken(path: string): Promise<McpTokenConfiguration> {
  const token = (await readFile(path, 'utf8')).trim()
  if (!TOKEN_PATTERN.test(token)) throw new Error(`Invalid MCP token file: ${path}`)
  await chmod(path, 0o600)
  return { token, tokenPath: path, source: 'profile' }
}

async function removeTemporaryToken(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function loadMcpToken(path: string, environmentToken?: string): Promise<McpTokenConfiguration> {
  if (environmentToken) {
    if (!TOKEN_PATTERN.test(environmentToken)) {
      throw new Error('HRONAUT_MCP_TOKEN must contain at least 32 URL-safe characters')
    }
    return { token: environmentToken, source: 'environment' }
  }

  try {
    return await readProfileToken(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const token = randomBytes(32).toString('base64url')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })

  let createdProfileToken = false
  try {
    try {
      await link(temporaryPath, path)
      createdProfileToken = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } finally {
    await removeTemporaryToken(temporaryPath)
  }

  return createdProfileToken
    ? { token, tokenPath: path, source: 'profile' }
    : readProfileToken(path)
}
