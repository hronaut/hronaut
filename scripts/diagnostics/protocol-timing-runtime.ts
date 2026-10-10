// Test-only, serialized into an isolated pinned Playwright bundle. No imports or I/O.
export function createProtocolTiming() {
  const capacity = 2048
  const ring: number[][] = []
  let cursor = 0
  let total = 0
  let nextTransport = 0
  let nextReceive = 0
  let rejectedTransports = 0
  let observerErrors = 0
  const transports = new WeakMap<object, { id: number; channel: number }>()
  const messages = new WeakMap<object, number>()
  const clock = performance.now.bind(performance)
  // Own data properties only: never invoke protocol-object accessors.
  const field = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== 'object') return undefined
    return Object.getOwnPropertyDescriptor(value, key)?.value
  }
  const idOf = (value: unknown): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
  const methodOf = (value: unknown): number => {
    switch (value) {
      case 'Runtime.evaluate': return 1
      case 'Runtime.callFunctionOn': return 2
      case 'Runtime.executionContextCreated': return 3
      case 'Runtime.executionContextDestroyed': return 4
      case 'Runtime.executionContextsCleared': return 5
      case 'Target.attachedToTarget': return 6
      case 'Target.detachedFromTarget': return 7
      case 'Target.targetDestroyed': return 8
      case 'Inspector.targetCrashed': return 9
      default: return 0
    }
  }
  // [stage, transport, channel, request, receive, methodClass, monotonicMs]
  const record = (stage: number, owner: object, request = 0, receive = 0, method = 0, time = clock()) => {
    const transport = transports.get(owner)
    if (!transport || total === Number.MAX_SAFE_INTEGER || !Number.isFinite(time) || time < 0) return
    const row = [stage, transport.id, transport.channel, request, receive, method, time]
    if (ring.length < capacity) ring.push(row)
    else { ring[cursor] = row; cursor = (cursor + 1) % capacity }
    total++
  }
  // Observer failures cannot replace an upstream exception or prevent dispatch.
  const safe = <T>(work: () => T, fallback: T): T => { try { return work() } catch { observerErrors = Math.min(Number.MAX_SAFE_INTEGER, observerErrors + 1); return fallback } }
  return {
    register(owner: object, channel: number) {
      safe(() => {
        if ((channel !== 1 && channel !== 2) || transports.has(owner)) return
        if (nextTransport >= 64) { rejectedTransports = Math.min(Number.MAX_SAFE_INTEGER, rejectedTransports + 1); return }
        transports.set(owner, { id: ++nextTransport, channel })
      }, undefined)
    },
    send(owner: object, message: unknown, stage: number) {
      safe(() => {
        const id = idOf(field(message, 'id'))
        if (id && (stage === 1 || stage === 2 || stage === 3))
          record(stage, owner, id, 0, methodOf(field(message, 'method')))
      }, undefined)
    },
    raw(owner: object): readonly number[] | undefined {
      return safe(() => {
        if (!transports.has(owner) || nextReceive === Number.MAX_SAFE_INTEGER) return undefined
        return [++nextReceive, clock()]
      }, undefined)
    },
    parsed(owner: object, message: unknown, token: readonly number[] | undefined) {
      safe(() => {
        if (!token || !message || typeof message !== 'object' || Array.isArray(message)) return
        const rawId = field(message, 'id')
        if (rawId === -9999) return // Playwright browser-close sentinel is never retained.
        const id = idOf(rawId)
        const method = methodOf(field(message, 'method'))
        if (rawId !== undefined && !id) return
        if (token.length !== 2 || !idOf(token[0]) || typeof token[1] !== 'number' || !Number.isFinite(token[1]) || token[1] < 0) return
        const receive = token[0]!
        messages.set(message, receive)
        record(4, owner, id, receive, method, token[1])
        record(5, owner, id, receive, method)
      }, undefined)
    },
    callback(owner: object, message: unknown) {
      safe(() => {
        const id = idOf(field(message, 'id'))
        if (!id || !message || typeof message !== 'object') return
        const receive = messages.get(message)
        if (receive !== undefined) record(6, owner, id, receive)
      }, undefined)
    },
    lifecycle(owner: object, stage: number) {
      safe(() => { if (stage === 7 || stage === 8 || stage === 9) record(stage, owner) }, undefined)
    },
    snapshot() {
      return { capacity, total, transports: nextTransport, rejectedTransports, observerErrors, dropped: Math.max(0, total - capacity), rows: [...ring.slice(cursor), ...ring.slice(0, cursor)].map(row => [...row]) }
    }
  }
}
