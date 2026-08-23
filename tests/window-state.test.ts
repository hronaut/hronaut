import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  restoreWindowBounds,
  type DisplayLike,
  type SavedWindowState,
  WindowStateStore
} from '../src/main/window-state.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const displays: DisplayLike[] = [
  { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1440 } }
]

describe('restoreWindowBounds', () => {
  it('restores the saved position on the same display', () => {
    const saved: SavedWindowState = {
      bounds: { x: 2200, y: 180, width: 1400, height: 900 },
      displayId: 2,
      maximized: false,
      fullScreen: false
    }
    expect(restoreWindowBounds(saved, displays, { width: 1200, height: 800 })).toEqual(saved.bounds)
  })

  it('keeps an oversized or partially off-screen window inside the display', () => {
    const saved: SavedWindowState = {
      bounds: { x: 4300, y: 1300, width: 3000, height: 2000 },
      displayId: 2,
      maximized: false,
      fullScreen: false
    }
    expect(restoreWindowBounds(saved, displays, { width: 1200, height: 800 })).toEqual({
      x: 1920,
      y: 0,
      width: 2560,
      height: 1440
    })
  })

  it('centers on the primary display when the saved display is disconnected', () => {
    const saved: SavedWindowState = {
      bounds: { x: 3000, y: 100, width: 1200, height: 800 },
      displayId: 99,
      maximized: false,
      fullScreen: false
    }
    expect(restoreWindowBounds(saved, displays, { width: 1200, height: 800 })).toEqual({
      x: 360,
      y: 140,
      width: 1200,
      height: 800
    })
  })
})

describe('WindowStateStore', () => {
  it('serializes concurrent saves and keeps the last queued window state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-window-state-test-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'profile', 'window-state.json')
    const store = new WindowStateStore(path)
    const states = Array.from({ length: 20 }, (_value, index): SavedWindowState => ({
      bounds: { x: index, y: index, width: 1_200 + index, height: 800 + index },
      displayId: 1,
      maximized: index % 2 === 0,
      fullScreen: false
    }))

    await Promise.all(states.map((state) => store.save(state)))

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(states.at(-1))
  })
})
