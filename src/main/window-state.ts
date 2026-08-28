import { readFile } from 'node:fs/promises'
import type { Rectangle } from 'electron'
import { writeTextFileAtomically } from './atomic-file.js'

export interface SavedWindowState {
  bounds: Rectangle
  displayId: number
  maximized: boolean
  fullScreen: boolean
}

export interface DisplayLike {
  id: number
  workArea: Rectangle
}

const isRectangle = (value: unknown): value is Rectangle => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Rectangle>
  return [candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite)
}

export class WindowStateStore {
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<SavedWindowState | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const value = parsed as Partial<SavedWindowState>
      if (!isRectangle(value.bounds) || !Number.isFinite(value.displayId)) return null
      return {
        bounds: value.bounds,
        displayId: value.displayId!,
        maximized: value.maximized === true,
        fullScreen: value.fullScreen === true
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      return null
    }
  }

  save(state: SavedWindowState): Promise<void> {
    const contents = `${JSON.stringify(state, null, 2)}\n`
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, contents)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}

export function restoreWindowBounds(
  saved: SavedWindowState | null,
  displays: DisplayLike[],
  fallback: { width: number; height: number }
): Rectangle {
  const primary = displays[0]
  if (!primary) return { x: 0, y: 0, ...fallback }

  const target = saved ? displays.find((display) => display.id === saved.displayId) : undefined
  if (!saved || !target || saved.bounds.width < 320 || saved.bounds.height < 240) {
    return centeredBounds(primary.workArea, fallback)
  }

  const width = Math.min(saved.bounds.width, target.workArea.width)
  const height = Math.min(saved.bounds.height, target.workArea.height)
  return {
    x: clamp(saved.bounds.x, target.workArea.x, target.workArea.x + target.workArea.width - width),
    y: clamp(saved.bounds.y, target.workArea.y, target.workArea.y + target.workArea.height - height),
    width,
    height
  }
}

function centeredBounds(workArea: Rectangle, fallback: { width: number; height: number }): Rectangle {
  const width = Math.min(fallback.width, workArea.width)
  const height = Math.min(fallback.height, workArea.height)
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}
