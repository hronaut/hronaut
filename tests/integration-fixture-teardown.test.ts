import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('browser-shell integration fixture teardown', () => {
  it('routes every HTTP fixture shutdown through the connection-draining helper', async () => {
    const source = await readFile('tests/integration/browser-shell.e2e.ts', 'utf8')
    const directCloseLines = source
      .split('\n')
      .filter((line) => line.includes('server.close('))

    expect(directCloseLines).toHaveLength(1)
    expect(source).toContain('server.closeAllConnections()')
  })
})
