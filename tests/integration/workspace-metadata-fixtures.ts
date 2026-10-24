import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from './fixtures.js'

export const privateMarker = 'synthetic-private-metadata-marker'
export type Scope = typeof globalThis & { metadataFixture: { notice?: { title: string; message: string; detail: string; buttons: string[] }; source?: 'window' | 'dialog'; resolve?: () => void; held?: boolean; releaseRead?: () => void; renames?: number } }
/** Which of the notice's ways to show fail: Hronaut's own window, or that window and the system dialog after it. */
export type NoticeFailure = 'window' | 'window-and-dialog'
export async function launchRejected(profile: string, port: number, late = false, failNotice?: NoticeFailure, holdRead = false, failSave?: 'before' | 'after' | 'held', probeReads = false): Promise<ElectronApplication> {
  const hook = join(profile, 'metadata-hook.cjs')
  // This disposable hook observes the notice window's page and the native dialog API, not the app's parser.
  // No production test switch, metadata parsing or error classification is mocked.
  await writeFile(hook, `const {dialog,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');
globalThis.metadataFixture={};
${probeReads ? `const {ipcMain}=require('electron');const handle=ipcMain.handle.bind(ipcMain);globalThis.startupReadProbe=[];
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
if(!['browser:get-state','split-divider:get','downloads:list','bookmarks:list','bookmark-collections:list','visit-history:list'].includes(channel))return listener(event,...args);
const record={channel,status:'pending',sender:event.sender.id};globalThis.startupReadProbe.push(record);
if(channel==='bookmarks:list')globalThis.replayStartupRead=async()=>{const replay={channel,status:'pending',replay:true};globalThis.startupReadProbe.push(replay);try{const value=await listener(event,...args);replay.status='fulfilled';return value}catch(error){replay.status='rejected';throw error}};
try{const value=await listener(event,...args);record.status='fulfilled';return value}catch(error){record.status='rejected';record.message=String(error.message);throw error}
});` : ''}
process.on('uncaughtExceptionMonitor',e=>require('node:fs').appendFileSync(path.join(process.env.HRONAUT_USER_DATA_DIR,'fixture-errors.log'),String(e.stack)));

const loadNotice=BrowserWindow.prototype.loadFile;BrowserWindow.prototype.loadFile=async function(file,...args){
if(!String(file).endsWith('startup-notice.html'))return loadNotice.call(this,file,...args);
${failNotice ? "throw new Error('synthetic notice window unavailable');" : ''}
const result=await loadNotice.call(this,file,...args);const win=this;
globalThis.metadataFixture.notice=await win.webContents.executeJavaScript("({title:document.getElementById('startup-notice-title').textContent,message:document.getElementById('startup-notice-message').textContent,detail:document.getElementById('startup-notice-detail').textContent,buttons:[document.getElementById('startup-notice-quit').textContent]})");
globalThis.metadataFixture.source='window';
globalThis.metadataFixture.resolve=()=>{void win.webContents.executeJavaScript("document.getElementById('startup-notice-quit').click()")};
return result};
dialog.showMessageBox=async (...args)=>{const o=args.at(-1);globalThis.metadataFixture.notice={title:o.title,message:o.message,detail:o.detail,buttons:o.buttons};globalThis.metadataFixture.source='dialog';
await new Promise(resolve=>globalThis.metadataFixture.resolve=resolve);
${failNotice === 'window-and-dialog' ? "throw new Error('synthetic dialog unavailable');" : 'return {response:0,checkboxChecked:false};'}};
${failSave ? `const rename=fs.rename;fs.rename=async function(from,to){if(String(to)===path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json')){globalThis.metadataFixture.renames=(globalThis.metadataFixture.renames||0)+1;${failSave === 'held' ? 'globalThis.metadataFixture.held=true;await new Promise(resolve=>globalThis.metadataFixture.releaseRead=resolve);' : ''}${failSave === 'after' ? 'await rename.call(this,from,to);' : ''}throw new Error('synthetic save failure')}return rename.call(this,from,to)};require('node:module').syncBuiltinESMExports();` : ''}
${holdRead ? `const read=fs.readFile;let count=0;fs.readFile=async function(file,...args){if(String(file)===path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json')&&++count===2){globalThis.metadataFixture.held=true;await new Promise(resolve=>globalThis.metadataFixture.releaseRead=resolve)}return read.call(this,file,...args)};require('node:module').syncBuiltinESMExports();` : ''}
${late ? `const load=BrowserWindow.prototype.loadFile;BrowserWindow.prototype.loadFile=async function(...args){const result=await load.apply(this,args);await fs.writeFile(path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json'),'{${privateMarker}');return result};` : ''}
`)
  return electron.launch({ args: ['--require', hook, '.'], cwd: process.cwd(), env: {
    ...process.env, HRONAUT_USER_DATA_DIR: profile, HRONAUT_DOWNLOAD_DIR: profile, HRONAUT_MCP_PORT: String(port), HRONAUT_MCP_HOST: '127.0.0.1'
  } })
}
/** Hronaut's own windows, leaving out the startup notice's window. */
export async function hronautWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((window) => !window.webContents.getURL().includes('startup-notice.html')).length)
}
export async function quitNotice(app: ElectronApplication, natural = false): Promise<void> {
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => app.process().once('exit', (code, signal) => resolve({ code, signal })))
  await app.evaluate(({ app }, natural) => { if (natural) setImmediate(() => app.quit()); else (globalThis as Scope).metadataFixture.resolve!() }, natural)
  expect(await exited).toEqual({ code: 0, signal: null })
}

