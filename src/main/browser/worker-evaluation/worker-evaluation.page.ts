/** What the wrapper gives back for the script's value. */
type WorkerEvaluationAnswer =
  | { kind: 'undefined' }
  | { kind: 'unserializable' }
  | { kind: 'truncated'; text: string; totalChars: number }
  | { kind: 'json'; text: string }

/**
 * Runs in the worker: evaluates the script in the worker's global scope and gives its value as JSON text, cut at
 * `limit` characters, which crosses the protocol whatever its size.
 */
export async function workerResultInPage(script: string, limit: number): Promise<WorkerEvaluationAnswer> {
  const value: unknown = await (0, eval)(script)
  if (value === undefined) return { kind: 'undefined' }
  let text
  try { text = JSON.stringify(value) } catch { return { kind: 'unserializable' } }
  if (typeof text !== 'string') return { kind: 'unserializable' }
  return text.length > limit ? { kind: 'truncated', text: text.slice(0, limit), totalChars: text.length } : { kind: 'json', text }
}
