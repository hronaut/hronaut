import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { observeReactTopology, type ReactInspectionChannel } from '../src/main/browser/react-inspection/react-inspection-observer.js'

const API_METHODS = ['status', 'rootAt', 'rendererAt', 'read', 'id', 'disable']

/**
 * A page whose React proof API reports one root with a single function component named App, as the protocol answers it.
 * Each read takes `elapsed` ms and moves the wall clock by `step` more, as when the computer's clock is corrected while
 * the walk runs.
 */
function reactPage(elapsed: number, step: number): ReactInspectionChannel {
  const objects: Record<string, Record<string, unknown>> = {
    renderer: { version: '19.2.4', rendererPackageName: 'react-dom' },
    root: { current: { objectId: 'fiber' } },
    fiber: { tag: 0, type: { objectId: 'type' } },
    type: { name: 'App' }
  }
  const remote = (value: unknown) => value && typeof value === 'object'
    ? { type: 'object', ...value }
    : value === undefined ? { type: 'undefined' } : { type: typeof value, value }
  return {
    async send(method, params = {}) {
      if (method === 'Runtime.evaluate') return { result: { type: 'object', objectId: 'api' } }
      if (method === 'Runtime.getProperties') {
        return { result: API_METHODS.map((name) => ({ name, isOwn: true, writable: false, configurable: false, value: { type: 'function' } })) }
      }
      const declaration = String(params.functionDeclaration)
      const args = params.arguments as Array<{ objectId?: string; value?: unknown }>
      if (declaration.includes('this.status()')) {
        return { result: { type: 'object', value: { state: 'renderer-not-observed', epoch: 'epoch', revision: 0, roots: 1, renderers: 1 } } }
      }
      if (declaration.includes('this.rendererAt(')) return { result: { type: 'object', objectId: 'renderer' } }
      if (declaration.includes('this.rootAt(')) return { result: { type: 'object', objectId: 'root' } }
      if (declaration.includes('this.id(')) return { result: { type: 'string', value: `epoch/0/${args[0]!.objectId}` } }
      if (declaration.includes('this.read(')) {
        vi.advanceTimersByTime(elapsed)
        vi.setSystemTime(Date.now() + step)
        return { result: remote(objects[args[0]!.objectId!]?.[String(args[1]!.value)]) }
      }
      throw new Error(`Unexpected protocol call ${method}`)
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

it('walks the component tree within its time limit when the wall clock steps forward', async () => {
  const observation = await observeReactTopology(reactPage(0, 3_600_000), undefined, 'epoch')
  expect(observation).toEqual({ status: 'ready', nodes: [{ id: 'epoch/0/fiber', parent: null, name: 'App' }], limit: undefined, visited: 1 })
})

it('stops the walk at its time limit when the wall clock steps back', async () => {
  // The renderer and root reads before the walk take three seconds.
  const observation = await observeReactTopology(reactPage(1_000, -3_600_000), undefined, 'epoch')
  expect(observation).toEqual({ status: 'ready', nodes: [], limit: 'time', visited: 0 })
})
