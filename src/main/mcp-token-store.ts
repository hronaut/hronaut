import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/

export interface McpTokenConfiguration {
  token: string
  tokenPath?: string
  source: 'environment' | 'profile'
}

export async function loadMcpToken(path: string, environmentToken?: string): Promise<McpTokenConfiguration> {
  if (environmentToken) {
    if (!TOKEN_PATTERN.test(environmentToken)) {
      throw new Error('HRONAUT_MCP_TOKEN must contain at least 32 URL-safe characters')
    }
    return { token: environmentToken, source: 'environment' }
  }

  try {
    const token = (await readFile(path, 'utf8')).trim()
    if (!TOKEN_PATTERN.test(token)) throw new Error(`Invalid MCP token file: ${path}`)
    await chmod(path, 0o600)
    return { token, tokenPath: path, source: 'profile' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const token = randomBytes(32).toString('base64url')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporaryPath, path)
  await chmod(path, 0o600)
  return { token, tokenPath: path, source: 'profile' }
}
