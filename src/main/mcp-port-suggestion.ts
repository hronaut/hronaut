import { createServer } from 'node:net'
import { isValidMcpPort } from '../shared/mcp-port.js'
import type { McpListenErrorCode, McpPortMoveResult } from '../shared/types.js'

/** Why the listener could not start, in the few kinds Hronaut can explain and offer a fix for. */
export function mcpListenErrorCode(error: unknown): McpListenErrorCode {
  // setMcpPort wraps the listen error in its own message and keeps the original as the cause.
  for (let current = error, depth = 0; typeof current === 'object' && current !== null && depth < 3; current = (current as Error).cause, depth++) {
    const code = (current as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') return 'port-in-use'
    if (code === 'EACCES' || code === 'EPERM') return 'port-denied'
  }
  return 'other'
}

/** Binds a throwaway listener on `port` (0 lets the system choose), drops any connection unread and closes once bound. */
function probe(port: number, host: string, timeoutMs: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const server = createServer({ pauseOnConnect: true }, (socket) => socket.destroy())
    server.unref()
    const settle = (bound: number | undefined): void => {
      clearTimeout(timer)
      resolve(bound)
      if (server.listening) server.close()
    }
    // A probe that hears nothing counts as unavailable, so nothing can hold startup open.
    const timer = setTimeout(() => settle(undefined), timeoutMs)
    timer.unref()
    server.once('error', () => settle(undefined))
    server.listen({ port, host, exclusive: true }, () => {
      const address = server.address()
      settle(typeof address === 'object' && address ? address.port : undefined)
    })
  })
}

/** Whether `port` can be bound on `host` right now. */
export async function mcpPortAvailable(port: number, host: string, timeoutMs = 1_000): Promise<boolean> {
  return await probe(port, host, timeoutMs) === port
}

/** A port the operating system picks as free on `host`, for when no port near the configured one is. */
export async function mcpSystemPort(host: string, timeoutMs = 1_000): Promise<number | undefined> {
  const port = await probe(0, host, timeoutMs)
  return port !== undefined && isValidMcpPort(port) ? port : undefined
}

export interface McpPortProbes {
  available(port: number, host: string): Promise<boolean>
  system(host: string): Promise<number | undefined>
}

const defaultProbes: McpPortProbes = { available: (port, host) => mcpPortAvailable(port, host), system: (host) => mcpSystemPort(host) }

/**
 * The first port after `port`, at most 20 above it, that is free on the listener's own host. When none is (for example
 * inside a range Windows reserves), the operating system's choice of a free port is offered instead.
 */
export async function suggestMcpPort(port: number, host: string, probes: McpPortProbes = defaultProbes): Promise<number | undefined> {
  for (let next = port + 1; next <= port + 20; next++) {
    if (!isValidMcpPort(next)) break
    if (await probes.available(next, host)) return next
  }
  return probes.system(host)
}

export interface McpPortFailure {
  code: McpListenErrorCode
  port: number
  suggestedPort?: number
}

export interface McpPortRecoveryOptions {
  /** The listener's host, which can change with remote access. */
  host(): string
  /** Whether the listener is still down, so a late probe cannot bring back a failure that has been fixed. */
  failed(): boolean
  /** Starts the listener on `port` and saves it, as Apply port does. */
  listen(port: number): Promise<unknown>
  /** The offer changed without the listener moving. */
  changed(): void
  probes?: McpPortProbes
}

/**
 * Remembers why the listener could not start and moves it to the free port Hronaut offered. Only that exact port is
 * accepted, so a page cannot pick an arbitrary one, and requests for it while a move runs share that move.
 */
export class McpPortRecovery {
  #failure: McpPortFailure | undefined
  #generation = 0
  #moving: { port: number; result: Promise<McpPortMoveResult> } | undefined
  #dialog = new AbortController()

  constructor(private readonly options: McpPortRecoveryOptions) {}

  get failure(): McpPortFailure | undefined {
    return this.#failure
  }

  /** Aborts once the failure is cleared, so a dialog still offering a move can close itself. */
  get signal(): AbortSignal {
    return this.#dialog.signal
  }

  /** The listener started or the failure is replaced: forget it and close any dialog about it. */
  clear(): void {
    this.#generation += 1
    this.#failure = undefined
    this.#dialog.abort()
    this.#dialog = new AbortController()
  }

  /** Records why the listener could not start on `port`; a busy or refused port gets a free one to offer. */
  async record(error: unknown, port: number): Promise<McpPortFailure | undefined> {
    this.clear()
    const generation = this.#generation
    const code = mcpListenErrorCode(error)
    const suggestedPort = code === 'other' ? undefined : await suggestMcpPort(port, this.options.host(), this.options.probes)
    // A listener started from Settings while the probe ran wins over this older failure.
    if (generation !== this.#generation || !this.options.failed()) return undefined
    this.#failure = { code, port, ...(suggestedPort ? { suggestedPort } : {}) }
    return this.#failure
  }

  /** Moves the listener to the offered port. A port that is not the current offer changes nothing. */
  move(port: unknown): Promise<McpPortMoveResult> {
    if (this.#moving && this.#moving.port === port) return this.#moving.result
    const failure = this.#failure
    if (!this.options.failed() || !failure?.suggestedPort || port !== failure.suggestedPort) {
      return Promise.resolve({ outcome: 'not-offered' })
    }
    const result = this.#attempt(failure, failure.suggestedPort)
    const moving = { port: failure.suggestedPort, result }
    this.#moving = moving
    void result.finally(() => { if (this.#moving === moving) this.#moving = undefined })
    return result
  }

  async #attempt(failure: McpPortFailure, port: number): Promise<McpPortMoveResult> {
    const generation = this.#generation
    try {
      await this.options.listen(port)
      return { outcome: 'moved', port }
    } catch (error) {
      // Only a port taken or refused in the meantime calls for another offer; a failed save keeps this one.
      if (mcpListenErrorCode(error) === 'other') return { outcome: 'failed', port }
      const suggestedPort = await suggestMcpPort(port, this.options.host(), this.options.probes)
      if (generation === this.#generation && this.#failure === failure && this.options.failed()) {
        this.#failure = { code: failure.code, port: failure.port, ...(suggestedPort ? { suggestedPort } : {}) }
        this.options.changed()
      }
      return { outcome: 'taken', port }
    }
  }
}
