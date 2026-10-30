import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionBusPath, watchStatusNotifierWatcher } from '../src/main/attention/status-notifier-watcher.js'

const WATCHER = 'org.kde.StatusNotifierWatcher'
const BUS = 'org.freedesktop.DBus'
const SIGNAL = 4
const METHOD_RETURN = 2
const ERROR = 3

/** A message from the bus in D-Bus wire format, in either byte order, whose arguments are strings. */
function busMessage(options: {
  type?: number
  member?: string
  path?: string
  interface?: string
  sender?: string
  errorName?: string
  args?: readonly string[]
  little?: boolean
}): Buffer {
  const { type = SIGNAL, args = [], little = true } = options
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
  bytes.push(little ? 0x6c : 0x42, type, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  const fields: Array<[number, string, string | undefined]> = [
    [1, 'o', options.path], [2, 's', options.interface], [3, 's', options.member], [4, 's', options.errorName],
    [5, 'u', type === SIGNAL ? undefined : '2'], [6, 's', ':1.5'], [7, 's', options.sender ?? BUS],
    [8, 'g', args.length ? 's'.repeat(args.length) : undefined]
  ]
  for (const [code, fieldType, value] of fields) {
    if (value === undefined) continue
    align(8)
    bytes.push(code)
    signature(fieldType)
    if (fieldType === 'g') signature(value)
    else if (fieldType === 'u') uint32(Number(value))
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

const ownerChanged = (args: readonly string[], options: { sender?: string; little?: boolean } = {}) =>
  busMessage({ member: 'NameOwnerChanged', path: '/org/freedesktop/DBus', interface: BUS, args, ...options })
const hostRegistered = () =>
  busMessage({ member: 'StatusNotifierHostRegistered', path: '/StatusNotifierWatcher', interface: WATCHER, sender: ':1.30' })

/** The members of the method calls in what the watch sent after BEGIN, checking that their lengths cover it exactly. */
function sentCalls(sent: Buffer): string[] {
  let offset = sent.indexOf('BEGIN\r\n') + 'BEGIN\r\n'.length
  const members: string[] = []
  while (offset < sent.length) {
    expect(String.fromCharCode(sent[offset]!)).toBe('l')
    expect(sent[offset + 1]).toBe(1)
    const fieldsLength = sent.readUInt32LE(offset + 12)
    const length = Math.ceil((16 + fieldsLength) / 8) * 8 + sent.readUInt32LE(offset + 4)
    const message = sent.subarray(offset, offset + length)
    expect(message.length).toBe(length)
    members.push(['Hello', 'AddMatch'].find(member => message.includes(member)) ?? '?')
    offset += length
  }
  expect(offset).toBe(sent.length)
  return members
}

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
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
  const sent = () => Buffer.concat(chunks)
  const received = () => sent().toString('latin1')
  return { address: `unix:path=${path}`, connected, sent, received, closed }
}

/** A watch the bus has accepted, after it asked for its signals. */
async function acceptedWatch(started = vi.fn()) {
  const bus = await fakeBus()
  const stop = watchStatusNotifierWatcher(started, { address: bus.address, uid: 1000 })
  const socket = await bus.connected
  await vi.waitFor(() => expect(bus.received()).toBe('\0AUTH EXTERNAL 31303030\r\n'))
  socket.write('OK 0123456789abcdef0123456789abcdef\r\n')
  await vi.waitFor(() => expect(bus.received().split('AddMatch')).toHaveLength(3))
  return { bus, socket, started, stop }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 400))

describe('following the desktop tray on the session bus', () => {
  it('authenticates as the user and asks only for the tray’s change of owner and its host registering', async () => {
    const { bus, stop } = await acceptedWatch()
    expect(bus.received()).toContain('\r\nBEGIN\r\n')
    expect(sentCalls(bus.sent())).toEqual(['Hello', 'AddMatch', 'AddMatch'])
    expect(bus.received()).toContain(`type='signal',sender='${BUS}',interface='${BUS}',member='NameOwnerChanged',arg0='${WATCHER}'`)
    expect(bus.received()).toContain(
      `type='signal',sender='${WATCHER}',interface='${WATCHER}',path='/StatusNotifierWatcher',member='StatusNotifierHostRegistered'`
    )
    stop()
    await vi.waitFor(() => expect(bus.closed).toHaveBeenCalled())
  })

  it('reports a tray that takes its name or registers its host, once for signals that come together', async () => {
    const { socket, started } = await acceptedWatch()
    // What the bus sends any connection: the replies to Hello and AddMatch, the name it was given, and an error.
    socket.write(Buffer.concat([
      busMessage({ type: METHOD_RETURN, args: [':1.5'] }),
      busMessage({ member: 'NameAcquired', path: '/org/freedesktop/DBus', interface: BUS, args: [':1.5'] }),
      busMessage({ type: METHOD_RETURN }),
      busMessage({ type: ERROR, errorName: 'org.freedesktop.DBus.Error.MatchRuleInvalid', args: ['Invalid rule'] })
    ]))
    socket.write(ownerChanged(['org.example.Other', '', ':1.7']))
    socket.write(ownerChanged([WATCHER, ':1.8', '']))
    // Only the bus itself announces a change of owner.
    socket.write(ownerChanged([WATCHER, '', ':1.9'], { sender: ':1.40' }))
    await settled()
    expect(started).not.toHaveBeenCalled()

    // A signal the bus sends in pieces counts once it is whole.
    for (const byte of ownerChanged([WATCHER, '', ':1.9'])) socket.write(Buffer.from([byte]))
    socket.write(hostRegistered())
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
    await settled()
    expect(started).toHaveBeenCalledOnce()

    socket.write(hostRegistered())
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
    await settled()
    socket.write(ownerChanged([WATCHER, '', ':1.10'], { little: false }))
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(3))
  })

  it('keeps following the tray when showing the icon fails, and reports nothing after it stops', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const started = vi.fn(() => { throw new Error('No tray') })
    const { socket, stop } = await acceptedWatch(started)
    socket.write(hostRegistered())
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
    socket.write(hostRegistered())
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
    socket.write(hostRegistered())
    await new Promise(resolve => setTimeout(resolve, 50))
    stop()
    await settled()
    expect(started).toHaveBeenCalledTimes(2)
  })

  it('ends when the bus refuses it or sends what is not a D-Bus message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refused = await fakeBus()
    const started = vi.fn()
    watchStatusNotifierWatcher(started, { address: refused.address, uid: 1000 })
    ;(await refused.connected).write('REJECTED EXTERNAL\r\n')
    await vi.waitFor(() => expect(refused.closed).toHaveBeenCalled())
    expect(refused.received()).not.toContain('BEGIN')
    expect(warn).toHaveBeenCalledWith(expect.any(String), 'the bus refused the connection')

    const garbled = await acceptedWatch(started)
    garbled.socket.write(Buffer.alloc(16, 0x7a))
    await vi.waitFor(() => expect(garbled.bus.closed).toHaveBeenCalled())

    const oversized = await acceptedWatch(started)
    oversized.socket.write(ownerChanged([WATCHER, '', ':1.11', 'x'.repeat(70_000)]))
    await vi.waitFor(() => expect(oversized.bus.closed).toHaveBeenCalled())
    await settled()
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
