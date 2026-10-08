import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { runInNewContext, Script } from 'node:vm'
import { buildProtocolTimingOverlay, PINNED_VERSION } from '../scripts/diagnostics/protocol-timing-overlay.js'
import { createProtocolTiming } from '../scripts/diagnostics/protocol-timing-runtime.js'

const require = createRequire(import.meta.url)
const packagePath = require.resolve('playwright-core/package.json')
const original = readFileSync(join(dirname(packagePath), 'lib/coreBundle.js'), 'utf8')
const patched = buildProtocolTimingOverlay(original, JSON.parse(readFileSync(packagePath, 'utf8')).version)
const sentinel = 'PRIVATE_expression_URL_endpoint_credentials_error_payload'

function harness(source = patched) {
  const order: string[] = []
  const queued: (() => void)[] = []
  const timing = createProtocolTiming()
  let sendError: Error | undefined
  class Socket extends EventEmitter {
    addEventListener(name: string, callback: (...args: unknown[]) => void) { this.on(name, callback) }
    send(_message: string) { order.push('send'); if (sendError) throw sendError }
    close() { order.push('close') }
  }
  const start = source.indexOf('    WebSocketTransport = class _WebSocketTransport {')
  const end = source.indexOf('\n    };', start) + '\n    };'.length
  const Transport = runInNewContext(`${source.slice(start, end)}; WebSocketTransport`, {
    ws: Socket, happyEyeballsOptions: {}, perMessageDeflate2: {},
    hronautTiming: timing, setImmediate: (callback: () => void) => { order.push('schedule'); queued.push(callback) },
    JSON: { parse: (value: string) => { order.push('parse'); return JSON.parse(value) }, stringify: (value: unknown) => { order.push('stringify'); return JSON.stringify(value) } }
  })
  const transport = new Transport({ log: () => order.push('log') }, sentinel, sentinel, {})
  timing.register(transport, 1)
  transport.onmessage = () => order.push('dispatch')
  return { timing, transport, order, queued, failSend(error: Error) { sendError = error } }
}

