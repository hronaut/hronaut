import { describe, expect, it, vi } from 'vitest'
import { SplitDividerController } from '../src/main/browser/split-divider-controller.js'
import type { SplitDividerGeometry } from '../src/shared/split-view.js'

function fixture() {
  let visible = true
  const current: SplitDividerGeometry = { revision: 1, firstTabId: 'a', secondTabId: 'b', orientation: 'vertical', ratio: 0.5, bounds: { x: 494, y: 100, width: 12, height: 600 }, area: { x: 0, y: 100, width: 1000, height: 600 }, gap: 12, scale: 1 }
  const apply = vi.fn((ratio: number, mode: 'preview' | 'commit' | 'cancel') => {
    current.ratio = ratio
    if (mode === 'commit') current.revision++
  })
  const controller = new SplitDividerController({
    read: () => visible ? structuredClone(current) : null,
    owns: geometry => geometry.revision === current.revision && geometry.firstTabId === current.firstTabId && geometry.secondTabId === current.secondTabId && geometry.orientation === current.orientation,
    apply
  })
  return { controller, current, apply, hide: () => { visible = false } }
}

describe('main-owned split divider gestures', () => {
  it('previews live ratios while persisted snapshots retain the starting ratio until commit', () => {
    const { controller, current, apply } = fixture()
    const session = controller.begin(1)!
    expect(controller.update(session.token, 0.65)?.ratio).toBe(0.65)
    expect(controller.persistedRatio(current.ratio)).toBe(0.5)
    expect(apply).toHaveBeenLastCalledWith(0.65, 'preview')
    expect(controller.finish(session.token, true, 0.7)?.ratio).toBe(0.7)
    expect(controller.persistedRatio(current.ratio)).toBe(0.7)
    expect(apply).toHaveBeenLastCalledWith(0.7, 'commit')
    expect(controller.update(session.token, 0.25)).toBeNull()
  })

  it.each(['cancel', 'area', 'scale', 'lock'] as const)('restores an owned preview after %s', reason => {
    const { controller, current, hide } = fixture()
    const session = controller.begin(1)!
    controller.update(session.token, 0.65)
    if (reason === 'cancel') controller.finish(session.token, false)
    else {
      if (reason === 'area') current.area.width = 800
      if (reason === 'scale') current.scale = 1.25
      if (reason === 'lock') hide()
      controller.reconcile()
    }
    expect(current.ratio).toBe(0.5)
    expect(controller.finish(session.token, true, 0.7)).toBeNull()
  })

  it.each(['replaced', 'swapped', 'orientation'] as const)('never rolls back newer split state after it is %s', change => {
    const { controller, current } = fixture()
    const session = controller.begin(1)!
    controller.update(session.token, 0.6)
    current.revision++
    current.ratio = 0.4
    if (change === 'replaced') current.secondTabId = 'c'
    if (change === 'swapped') [current.firstTabId, current.secondTabId] = [current.secondTabId, current.firstTabId]
    if (change === 'orientation') current.orientation = 'horizontal'
    expect(controller.finish(session.token, false)).toBeNull()
    expect(current.ratio).toBe(0.4)
    expect(controller.update(session.token, 0.75)).toBeNull()
    expect(current.ratio).toBe(0.4)
  })

  it('rejects a stale begin without canceling a newer gesture', () => {
    const { controller, current } = fixture()
    current.revision = 2
    const session = controller.begin(2)!
    controller.update(session.token, 0.65)
    expect(controller.begin(1)).toBeNull()
    expect(current.ratio).toBe(0.65)
    expect(controller.finish(session.token, true)?.ratio).toBe(0.65)
  })

  it('clamps commits and keyboard changes and rejects stale keyboard revisions', () => {
    const { controller, current } = fixture()
    const session = controller.begin(1)!
    expect(controller.update(session.token, 2)?.ratio).toBe(0.75)
    expect(controller.finish(session.token, true, -1)?.ratio).toBe(0.25)
    expect(controller.setRatio(1, 0.5)).toBeNull()
    expect(current.ratio).toBe(0.25)
    expect(controller.setRatio(2, 0.5)?.ratio).toBe(0.5)
    expect(() => controller.setRatio(3, Number.NaN)).toThrow('finite')
  })
})
