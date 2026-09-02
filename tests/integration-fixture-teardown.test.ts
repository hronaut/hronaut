import { createServer, get } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { closeFixtureServer } from './integration/fixtures.js'

describe('integration fixture teardown', () => {
  it('routes every HTTP fixture shutdown through the connection-draining helper', async () => {
    const integrationDirectory = 'tests/integration'
    const files = (await readdir(integrationDirectory))
      .filter((file) => file.endsWith('.e2e.ts'))
    const directCloseSites = (await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(`${integrationDirectory}/${file}`, 'utf8')
    }))))
      .flatMap(({ file, source }) => [...source.matchAll(/\.close\(\s*\(/gu)]
        .map((match) => `${file}:${source.slice(0, match.index).split('\n').length}`))
    const fixtureSource = await readFile(`${integrationDirectory}/fixtures.ts`, 'utf8')

    expect(directCloseSites).toEqual([])
    expect(fixtureSource).toContain('export async function closeFixtureServer')
    expect(fixtureSource).toContain('server.closeAllConnections?.()')
  })

  it('allows recovery cleanup to close an already stopped fixture server', async () => {
    const server = createServer((_request, response) => response.end('ok'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    await closeFixtureServer(server)

    await expect(closeFixtureServer(server)).resolves.toBeUndefined()
  })

  it('drains an active HTTP connection instead of waiting for the global test timeout', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200)
      response.write('still connected')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not allocate a fixture port')
    const client = get(`http://127.0.0.1:${address.port}`)
    await new Promise<void>((resolve, reject) => {
      client.once('response', () => resolve())
      client.once('error', reject)
    })

    await closeFixtureServer(server)

    expect(server.listening).toBe(false)
    client.destroy()
  })
})
