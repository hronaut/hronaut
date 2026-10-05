import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const files = {
  react: ['react-fixture', 'cjs/react.production.js'],
  'react-dom': ['react-dom-fixture', 'cjs/react-dom.production.js'],
  scheduler: ['scheduler-fixture', 'cjs/scheduler.production.js'],
  client: ['react-dom-fixture', 'cjs/react-dom-client.production.js']
}
export const reactInspectionBundle = `(() => { globalThis.fixtureSawHook = typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined"; const modules = {${Object.entries(files).map(([name, [packageName, file]]) => `${JSON.stringify(name)}: function(module, exports, require) { ${readFileSync(join(dirname(require.resolve(packageName! + '/package.json')), file!), 'utf8')}\n}`).join(',')}};
const cache = {}; function require(name) { if (!cache[name]) { const m = cache[name] = { exports: {} }; modules[name](m,m.exports,require); } return cache[name].exports; }
const React=require('react'), root=require('client').createRoot(document.getElementById('root'));
const Context=React.createContext('private-context-canary');
function Nested() { const [value]=React.useState('private-state-canary'); React.useContext(Context); return React.createElement('span', {title:value}, 'private-dom-canary'); }
function Named() { return React.createElement(Nested, {secret:'private-props-canary', key:'private-key-canary'}); }
const Anonymous = (() => function() { return React.createElement('i'); })();
function Deep({depth}) { return depth ? React.createElement(Deep,{depth:depth-1}) : React.createElement(Named); }
function App({mode}) { return React.createElement(Context.Provider,{value:'private-context-canary'}, mode==='wide' ? Array.from({length:300},(_,i)=>React.createElement(Named,{key:i})) : mode==='deep' ? React.createElement(Deep,{depth:40}) : mode==='empty' ? null : React.createElement(React.Fragment,null,React.createElement(Named),React.createElement(Anonymous))); }
globalThis.fixtureRender = mode => root.render(React.createElement(App,{mode}));
globalThis.fixtureUnmount = () => root.unmount(); fixtureRender('normal');
})();`
