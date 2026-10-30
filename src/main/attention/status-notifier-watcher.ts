import { connect } from 'node:net'

/** The session bus name a desktop's tray takes, through which tray icons register with it, and its object. */
const WATCHER_NAME = 'org.kde.StatusNotifierWatcher'
const WATCHER_PATH = '/StatusNotifierWatcher'
const BUS_NAME = 'org.freedesktop.DBus'
const BUS_PATH = '/org/freedesktop/DBus'
/**
 * The bus tells us only when the tray's name changes owner, and when the tray says the part of the desktop that shows
 * its icons registered, which on KDE Plasma can come after its name.
 */
const MATCH_RULES = [
  `type='signal',sender='${BUS_NAME}',interface='${BUS_NAME}',member='NameOwnerChanged',arg0='${WATCHER_NAME}'`,
  `type='signal',sender='${WATCHER_NAME}',interface='${WATCHER_NAME}',path='${WATCHER_PATH}',member='StatusNotifierHostRegistered'`
]
/** Signals that come this close together, such as a tray taking its name and registering its host, are one start. */
const SETTLE_MS = 250
/** A message from the bus larger than this ends the watch; the signals it sends are a few hundred bytes. */
const MAX_MESSAGE_BYTES = 64 * 1024
const METHOD_CALL = 1
const SIGNAL = 4
/** The header fields the watch reads, by their D-Bus field codes. */
const STRING_FIELDS: Partial<Record<number, 'path' | 'interface' | 'member' | 'sender'>> = { 1: 'path', 2: 'interface', 3: 'member', 7: 'sender' }

/**
 * Calls `onTrayStarted` each time a desktop's tray starts, as a StatusNotifierWatcher taking its name on the session
 * bus or registering the host that shows its icons, such as a panel that starts after Hronaut opened at login, or one
 * restarting. Chromium places Hronaut's tray icon in the desktop's tray only if both are there when the icon is
 * created, and otherwise in an older kind of tray that current desktops no longer show, so the icon has to be created
 * again then. The watch only reads the bus: it sends the bus's Hello and asks it for these two signals. It ends when
 * the bus is unavailable or refuses it, with a warning, and quietly on anything else it cannot read, and on `stop`.
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
  let settling: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    stopped = true
    clearTimeout(settling)
    socket.destroy()
  }
  const warn = (reason: string): void => {
    if (!stopped) console.warn('[tray] Could not follow the desktop tray on the session bus:', reason)
    stop()
  }
  socket.on('error', (error) => warn(error.message))
  const trayStarted = (): void => {
    if (settling) return
    settling = setTimeout(() => {
      settling = undefined
      if (stopped) return
      try {
        onTrayStarted()
      } catch (error) {
        console.error('[tray] Could not show the tray icon in the desktop tray:', error)
      }
    }, SETTLE_MS)
    settling.unref()
  }
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
        warn('the bus refused the connection')
        return
      }
      authenticated = true
      received = received.subarray(lineEnd + 2)
      socket.write(Buffer.concat([
        Buffer.from('BEGIN\r\n'),
        methodCall(1, 'Hello', []),
        ...MATCH_RULES.map((rule, index) => methodCall(2 + index, 'AddMatch', [rule]))
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
      if (message.type !== SIGNAL) continue
      // The bus itself sends the change of owner; another program on the bus could only send it to Hronaut alone.
      const named = message.member === 'NameOwnerChanged' && message.sender === BUS_NAME && message.interface === BUS_NAME
        && message.args[0] === WATCHER_NAME && Boolean(message.args[2])
      const hostRegistered = message.member === 'StatusNotifierHostRegistered' && message.interface === WATCHER_NAME
        && message.path === WATCHER_PATH
      if (named || hostRegistered) trayStarted()
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

/** A message from the bus: its length in bytes, type, the header fields the watch reads and its string arguments. */
interface BusMessage {
  length: number
  type: number
  path?: string
  interface?: string
  member?: string
  sender?: string
  args: string[]
}

/**
 * The first whole message in `data`: its length, type, member and string arguments. Undefined while more bytes are
 * needed, and 'invalid' for bytes that are not a D-Bus message or one too large.
 */
function nextMessage(data: Buffer): BusMessage | 'invalid' | undefined {
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
    const fields: Partial<Record<'path' | 'interface' | 'member' | 'sender', string>> = {}
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
        const name = STRING_FIELDS[code]
        if (name) fields[name] = value
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
    return { length, type: data[1]!, ...fields, args }
  } catch {
    return 'invalid'
  }
}

function align(offset: number, size: number): number {
  return Math.ceil(offset / size) * size
}
