import { expect, it } from 'vitest'
import { frameObservationResult } from '../src/main/mcp/frame-observation-result.js'
import { FRAME_OBSERVATION_LIMITS, type BrowserFrameSnapshot } from '../src/shared/frame-observation.js'
it('caps the whole duplicated escaped UTF-8 MCP envelope with truthful omission',()=>{
  const snapshot:BrowserFrameSnapshot={kind:'frame-observation',formatVersion:1,captureId:'id',scope:'direct-child-viewport',text:'"\\😀'.repeat(4000),untrusted:true,completeness:{complete:true,omissions:[],absenceNotEstablished:true},limits:FRAME_OBSERVATION_LIMITS}
  const result=frameObservationResult(snapshot)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768)
  expect(snapshot.completeness).toEqual({complete:false,omissions:['envelope-limit'],absenceNotEstablished:true})
  expect(result.content).toEqual([{type:'text',text:snapshot.text}])
})
