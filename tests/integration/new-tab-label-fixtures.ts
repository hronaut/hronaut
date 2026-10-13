import type { ElectronApplication } from '@playwright/test'
export { test, expect, text } from './capability-fixtures.js'
export type LabelFaultMode = 'reject' | 'directory' | 'hold-write' | 'hold-rename' | 'hold-flush'
type Fault = { entered: boolean; committed: boolean; release(): void; restore(): void }
type Scope = typeof globalThis & { __creationLabelFault?: Fault }
export async function installLabelFault(app: ElectronApplication, profile: string, marker: string, mode: LabelFaultMode): Promise<void> {
  await app.evaluate((_electron, { profile, marker, mode }) => {
    const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module') as typeof import('node:module')
    const original = { writeFile: fs.writeFile, rename: fs.rename, open: fs.open }
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const state: Fault = { entered: false, committed: false, release, restore() { Object.assign(fs, original); syncBuiltinESMExports(); release() } }
    ;(globalThis as Scope).__creationLabelFault = state
    fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => {
      if (mode === 'hold-write' && String(args[0]).startsWith(`${profile}/tabs.json.`) && String(args[1]).includes(marker)) { state.entered = true; await gate }
      return original.writeFile(...args)
    }) as typeof fs.writeFile
    let directoryPending = false
    fs.rename = async (source, destination) => {
      const matches = String(destination) === `${profile}/tabs.json` && (await fs.readFile(source, 'utf8')).includes(marker)
      if (matches) {
        if (mode === 'reject') { state.entered = true; throw new Error('Synthetic creation label rejection') }
        if (mode === 'hold-rename') { state.entered = true; await gate }
      }
      await original.rename(source, destination)
      if (matches) { state.committed = true; directoryPending = true }
    }
    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      if (directoryPending && String(args[0]) === profile && args[1] === 'r') {
        directoryPending = false
        if (mode === 'directory') { state.entered = true; throw Object.assign(new Error('Synthetic directory failure'), { code: 'EIO' }) }
        if (mode === 'hold-flush') { state.entered = true; await gate }
      }
      return original.open(...args)
    }) as typeof fs.open
    syncBuiltinESMExports()
  }, { profile, marker, mode })
}
export const labelFault = (app: ElectronApplication) => app.evaluate(() => {
  const state = (globalThis as Scope).__creationLabelFault!
  return { entered: state.entered, committed: state.committed }
})
export const releaseLabelFault = (app: ElectronApplication) => app.evaluate(() => (globalThis as Scope).__creationLabelFault?.release())
export const restoreLabelFault = (app: ElectronApplication) => app.evaluate(() => { (globalThis as Scope).__creationLabelFault?.restore(); delete (globalThis as Scope).__creationLabelFault })
