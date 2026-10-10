import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

export const PINNED_VERSION = '1.63.0'
export const PINNED_SHA256 = '549070af3acabb3efcc4f55bfe6210f9f7c2fcf633cf7eaa59bfe60719969171'

// Pure transform: never changes the installed package or launches a browser.
export function buildProtocolTimingOverlay(source: string, version: string): string {
  if (version !== PINNED_VERSION || createHash('sha256').update(source).digest('hex') !== PINNED_SHA256)
    throw new Error('Protocol timing overlay pin mismatch')
  // The pinned bundle has exactly this directive followed by executable code.
  // Do not infer a prologue or move a future hashbang/directive past our code.
  const prologue = '"use strict";\n'
  if (!source.startsWith(prologue + 'var __create = Object.create;\n'))
    throw new Error('Protocol timing overlay source prologue mismatch')
  let patched = source
  const replace = (before: string, after: string) => {
    if (patched.split(before).length !== 2) throw new Error('Protocol timing overlay anchor mismatch')
    patched = patched.replace(before, after)
  }
  replace('const nodeConnection = new CRConnection(this, nodeTransport,',
    'hronautTiming.register(nodeTransport, 1);\n          const nodeConnection = new CRConnection(this, nodeTransport,')
  replace('const chromeTransport = await WebSocketTransport.connect(progress2, chromeMatch[1]);',
    'const chromeTransport = await WebSocketTransport.connect(progress2, chromeMatch[1]);\n          hronautTiming.register(chromeTransport, 2);')
  // Scope transport edits to its upstream module, keeping unrelated transports intact.
  const start = patched.indexOf('    WebSocketTransport = class _WebSocketTransport {')
  const end = patched.indexOf('// packages/playwright-core/src/server/browserType.ts', start)
  let transport = patched.slice(start, end)
  const change = (before: string, after: string) => {
    if (transport.split(before).length !== 2) throw new Error('Protocol timing overlay transport anchor mismatch')
    transport = transport.replace(before, after)
  }
  change('this._ws.addEventListener("message", (event) => {\n          messageWrap',
    'this._ws.addEventListener("message", (event) => {\n          const hronautReceive = hronautTiming.raw(this);\n          messageWrap')
  change('parsedJson = JSON.parse(eventData);', 'parsedJson = JSON.parse(eventData);\n              hronautTiming.parsed(this, parsedJson, hronautReceive);')
  change('this._progress?.log(`<closing ws> Closing websocket due to malformed JSON.',
    'hronautTiming.lifecycle(this, 7);\n              this._progress?.log(`<closing ws> Closing websocket due to malformed JSON.')
  change('this._progress?.log(`<closing ws> Closing websocket due to failed onmessage callback.',
    'hronautTiming.lifecycle(this, 8);\n              this._progress?.log(`<closing ws> Closing websocket due to failed onmessage callback.')
  change('this._ws.addEventListener("close", (event) => {',
    'this._ws.addEventListener("close", (event) => {\n          hronautTiming.lifecycle(this, 9);')
  change('this._ws.send(JSON.stringify(message));', `let hronautStarted = false;
        let hronautEncoded;
        try {
          this._ws.send((hronautEncoded = JSON.stringify(message), hronautTiming.send(this, message, 1), hronautStarted = true, hronautEncoded));
        } catch (error) {
          if (hronautStarted) hronautTiming.send(this, message, 3);
          throw error;
        }
        hronautTiming.send(this, message, 2);`)
  patched = patched.slice(0, start) + transport + patched.slice(end)
  const sessionStart = patched.indexOf('    CRSession = class _CRSession extends SdkObject {')
  const sessionEnd = patched.indexOf('    CDPSession = class', sessionStart)
  const session = patched.slice(sessionStart, sessionEnd)
  const callbackAnchor = 'const callback = this._callbacks.get(object.id);\n          this._callbacks.delete(object.id);'
  if (session.split(callbackAnchor).length !== 2) throw new Error('Protocol timing overlay session anchor mismatch')
  patched = patched.slice(0, sessionStart) + session.replace(callbackAnchor,
    callbackAnchor + '\n          hronautTiming.callback(this._connection._transport, object);') + patched.slice(sessionEnd)
  const electronStart = patched.indexOf('// packages/playwright-core/src/server/electron/electron.ts')
  const electronEnd = patched.indexOf('// packages/playwright-core/src/server/firefox/ffConnection.ts', electronStart)
  if (electronStart < 0 || electronEnd < 0) throw new Error('Protocol timing overlay Electron module mismatch')
  let electron = patched.slice(electronStart, electronEnd)
  const electronReplace = (before: string, after: string) => {
    if (electron.split(before).length !== 2) throw new Error('Protocol timing overlay Electron anchor mismatch')
    electron = electron.replace(before, after)
  }
  electronReplace('        const { launchedProcess, gracefullyClose, kill } = await progress2.race(launchProcess({',
    '        hronautStartup(6, 1);\n        const { launchedProcess, gracefullyClose, kill } = await progress2.race(launchProcess({')
  electronReplace('          onExit: () => app?.emit(ElectronApplication.Events.Close)',
    '          onExit: (code, signal) => { const result = app?.emit(ElectronApplication.Events.Close); hronautStartup(7, 4, void 0, code, signal); return result; }')
  electronReplace('        const waitForXserverError = waitForLine(progress2, launchedProcess, /Unable to open X display/)',
    '        hronautStartup(6, 2);\n        const waitForXserverError = waitForLine(progress2, launchedProcess, /Unable to open X display/)')
  electronReplace('          await progress2.race(app.initialize());',
    '          hronautStartup(8, 1);\n          await progress2.race(app.initialize());\n          hronautStartup(8, 2);')
  electronReplace('        } catch (error) {\n          await progress2.race(kill());',
    '        } catch (error) {\n          hronautStartup(6, 3, error);\n          await progress2.race(kill());')
  patched = patched.slice(0, electronStart) + electron + patched.slice(electronEnd)
  const startup = `function hronautStartup(stage, state, error, code = -1, signal) {
    try {
      const sink = require(require("node:path").resolve(__dirname, "../../../scripts/diagnostics/protocol-capture-startup.ts"));
      sink.recordStartup(stage, state, signal ? sink.startupSignal(signal) : sink.startupReason(error), code);
    } catch {}
  }\n`;
  const runtime = ts.transpileModule(readFileSync(new URL('./protocol-timing-runtime.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText
  const body = `${prologue}${startup}const hronautTiming = (() => { const exports = {};\n${runtime}\nreturn exports.createProtocolTiming(); })();\n${patched.slice(prologue.length)}\nhronautStartup(2, 2);\nmodule.exports.__hronautProtocolTimingSnapshot = () => hronautTiming.snapshot();\n`
  const identity = createHash('sha256').update(body).digest('hex')
  return body + `module.exports.__hronautProtocolTimingIdentity = "${identity}";\n`
}

// Explicit offline generation into a NEW file alongside an isolated copy of
// playwright-core/lib/coreBundle.js. Never wire this into CI/release by default.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , sourcePath, packagePath, outputPath] = process.argv
  if (!sourcePath || !packagePath || !outputPath) throw new Error('Expected source, package manifest and new output paths')
  const manifest: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : undefined
  const output = buildProtocolTimingOverlay(readFileSync(sourcePath, 'utf8'), typeof version === 'string' ? version : '')
  writeFileSync(outputPath, output, { flag: 'wx', mode: 0o600 })
}
