import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const canonicalGuide = 'https://hronaut.dev/client-topology'
const failureReasons = [
  'app_not_running',
  'endpoint_unreachable_from_client_namespace',
  'authentication_required',
  'mcp_handshake_failed',
  'browser_not_ready'
]

describe('client topology documentation', () => {
  it('routes repository setup and reference readers to the canonical reachability guide', async () => {
    const [readme, reference] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('REFERENCE.md', 'utf8')
    ])

    expect(readme).toContain(canonicalGuide)
    expect(reference).toContain(canonicalGuide)
    expect(readme).toContain("client process's network namespace")
    expect(readme).toMatch(/do not expose browser control through a LAN bind, proxy, or public tunnel/u)
    for (const reason of failureReasons) expect(reference).toContain(reason)
  })
})
