import type { ReactInspectionLimit, ReactInspectionNode, ReactInspectionStatus } from '../../shared/react-inspection.js'

export interface ReactInspectionProtocolResult {
  result?: Remote | Property[]
  exceptionDetails?: unknown
}
interface Property { name: string; isOwn?: boolean; get?: unknown; set?: unknown; writable?: boolean; configurable?: boolean; value?: Remote }
export interface ReactInspectionChannel { send(method: string, params?: Record<string, unknown>): Promise<ReactInspectionProtocolResult> }
interface Observation { status: ReactInspectionStatus; nodes: ReactInspectionNode[]; limit?: ReactInspectionLimit; visited: number }
function remote(result: ReactInspectionProtocolResult): Remote {
  if (result.exceptionDetails || !result.result || Array.isArray(result.result)) throw new Error('React inspection operation rejected')
  return result.result
}
type Remote = { type: string; subtype?: string; objectId?: string; value?: unknown }
type Status = { state: ReactInspectionStatus; epoch: string; revision: number; roots: number; renderers: number }
function status(value: unknown): Status {
  if (!value || typeof value !== 'object') throw new Error('Invalid React inspection status')
  const state = value as Status
  if (!['renderer-not-observed','hook-conflict','unsupported-renderer','root-limit','disabled-reload-required'].includes(state.state)
    || typeof state.epoch !== 'string' || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isInteger(state.roots) || state.roots < 0 || state.roots > 16
    || !Number.isInteger(state.renderers) || state.renderers < 0 || state.renderers > 1) throw new Error('Invalid React inspection status')
  return state
}
async function evaluate(cdp: ReactInspectionChannel, expression: string, byValue = false): Promise<Remote> {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: byValue, objectGroup: 'react-proof', timeout: 1000 })
  if (result.exceptionDetails) throw new Error('probe evaluation failed')
  return remote(result)
}
async function captureApi(cdp: ReactInspectionChannel): Promise<Remote> {
  // Script-level `this` is the original global object, independent of the writable
  // globalThis binding. The bootstrap installs a nonconfigurable, nonwritable slot.
  const api = await evaluate(cdp, 'this.__hronautReactInspection')
  if (!api.objectId || api.subtype === 'proxy') throw new Error('proof API unavailable')
  const properties = await cdp.send('Runtime.getProperties', { objectId: api.objectId, ownProperties: true, generatePreview: false })
  for (const name of ['status', 'rootAt', 'rendererAt', 'read', 'id', 'disable']) {
    const property = Array.isArray(properties.result) ? properties.result.find(entry => entry.name === name) : undefined
    if (!property?.isOwn || property.get || property.set || property.writable !== false || property.configurable !== false || property.value?.type !== 'function') throw new Error('proof API integrity failed')
  }
  return api
}
async function invoke(cdp: ReactInspectionChannel, api: Remote, method: 'status' | 'rootAt' | 'rendererAt' | 'read' | 'id', args: Array<{objectId?: string; value?: unknown}> = [], byValue = false): Promise<Remote> {
  // Native callFunctionOn supplies `this`; direct calls use only verified frozen
  // own methods. No page-global name, .call/.apply, or mutable invocation helper.
  const declarations = {
    status: 'function() { return this.status(); }',
    rootAt: 'function(index) { return this.rootAt(index); }',
    rendererAt: 'function(index) { return this.rendererAt(index); }',
    read: 'function(object, field) { /* react-inspection-read */ return this.read(object, field); }',
    id: 'function(object) { return this.id(object); }'
  }
  const result = await cdp.send('Runtime.callFunctionOn', { objectId: api.objectId, functionDeclaration: declarations[method], arguments: args, returnByValue: byValue })
  if (result.exceptionDetails) throw new Error('proof operation rejected')
  return remote(result)
}
async function read(cdp: ReactInspectionChannel, api: Remote, object: Remote, field: string): Promise<Remote> {
  if (object.subtype === 'proxy') throw new Error('proxy excluded')
  if (!object.objectId) return { type: 'undefined' }
  return invoke(cdp, api, 'read', [{ objectId: object.objectId }, { value: field }])
}
async function id(cdp: ReactInspectionChannel, api: Remote, object: Remote): Promise<string> {
  if (object.subtype === 'proxy') throw new Error('proxy excluded')
  const value = (await invoke(cdp, api, 'id', [{ objectId: object.objectId }], true)).value
  if (typeof value !== 'string' || value.length > 160) throw new Error('Invalid React observation identity')
  return value
}
export async function observeReactTopology(cdp: ReactInspectionChannel, subtree: string | undefined, installationId: string): Promise<Observation> {
  const start = Date.now()
  const api = await captureApi(cdp)
  const state = status((await invoke(cdp, api, 'status', [], true)).value)
  if (state.epoch !== installationId) throw new Error('proof installation changed')
  if (state.state !== 'renderer-not-observed') return { status: state.state, nodes: [], visited: 0 }
  if (!state.renderers) return { status: 'renderer-not-observed', nodes: [], visited: 0 }
  const renderer = await invoke(cdp, api, 'rendererAt', [{value:0}])
  const version = await read(cdp, api, renderer, 'version')
  const name = await read(cdp, api, renderer, 'rendererPackageName')
  if (version.value !== '19.2.4' || name.value !== 'react-dom') return { status: 'unsupported-renderer', nodes: [], visited: 0 }
  if (subtree && !subtree.startsWith(`${state.epoch}/${state.revision}/`)) throw new Error('stale subtree')
  const nodes: {id:string; parent:string|null; name:string}[] = []
  const seen = new Set<string>()
  let visited = 0
  let limit: ReactInspectionLimit | undefined
  const stack: {fiber:Remote;parent:string|null;depth:number}[] = []
  for (let i = 0; i < state.roots; i++) stack.push({fiber:await read(cdp, api,await invoke(cdp,api,'rootAt',[{value:i}]),'current'),parent:null,depth:0})
  while (stack.length) {
    if (Date.now()-start > 2000) { limit='time';break }
    if (visited >= 256) { limit='visits';break }
    visited++
    const entry=stack.pop()!
    if (!entry.fiber.objectId) continue
    const key=await id(cdp,api,entry.fiber)
    if (seen.has(key)) { limit='cycle';break }
    seen.add(key)
    if (entry.depth>16) { limit='depth';break }
    const tag=(await read(cdp, api,entry.fiber,'tag')).value
    let parent=entry.parent
    if (tag===0 || tag===1 || tag===11 || tag===14 || tag===15) {
      const type=await read(cdp, api,entry.fiber,'type')
      let label='anonymous'
      if (type.objectId) {
        const display=await read(cdp, api,type,'displayName')
        const named=typeof display.value==='string' ? display : await read(cdp, api,type,'name')
        if(typeof named.value==='string' && named.value) label=named.value.slice(0,80)
      }
      if(nodes.length>=80) { limit='nodes';break }
      nodes.push({id:key,parent,name:label});parent=key
      if(Buffer.byteLength(JSON.stringify(nodes), 'utf8')>16000) { nodes.pop();limit='bytes';break }
    }
    const sibling=await read(cdp, api,entry.fiber,'sibling')
    const child=await read(cdp, api,entry.fiber,'child')
    if(sibling.objectId) stack.push({fiber:sibling,parent:entry.parent,depth:entry.depth})
    if(child.objectId) stack.push({fiber:child,parent,depth:entry.depth+1})
  }
  const final=status((await invoke(cdp,api,'status',[],true)).value)
  if(final.epoch!==state.epoch || final.revision!==state.revision || final.state!==state.state || final.roots!==state.roots || final.renderers!==state.renderers) throw new Error('observation changed')
  if(subtree && !nodes.some(n=>n.id===subtree)) throw new Error('stale subtree')
  let selected = nodes
  if (subtree) {
    const selectedIds = new Set([subtree])
    selected = nodes.filter(node => { if(node.parent && selectedIds.has(node.parent)) selectedIds.add(node.id); return selectedIds.has(node.id) })
    selected = selected.map(node => node.id === subtree ? {...node,parent:null} : node)
  }
  return {status:'ready',nodes:selected,limit,visited}
}
