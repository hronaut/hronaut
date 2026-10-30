import { connect } from 'node:net'

/** The session bus name a desktop's tray takes, through which tray icons register with it. */
const WATCHER_NAME = 'org.kde.StatusNotifierWatcher'
const BUS_NAME = 'org.freedesktop.DBus'
const BUS_PATH = '/org/freedesktop/DBus'
/** The bus tells us only when the tray's name changes owner. */
const MATCH_RULE = `type='signal',sender='${BUS_NAME}',interface='${BUS_NAME}',member='NameOwnerChanged',arg0='${WATCHER_NAME}'`
/** A message from the bus larger than this ends the watch; the signals it sends are a few hundred bytes. */
const MAX_MESSAGE_BYTES = 64 * 1024
const METHOD_CALL = 1
const SIGNAL = 4

/**
 * Calls `onTrayStarted` each time a desktop's tray starts, as a StatusNotifierWatcher taking its name on the session
 * bus, such as a panel that starts after Hronaut opened at login, or one restarting. Chromium places Hronaut's tray
 * icon in the desktop's tray only if one runs when the icon is created, and otherwise in an older kind of tray that
 * current desktops no longer show, so the icon has to be created again then. The watch only reads the bus: it sends
 * the bus's Hello and asks it for this one signal. It ends quietly when the bus is unavailable, and on `stop`.
 */
export function watchStatusNotifierWatcher(onTrayStarted: () => void, options: {
  address?: string | undefined
  uid?: number
} = {}): () => void {
  const uid = options.uid ?? process.getuid?.() ?? 0
  const path = sessionBusPath(options.address ?? process.env.DBUS_SESSION_BUS_ADDRESS, uid)
  if (!path) return () => undefined
  const socket = connect({ path })
  socket.unref()
  let stopped = false
  const stop = (): void => {
    stopped = true
    socket.destroy()
  }
  socket.on('error', (error) => {
    if (!stopped) console.warn('[tray] Could not follow the desktop tray on the session bus:', error.message)
    stop()
  })
  // The bus authenticates the connection as the user who opened it, from the socket's credentials.
  socket.write(`\0AUTH EXTERNAL ${Buffer.from(String(uid)).toString('hex')}\r\n`)
  let authenticated = false
  let received = Buffer.alloc(0)
  socket.on('data', (chunk: Buffer) => {
    received = Buffer.concat([received, chunk])
    if (!authenticated) {
      const lineEnd = received.indexOf('\r\n')
      if (lineEnd < 0) {
        if (received.length > 512) stop()
        return
      }
      if (!received.subarray(0, lineEnd).toString('latin1').startsWith('OK ')) {
        stop()
        return
      }
      authenticated = true
      received = received.subarray(lineEnd + 2)
      socket.write(Buffer.concat([
        Buffer.from('BEGIN\r\n'),
        methodCall(1, 'Hello', []),
        methodCall(2, 'AddMatch', [MATCH_RULE])
      ]))
    }
    for (;;) {
      const message = nextMessage(received)
      if (message === 'invalid') {
        stop()
        return
      }
      if (!message) return
      received = received.subarray(message.length)
      if (message.type === SIGNAL && message.member === 'NameOwnerChanged' && message.args[0] === WATCHER_NAME && message.args[2]) {
        onTrayStarted()
      }
      if (stopped) return
    }
  })
  return stop
}

/**
 * The socket of the session bus at a D-Bus address, such as `unix:path=/run/user/1000/bus`, or the one systemd
 * provides for the user when there is no address.
 */
export function sessionBusPath(address: string | undefined, uid: number): string | undefined {
  if (!address) return `/run/user/${uid}/bus`
  for (const entry of address.split(';')) {
    const separator = entry.indexOf(':')
    if (entry.slice(0, separator) !== 'unix') continue
    const values = new Map(entry.slice(separator + 1).split(',').map((pair) => {
      const equals = pair.indexOf('=')
      return [pair.slice(0, equals), unescapeAddressValue(pair.slice(equals + 1))] as const
    }))
    const path = values.get('path')
    if (path) return path
    const abstract = values.get('abstract')
    if (abstract) return `\0${abstract}`
  }
  return undefined
}

