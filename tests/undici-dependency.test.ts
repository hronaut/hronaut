import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BalancedPool } from 'undici'
import { expect, it, vi } from 'vitest'

// GHSA-w293-vg96-wgc3: a custom connector must remain authoritative even
// when a fallback connection would succeed. This is a development dependency.
it('preserves a BalancedPool connector rejection instead of silently using the default connector', async () => {
  const received = vi.fn()
  const server = createServer((_request, response) => {
    received()
    response.end('default connector accepted')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const rejected = new Error('Connection rejected by custom policy')
  const pool = new BalancedPool(origin, { connect: (_options, callback) => callback(rejected, null) })
  try {
    const outcome = await pool.request({ path: '/', method: 'GET' }).then(async response => {
      await response.body.dump()
      return 'connection accepted'
    }, error => error)
    expect(outcome).toBe(rejected)
    expect(received).not.toHaveBeenCalled()
  } finally {
    await pool.destroy()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
