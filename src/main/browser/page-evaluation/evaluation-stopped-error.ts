/**
 * An evaluation that stopped waiting for its script because its deadline passed or its call was cancelled. It lives
 * apart from the evaluation, whose focus guard imports Electron, so the MCP tool that catches it loads in plain Node too.
 */
export class EvaluationStoppedError extends Error {
  readonly reason: 'SCRIPT_TIMEOUT' | 'CANCELLED'
  /** Whether the script reached the page; false when the evaluation stopped before sending it. */
  readonly sent: boolean

  constructor(reason: 'SCRIPT_TIMEOUT' | 'CANCELLED', sent: boolean, timeoutMs: number) {
    const stopped = reason === 'SCRIPT_TIMEOUT' ? `The script did not finish within ${timeoutMs} ms` : 'The call was cancelled before the script finished'
    const unsent = reason === 'SCRIPT_TIMEOUT' ? `The ${timeoutMs} ms deadline passed before the script was sent` : 'The call was cancelled before the script was sent'
    super(sent ? `${stopped}. It may still be running in the page, so its effects are unknown.` : `${unsent}; nothing ran.`)
    this.name = 'EvaluationStoppedError'
    this.reason = reason
    this.sent = sent
  }
}
