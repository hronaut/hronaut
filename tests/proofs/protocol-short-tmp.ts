// Explicit host-only synthetic preflight; never launches Electron or a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dockerEngine, isolatedContainer } from '../../scripts/diagnostics/protocol-capture-container.ts'

const image = process.env.HRONAUT_PROTOCOL_TEST_IMAGE
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Pinned local image ID required')

test('owned short temporary bind supports private Chromium-shaped Unix sockets', async () => {
  const parent = join(process.cwd(), 'test-results/protocol-short-tmp-proof')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const root = mkdtempSync(join(parent, 'hronaut-protocol-capture-'))
  const temporary = join(root, 'diagnostic-temp')
  mkdirSync(temporary, { mode: 0o700 })
  const script = `import assert from 'node:assert/strict';
import {realpathSync,statSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
assert.equal(tmpdir(), '/h-tmp');
assert.equal(realpathSync(tmpdir()), '/h-tmp');
const short=statSync(tmpdir()), original=statSync(${JSON.stringify(temporary)});
assert.equal(short.dev,original.dev); assert.equal(short.ino,original.ino);
assert.equal(short.mode & 0o777,0o700);
assert.equal(short.uid,process.getuid()); assert.equal(short.gid,process.getgid());
const directory=mkdtempSync(join(tmpdir(),'.org.chromium.Chromium.'));
const socket=join(directory,'SingletonSocket');
const bytes=Buffer.byteLength(socket); const headroom=107-bytes;
assert.ok(headroom >= 48);
const marker=join(directory,'writable');
writeFileSync(marker,'1',{flag:'wx',mode:0o600}); assert.equal(readFileSync(marker,'utf8'),'1');
const server=createServer();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve)});
assert.equal(statSync(socket).isSocket(),true);
await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
rmSync(directory,{recursive:true});
writeFileSync(${JSON.stringify(join(root, 'result.json'))},JSON.stringify({uid:process.getuid(),gid:process.getgid(),mode:short.mode&0o777,sameInode:1,canonicalShortPath:1,writable:1,socketBound:1,socketBytes:bytes,headroom}),{flag:'wx',mode:0o600});`
  writeFileSync(join(root, 'fixture.mjs'), script, { mode: 0o600 })
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 15_000)
  let stopped = false
  let container = ''
  try {
    const outcome = await isolatedContainer(root, image, ['node', join(root, 'fixture.mjs')], controller.signal, {
      ...dockerEngine, async create(args) { container = await dockerEngine.create(args); return container }
    })
    stopped = outcome.stopped === 1
    assert.deepEqual(outcome, { exitCode: 0, killed: 0, stopped: 1 })
    assert.equal(await dockerEngine.absent(container), true)
    const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))
    assert.equal(result.uid, process.getuid!()); assert.equal(result.gid, process.getgid!())
    assert.equal(result.mode, 0o700); assert.equal(statSync(temporary).mode & 0o777, 0o700)
    rmSync(root, { recursive: true })
    assert.equal(existsSync(root), false)
    console.log(JSON.stringify({ ...result, containmentStopped: 1, containerAbsent: 1, disposableAbsent: 1 }))
  } finally {
    clearTimeout(deadline)
    if (stopped) rmSync(root, { recursive: true, force: true })
  }
})