describe('pinned offline protocol timing overlay', () => {
  it('emits syntactically valid bundle and an executable standalone observer', () => {
    expect(() => new Script(patched)).not.toThrow()
    const runtimeEnd = patched.indexOf('})();\n') + '})();\n'.length
    const observer = runInNewContext(patched.slice(0, runtimeEnd) + 'hronautTiming', { performance })
    const owner = {}; observer.register(owner, 1); observer.send(owner, { id: 1 }, 1)
    expect(observer.snapshot().rows[0].slice(0, 6)).toEqual([1, 1, 1, 1, 0, 0])
  })

  it('rejects malformed receive tokens without retaining attacker values', () => {
    const h = harness()
    for (const token of [[], [1], [1, NaN], [Infinity, 1], [-1, 1], [1, -1], [1, 2, 3]])
      h.timing.parsed(h.transport, { id: 1 }, token)
    expect(h.timing.snapshot().rows).toEqual([])
  })

  it('fails closed for version, source or already patched source mismatch', () => {
    expect(() => buildProtocolTimingOverlay(original, '1.63.1')).toThrow('pin mismatch')
    expect(() => buildProtocolTimingOverlay(original + '\n', PINNED_VERSION)).toThrow('pin mismatch')
    expect(() => buildProtocolTimingOverlay(patched, PINNED_VERSION)).toThrow('pin mismatch')
    expect(patched).toContain('hronautTiming.register(nodeTransport, 1)')
    expect(patched).toContain('hronautTiming.register(chromeTransport, 2)')
  })

  it('preserves stringify/send and scheduled parse/dispatch ordering from pinned source', () => {
    for (const source of [original, patched]) {
      const h = harness(source)
      h.transport.send({ id: 7, method: 'Runtime.evaluate', params: { expression: sentinel } })
      h.transport._ws.emit('message', { data: JSON.stringify({ id: 7, result: sentinel }) })
      expect(h.order).toEqual(['stringify', 'send', 'schedule'])
      h.queued[0]!()
      expect(h.order).toEqual(['stringify', 'send', 'schedule', 'parse', 'dispatch'])
    }
  })

  it('preserves send member lookup before serialization and the socket receiver', () => {
    for (const source of [original, patched]) {
      const h = harness(source)
      const socket = h.transport._ws
      Object.defineProperty(socket, 'send', { get() {
        h.order.push('lookup')
        return function(this: unknown) { expect(this).toBe(socket); h.order.push('send') }
      } })
      h.transport.send({ id: 1, toJSON() { h.order.push('toJSON'); return { id: 1 } } })
      expect(h.order).toEqual(['lookup', 'stringify', 'toJSON', 'send'])
    }
  })

  it('correlates numeric transport/request/receive through actual CRSession callback boundary', () => {
    const h = harness()
    const start = patched.indexOf('    CRSession = class _CRSession extends SdkObject {')
    const end = patched.indexOf('\n    };', start) + '\n    };'.length
    const Session = runInNewContext(`${patched.slice(start, end)}; CRSession`, { SdkObject: EventEmitter, hronautTiming: h.timing })
    const session = new Session({ _transport: h.transport }, null, '')
    session._callbacks.set(7, { resolve: () => h.order.push('callback') })
    h.transport.onmessage = (message: unknown) => session._onMessage(message)
    h.transport.send({ id: 7, method: 'Runtime.evaluate', params: sentinel })
    h.transport._ws.emit('message', { data: '{"id":7,"result":"private"}' })
    expect(h.timing.snapshot().rows.map(r => r[0])).toEqual([1, 2])
    h.queued[0]!()
    const rows = h.timing.snapshot().rows
    expect(rows.map(r => r.slice(0, 6))).toEqual([
      [1, 1, 1, 7, 0, 1], [2, 1, 1, 7, 0, 1],
      [4, 1, 1, 7, 1, 0], [5, 1, 1, 7, 1, 0], [6, 1, 1, 7, 1, 0]
    ])
    expect(rows.every(r => r.every(Number.isFinite))).toBe(true)
    expect(rows[2]![6]).toBeLessThanOrEqual(rows[3]![6]!)
    expect(h.order.at(-1)).toBe('callback')
    expect(session._callbacks.size).toBe(0)
  })

  it('does not conflate equal request IDs on distinct transports', () => {
    const timing = createProtocolTiming(); const a = {}; const b = {}
    timing.register(a, 1); timing.register(b, 2)
    timing.send(a, { id: 1 }, 1); timing.send(b, { id: 1 }, 1)
    expect(timing.snapshot().rows.map(r => r.slice(1, 4))).toEqual([[1, 1, 1], [2, 2, 1]])
  })

  it('keeps only fixed numeric classes, excludes close sentinel and never reads payload accessors', () => {
    const h = harness()
    const poison = { id: 9, method: sentinel, get params() { throw new Error(sentinel) }, get result() { throw new Error(sentinel) }, get error() { throw new Error(sentinel) } }
    h.timing.send(h.transport, poison, 1)
    h.timing.parsed(h.transport, poison, h.timing.raw(h.transport))
    h.timing.callback(h.transport, poison)
    for (const message of [{ id: -9999 }, { id: sentinel }, { id: Infinity }, { id: 1.2 }, null, []]) {
      h.timing.send(h.transport, message, 1)
      h.timing.parsed(h.transport, message, h.timing.raw(h.transport))
      h.timing.callback(h.transport, message)
    }
    expect(h.timing.snapshot().rows).toHaveLength(4)
    expect(JSON.stringify(h.timing.snapshot())).not.toContain(sentinel)
    expect(h.timing.snapshot().rows.every(r => r[5] === 0)).toBe(true)
  })

  it('preserves malformed JSON and throwing dispatch close behavior without retaining error text', () => {
    for (const malformed of [true, false]) for (const source of [original, patched]) {
      const h = harness(source)
      h.transport.onmessage = () => { h.order.push('dispatch'); throw new Error(sentinel) }
      h.transport._ws.emit('message', { data: malformed ? sentinel : '{"id":4}' })
      h.queued[0]!()
      expect(h.order).toEqual(malformed ? ['schedule', 'parse', 'log', 'close'] : ['schedule', 'parse', 'dispatch', 'log', 'close'])
      expect(JSON.stringify(h.timing.snapshot())).not.toContain(sentinel)
      if (source === patched) expect(h.timing.snapshot().rows.at(-1)![0]).toBe(malformed ? 7 : 8)
    }
  })

  it('preserves exact send exception identity and omits successful return marker', () => {
    for (const source of [original, patched]) {
      const h = harness(source); const error = new Error(sentinel)
      h.failSend(error)
      expect(() => h.transport.send({ id: 2 })).toThrow(error)
      expect(h.order).toEqual(['stringify', 'send'])
      if (source === patched) expect(h.timing.snapshot().rows.map(r => r[0])).toEqual([1, 3])
    }
  })

  it('does not change stringify failure, accessor evaluation, or inspect hostile proxies', () => {
    const h = harness(); const error = new Error(sentinel)
    expect(() => h.transport.send({ toJSON() { throw error } })).toThrow(error)
    expect(h.order).toEqual(['stringify'])
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw error } })
    expect(() => h.timing.send(h.transport, proxy, 1)).not.toThrow()
    expect(() => h.timing.parsed(h.transport, proxy, h.timing.raw(h.transport))).not.toThrow()
    expect(h.timing.snapshot().rows).toEqual([])
  })

  it('bounds retained output for oversized payloads and repeated input; snapshots are detached', () => {
    const h = harness()
    const huge = sentinel.repeat(100000)
    for (let n = 1; n <= 3000; n++) h.timing.send(h.transport, { id: n, method: huge, params: huge }, 1)
    const snapshot = h.timing.snapshot()
    expect(snapshot.total).toBe(3000); expect(snapshot.dropped).toBe(952)
    expect(snapshot.rows).toHaveLength(2048)
    expect(snapshot.rows[0]![3]).toBe(953)
    expect(snapshot.rows.at(-1)![3]).toBe(3000)
    expect(JSON.stringify(snapshot).length).toBeLessThan(200000)
    expect(JSON.stringify(snapshot)).not.toContain(sentinel)
    snapshot.rows[0]![3] = -1
    expect(h.timing.snapshot().rows[0]![3]).toBe(953)
  })

  it('caps transport registration and classifies lifecycle without payload retention', () => {
    const timing = createProtocolTiming()
    for (let n = 0; n < 100; n++) { const owner = {}; timing.register(owner, 2); timing.lifecycle(owner, 9) }
    expect(timing.snapshot().rows).toHaveLength(64)
    const h = harness()
    h.transport._ws.emit('message', { data: JSON.stringify({ method: 'Runtime.executionContextsCleared', params: sentinel }) })
    h.queued[0]!()
    expect(h.timing.snapshot().rows.map(r => r[5])).toEqual([5, 5])
    expect(JSON.stringify(h.timing.snapshot())).not.toContain(sentinel)
  })
})
