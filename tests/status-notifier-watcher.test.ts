import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionBusPath, watchStatusNotifierWatcher } from '../src/main/attention/status-notifier-watcher.js'

const WATCHER = 'org.kde.StatusNotifierWatcher'

/** A signal from the bus in D-Bus wire format, in either byte order, whose arguments are strings. */
function busSignal(member: string, args: readonly string[], little = true): Buffer {
  const bytes: number[] = []
  const align = (size: number) => { while (bytes.length % size) bytes.push(0) }
  const uint32 = (value: number) => {
    align(4)
    const word = Buffer.alloc(4)
    if (little) word.writeUInt32LE(value)
    else word.writeUInt32BE(value)
    bytes.push(...word)
  }
  const string = (value: string) => { uint32(Buffer.byteLength(value)); bytes.push(...Buffer.from(value), 0) }
  const signature = (value: string) => { bytes.push(value.length, ...Buffer.from(value), 0) }
  bytes.push(little ? 0x6c : 0x42, 4, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  const fields: Array<[number, string, string]> = [
    [1, 'o', '/org/freedesktop/DBus'], [2, 's', 'org.freedesktop.DBus'], [3, 's', member], [5, 'u', '7'],
    [7, 's', 'org.freedesktop.DBus'], [8, 'g', 's'.repeat(args.length)]
  ]
  for (const [code, type, value] of fields) {
    align(8)
    bytes.push(code)
    signature(type)
    if (type === 'g') signature(value)
    else if (type === 'u') uint32(Number(value))
    else string(value)
  }
  const fieldsLength = bytes.length - 16
  align(8)
  const bodyStart = bytes.length
  for (const arg of args) string(arg)
  const message = Buffer.from(bytes)
  const write = (offset: number, value: number) => little ? message.writeUInt32LE(value, offset) : message.writeUInt32BE(value, offset)
  write(4, message.length - bodyStart)
  write(8, 9)
  write(12, fieldsLength)
  return message
}

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

/** A session bus on a socket of its own, which records what the watch sends it. */
async function fakeBus() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-bus-'))
  const path = join(directory, 'bus')
  const chunks: Buffer[] = []
  let client: Socket | undefined
  const closed = vi.fn()
  const server = createServer()
  const connected = new Promise<Socket>((resolve) => {
    server.on('connection', (socket) => {
      client = socket
      socket.on('data', (chunk: Buffer) => chunks.push(chunk))
      // The watch may close while the bus still writes to it.
      socket.on('error', () => undefined)
      socket.on('close', closed)
      resolve(socket)
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  closers.push(async () => {
    client?.destroy()
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const received = () => Buffer.concat(chunks).toString('latin1')
  return { address: `unix:path=${path}`, connected, received, closed }
}

describe('following the desktop tray on the session bus', () => {
  it('authenticates as the user, asks only for the tray name’s owner changes, and reports each tray that starts', async () => {
    const bus = await fakeBus()
    const started = vi.fn()
    const stop = watchStatusNotifierWatcher(started, { address: bus.address, uid: 1000 })
    const socket = await bus.connected
    await vi.waitFor(() => expect(bus.received()).toBe('\0AUTH EXTERNAL 31303030\r\n'))
    socket.write('OK 0123456789abcdef0123456789abcdef\r\n')
    await vi.waitFor(() => expect(bus.received()).toContain('AddMatch'))
    const sent = bus.received()
    expect(sent).toContain('\r\nBEGIN\r\n')
    expect(sent.indexOf('Hello')).toBeLessThan(sent.indexOf('AddMatch'))
    expect(sent).toContain(`type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${WATCHER}'`)

    socket.write(busSignal('NameOwnerChanged', ['org.example.Other', '', ':1.7']))
    socket.write(busSignal('NameOwnerChanged', [WATCHER, ':1.8', '']))
    // A signal the bus sends in pieces counts once it is whole.
    const appeared = busSignal('NameOwnerChanged', [WATCHER, '', ':1.9'])
    for (const byte of appeared) socket.write(Buffer.from([byte]))
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
    socket.write(busSignal('NameOwnerChanged', [WATCHER, '', ':1.10'], false))
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))

    stop()
    await vi.waitFor(() => expect(bus.closed).toHaveBeenCalled())
  })

  it('ends when the bus refuses it or sends what is not a D-Bus message', async () => {
    const refused = await fakeBus()
    const started = vi.fn()
    watchStatusNotifierWatcher(started, { address: refused.address, uid: 1000 })
    ;(await refused.connected).write('REJECTED EXTERNAL\r\n')
    await vi.waitFor(() => expect(refused.closed).toHaveBeenCalled())
    expect(refused.received()).not.toContain('BEGIN')

    const garbled = await fakeBus()
    watchStatusNotifierWatcher(started, { address: garbled.address, uid: 1000 })
    const socket = await garbled.connected
    socket.write('OK 0123456789abcdef0123456789abcdef\r\n')
    await vi.waitFor(() => expect(garbled.received()).toContain('AddMatch'))
    socket.write(Buffer.alloc(16, 0x7a))
    await vi.waitFor(() => expect(garbled.closed).toHaveBeenCalled())

    const oversized = await fakeBus()
    watchStatusNotifierWatcher(started, { address: oversized.address, uid: 1000 })
    const large = await oversized.connected
    large.write('OK 0123456789abcdef0123456789abcdef\r\n')
    await vi.waitFor(() => expect(oversized.received()).toContain('AddMatch'))
    large.write(busSignal('NameOwnerChanged', [WATCHER, '', ':1.11', 'x'.repeat(70_000)]))
    await vi.waitFor(() => expect(oversized.closed).toHaveBeenCalled())
    expect(started).not.toHaveBeenCalled()
  })

  it('does nothing when there is no session bus', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-bus-'))
    closers.push(() => rm(directory, { recursive: true, force: true }))
    const stop = watchStatusNotifierWatcher(vi.fn(), { address: `unix:path=${join(directory, 'missing')}`, uid: 1000 })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce())
    stop()
    expect(watchStatusNotifierWatcher(vi.fn(), { address: 'tcp:host=localhost,port=1', uid: 1000 })).toBeTypeOf('function')
    warn.mockRestore()
  })
})

describe('the session bus address', () => {
  it('reads a socket path, an abstract socket and escaped values, and falls back to the systemd user bus', () => {
    expect(sessionBusPath('unix:path=/run/user/1000/bus', 1000)).toBe('/run/user/1000/bus')
    expect(sessionBusPath('tcp:host=localhost,port=1;unix:abstract=/tmp/dbus-AbC,guid=1f', 1000)).toBe('\0/tmp/dbus-AbC')
    expect(sessionBusPath('unix:path=/tmp/a%2cb%3db,guid=1f', 1000)).toBe('/tmp/a,b=b')
    expect(sessionBusPath(undefined, 1001)).toBe('/run/user/1001/bus')
    expect(sessionBusPath('tcp:host=localhost,port=1', 1000)).toBeUndefined()
  })
})
