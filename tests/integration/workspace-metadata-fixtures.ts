import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from './fixtures.js'

export const privateMarker = 'synthetic-private-metadata-marker'
export type Scope = typeof globalThis & { metadataFixture: { notice?: { title: string; message: string; detail: string; buttons: string[] }; resolve?: () => void; held?: boolean; releaseRead?: () => void; renames?: number } }
export async function launchRejected(profile: string, port: number, late = false, failDialog = false, holdRead = false, failSave?: 'before' | 'after' | 'held'): Promise<ElectronApplication> {
  const hook = join(profile, 'metadata-hook.cjs')
  // This disposable hook observes the native dialog API, not the app's parser.
  // No production test switch, metadata parsing or error classification is mocked.
  await writeFile(hook, `const {dialog,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');
globalThis.metadataFixture={};
process.on('uncaughtExceptionMonitor',e=>require('node:fs').appendFileSync(path.join(process.env.HRONAUT_USER_DATA_DIR,'fixture-errors.log'),String(e.stack)));

dialog.showMessageBox=async (...args)=>{const o=args.at(-1);globalThis.metadataFixture.notice={title:o.title,message:o.message,detail:o.detail,buttons:o.buttons};
await new Promise(resolve=>globalThis.metadataFixture.resolve=resolve);
${failDialog ? "throw new Error('synthetic dialog unavailable');" : 'return {response:0,checkboxChecked:false};'}};
${failSave ? `const rename=fs.rename;fs.rename=async function(from,to){if(String(to)===path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json')){globalThis.metadataFixture.renames=(globalThis.metadataFixture.renames||0)+1;${failSave === 'held' ? 'globalThis.metadataFixture.held=true;await new Promise(resolve=>globalThis.metadataFixture.releaseRead=resolve);' : ''}${failSave === 'after' ? 'await rename.call(this,from,to);' : ''}throw new Error('synthetic save failure')}return rename.call(this,from,to)};require('node:module').syncBuiltinESMExports();` : ''}
${holdRead ? `const read=fs.readFile;let count=0;fs.readFile=async function(file,...args){if(String(file)===path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json')&&++count===2){globalThis.metadataFixture.held=true;await new Promise(resolve=>globalThis.metadataFixture.releaseRead=resolve)}return read.call(this,file,...args)};require('node:module').syncBuiltinESMExports();` : ''}
${late ? `const load=BrowserWindow.prototype.loadFile;BrowserWindow.prototype.loadFile=async function(...args){const result=await load.apply(this,args);await fs.writeFile(path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json'),'{${privateMarker}');return result};` : ''}
`)
  return electron.launch({ args: ['--require', hook, '.'], cwd: process.cwd(), env: {
    ...process.env, HRONAUT_USER_DATA_DIR: profile, HRONAUT_DOWNLOAD_DIR: profile, HRONAUT_MCP_PORT: String(port), HRONAUT_MCP_HOST: '127.0.0.1'
  } })
}
export async function quitNotice(app: ElectronApplication, natural = false): Promise<void> {
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => app.process().once('exit', (code, signal) => resolve({ code, signal })))
  await app.evaluate(({ app }, natural) => { if (natural) setImmediate(() => app.quit()); else (globalThis as Scope).metadataFixture.resolve!() }, natural)
  expect(await exited).toEqual({ code: 0, signal: null })
}

