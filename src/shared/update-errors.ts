export type UpdateOperation = 'check' | 'download' | 'install'

export function updateErrorMessage(
  error: unknown,
  operation: UpdateOperation | null,
  platform: string
): string {
  const message = error instanceof Error ? error.message : String(error)

  if (platform === 'linux' && operation === 'install' && /Command pkexec exited with code (126|127)/i.test(message)) {
    return 'System authorization did not complete. Hronaut is still running; try the installation again.'
  }

  if (platform === 'linux' && /Cannot read properties of undefined \(reading ['"]info['"]\)/i.test(message)) {
    return 'This release has no update package compatible with this Linux installation. Use the matching package from the Hronaut release page.'
  }

  return message
}
