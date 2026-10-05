import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { FRAME_OBSERVATION_LIMITS, type BrowserFrameSnapshot } from '../../shared/frame-observation.js'
/** Account for BOTH representations, JSON escaping and the final MCP envelope. */
export function frameObservationResult(snapshot: BrowserFrameSnapshot): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: snapshot.text }], structuredContent: { ...snapshot } }
  const size = (): number => Buffer.byteLength(JSON.stringify(result), 'utf8')
  while (size() > FRAME_OBSERVATION_LIMITS.envelopeBytes && snapshot.text.length) {
    snapshot.text = snapshot.text.slice(0, Math.floor(snapshot.text.length * 0.8))
    snapshot.completeness.complete = false
    if (!snapshot.completeness.omissions.includes('envelope-limit')) snapshot.completeness.omissions.push('envelope-limit')
    result.content = [{ type: 'text', text: snapshot.text }]
    result.structuredContent = { ...snapshot }
  }
  if (size() > FRAME_OBSERVATION_LIMITS.envelopeBytes) throw new Error('Frame observation envelope unavailable')
  return result
}
