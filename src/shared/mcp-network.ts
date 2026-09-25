/** Only explicit profile opt-in may widen the listener beyond loopback. */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

export function mcpLocalHost(host: string): string {
  return host === '0.0.0.0' ? '127.0.0.1' : host === '::1' ? '[::1]' : host
}