/** D-Bus escapes a byte of an address value as %XX. */
function unescapeAddressValue(value: string): string {
  return value.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/** A call to the bus itself, in little-endian D-Bus wire format, whose arguments are all strings. */
function methodCall(serial: number, member: string, args: readonly string[]): Buffer {
  const body = new WireWriter()
  for (const arg of args) body.string(arg)
  const fields = new WireWriter()
  const field = (code: number, type: 'o' | 's' | 'g', value: string): void => {
    fields.align(8)
    fields.byte(code)
    fields.signature(type)
    if (type === 'g') fields.signature(value)
    else fields.string(value)
  }
  field(1, 'o', BUS_PATH)
  field(2, 's', BUS_NAME)
  field(3, 's', member)
  field(6, 's', BUS_NAME)
  if (args.length) field(8, 'g', 's'.repeat(args.length))
  const header = new WireWriter()
  header.byte('l'.charCodeAt(0))
  header.byte(METHOD_CALL)
  header.byte(0)
  header.byte(1)
  header.uint32(body.length)
  header.uint32(serial)
  header.uint32(fields.length)
  header.bytes(fields.buffer())
  header.align(8)
  return Buffer.concat([header.buffer(), body.buffer()])
}

class WireWriter {
  private readonly parts: number[] = []
  get length(): number {
    return this.parts.length
  }
  align(size: number): void {
    while (this.parts.length % size) this.parts.push(0)
  }
  byte(value: number): void {
    this.parts.push(value)
  }
  bytes(values: Buffer): void {
    for (const value of values) this.parts.push(value)
  }
  uint32(value: number): void {
    this.align(4)
    this.parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }
  string(value: string): void {
    const encoded = Buffer.from(value, 'utf8')
    this.uint32(encoded.length)
    this.bytes(encoded)
    this.parts.push(0)
  }
  signature(value: string): void {
    this.parts.push(value.length)
    this.bytes(Buffer.from(value, 'latin1'))
    this.parts.push(0)
  }
  buffer(): Buffer {
    return Buffer.from(this.parts)
  }
}

/**
 * The first whole message in `data`: its length, type, member and string arguments. Undefined while more bytes are
 * needed, and 'invalid' for bytes that are not a D-Bus message or one too large.
 */
function nextMessage(data: Buffer): { length: number; type: number; member?: string; args: string[] } | 'invalid' | undefined {
  if (data.length < 16) return undefined
  const endian = String.fromCharCode(data[0]!)
  if (endian !== 'l' && endian !== 'B') return 'invalid'
  const little = endian === 'l'
  const uint32 = (offset: number): number => little ? data.readUInt32LE(offset) : data.readUInt32BE(offset)
  const fieldsLength = uint32(12)
  const bodyStart = align(16 + fieldsLength, 8)
  const length = bodyStart + uint32(4)
  if (fieldsLength > MAX_MESSAGE_BYTES || length > MAX_MESSAGE_BYTES) return 'invalid'
  if (data.length < length) return undefined
  try {
    let offset = 16
    let member: string | undefined
    let signature = ''
    const readString = (): string => {
      offset = align(offset, 4)
      const size = uint32(offset)
      const value = data.toString('utf8', offset + 4, offset + 4 + size)
      offset += 4 + size + 1
      return value
    }
    const readSignature = (): string => {
      const size = data[offset]!
      const value = data.toString('latin1', offset + 1, offset + 1 + size)
      offset += size + 2
      return value
    }
    while (offset < 16 + fieldsLength) {
      offset = align(offset, 8)
      const code = data[offset]!
      offset += 1
      const type = readSignature()
      if (type === 's' || type === 'o') {
        const value = readString()
        if (code === 3) member = value
      } else if (type === 'g') {
        const value = readSignature()
        if (code === 8) signature = value
      } else if (type === 'u') {
        offset = align(offset, 4) + 4
      } else {
        return 'invalid'
      }
    }
    const args: string[] = []
    offset = bodyStart
    if (/^s+$/.test(signature)) for (let index = 0; index < signature.length; index += 1) args.push(readString())
    return { length, type: data[1]!, ...(member === undefined ? {} : { member }), args }
  } catch {
    return 'invalid'
  }
}

function align(offset: number, size: number): number {
  return Math.ceil(offset / size) * size
}
