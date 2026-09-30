import { describe, expect, it } from 'vitest'
import axios from 'axios'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { TronWeb } from 'tronweb'

describe('Axios dependency', () => {
  it('does not inherit the default request method from Object.prototype', async () => {
    let method: string | undefined
    Object.defineProperty(Object.prototype, 'method', {
      value: 'post', configurable: true, writable: true
    })
    try {
      await axios('http://127.0.0.1/unused', {
        adapter: async config => {
          method = config.method
          return { data: '', status: 200, statusText: 'OK', headers: {}, config }
        }
      })
    } finally {
      Reflect.deleteProperty(Object.prototype, 'method')
    }
    expect(method).toBe('get')
  })

  it('preserves TronWeb HTTP JSON requests and responses', async () => {
    const received: { method?: string; url?: string; body: string }[] = []
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      received.push({ method: request.method, url: request.url, body })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ balance: 123 }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture port')
      const tron = new TronWeb({ fullHost: `http://127.0.0.1:${address.port}` })
      expect(await tron.fullNode.request('wallet/getaccount', { address: 'fixture' }, 'post'))
        .toEqual({ balance: 123 })
      expect(await tron.fullNode.request('wallet/getnowblock', { visible: true }, 'get'))
        .toEqual({ balance: 123 })
      expect(received).toEqual([
        { method: 'POST', url: '/wallet/getaccount', body: '{"address":"fixture"}' },
        { method: 'GET', url: '/wallet/getnowblock?visible=true', body: '' }
      ])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
