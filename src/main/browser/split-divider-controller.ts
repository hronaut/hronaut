import { randomUUID } from 'node:crypto'
import { normalizeSplitViewRatio, type SplitDividerGeometry, type SplitDividerSession } from '../../shared/split-view.js'

interface DividerOptions {
  read(): SplitDividerGeometry | null
  owns(geometry: SplitDividerGeometry): boolean
  apply(ratio: number, mode: 'preview' | 'commit' | 'cancel'): void
}

function sameArea(first: SplitDividerGeometry, second: SplitDividerGeometry): boolean {
  return first.revision === second.revision && first.firstTabId === second.firstTabId
    && first.secondTabId === second.secondTabId && first.orientation === second.orientation
    && first.scale === second.scale && first.gap === second.gap
    && first.area.x === second.area.x && first.area.y === second.area.y
    && first.area.width === second.area.width && first.area.height === second.area.height
}

/** Main-process ownership protects a replaced split from late renderer messages. */
export class SplitDividerController {
  private session: SplitDividerSession | null = null
  constructor(private readonly options: DividerOptions) {}

  persistedRatio(current: number): number {
    return this.session && this.options.owns(this.session.geometry) ? this.session.geometry.ratio : current
  }

  reconcile(): void {
    if (!this.session) return
    const current = this.options.read()
    if (!current || !sameArea(current, this.session.geometry)) this.cancel()
  }

  begin(revision: number): SplitDividerSession | null {
    const current = this.options.read()
    if (!current || current.revision !== revision) return null
    this.cancel()
    const geometry = this.options.read()!
    this.session = { token: randomUUID(), geometry }
    return this.session
  }

  update(token: string, ratio: number): SplitDividerGeometry | null {
    if (!Number.isFinite(ratio)) throw new TypeError('Split ratio must be finite.')
    this.reconcile()
    if (this.session?.token !== token) return null
    this.options.apply(normalizeSplitViewRatio(ratio), 'preview')
    return this.options.read()
  }

  finish(token: string, commit: boolean, ratio?: number): SplitDividerGeometry | null {
    if (ratio !== undefined && !Number.isFinite(ratio)) throw new TypeError('Split ratio must be finite.')
    this.reconcile()
    if (this.session?.token !== token) return null
    if (!commit) {
      this.cancel()
      return this.options.read()
    }
    const current = this.options.read()!
    this.session = null
    this.options.apply(normalizeSplitViewRatio(ratio ?? current.ratio), 'commit')
    return this.options.read()
  }

  setRatio(revision: number, ratio: number): SplitDividerGeometry | null {
    if (!Number.isFinite(ratio)) throw new TypeError('Split ratio must be finite.')
    const current = this.options.read()
    if (!current || current.revision !== revision) return null
    this.cancel()
    this.options.apply(normalizeSplitViewRatio(ratio), 'commit')
    return this.options.read()
  }

  cancel(): void {
    const session = this.session
    this.session = null
    if (session && this.options.owns(session.geometry)) this.options.apply(session.geometry.ratio, 'cancel')
  }
}
