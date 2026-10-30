import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import ts from 'typescript'

/** The repository root, so paths read the same on every machine. */
export const ROOT = resolve(import.meta.dirname, '..', '..')

/** The TypeScript and Vue files of the app under src/, tests and stories aside, as paths from the repository root. */
export function sourceFiles(): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const name of readdirSync(join(ROOT, directory)).sort()) {
      const path = `${directory}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|vue)$/.test(name) && !/\.(d|test|stories)\.ts$/.test(name)) files.push(path)
    }
  }
  walk('src')
  return files
}

export function lineCount(path: string): number {
  const text = readFileSync(join(ROOT, path), 'utf8')
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/** The module the guards parsed last, since a guard often asks two questions of the same file in a row. */
let lastParsed: { fileName: string; code: string; source: ts.SourceFile } | undefined

/** A module's syntax tree, parsed once for the questions asked of it in a row. */
function parsedModule(code: string, fileName: string): ts.SourceFile {
  if (lastParsed?.fileName === fileName && lastParsed.code === code) return lastParsed.source
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  lastParsed = { fileName, code, source }
  return source
}

/**
 * What a module imports or re-exports from for its code: the static `import` and `export ... from` declarations,
 * leaving out those of types only, which the build drops (`consistent-type-imports` marks them).
 */
export function runtimeSpecifiers(code: string, fileName = 'module.ts'): string[] {
  const specifiers: string[] = []
  for (const statement of parsedModule(code, fileName).statements) {
    if (ts.isImportDeclaration(statement) && !importsTypesOnly(statement.importClause)) specifiers.push(textOf(statement.moduleSpecifier))
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !exportsTypesOnly(statement)) specifiers.push(textOf(statement.moduleSpecifier))
  }
  return specifiers
}

/** The names a module imports or re-exports from one package for its code, leaving out types and the default export. */
export function runtimeNamesFrom(code: string, specifier: string, fileName = 'module.ts'): string[] {
  const names: string[] = []
  for (const statement of parsedModule(code, fileName).statements) {
    if (ts.isImportDeclaration(statement) && textOf(statement.moduleSpecifier) === specifier && !statement.importClause?.isTypeOnly) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text))
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && textOf(statement.moduleSpecifier) === specifier && !statement.isTypeOnly) {
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) names.push(...clause.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text))
    }
  }
  return names.filter(name => name !== 'default')
}

// An IPC channel's name, `feature:action`, as in 'license:activate' or 'browser:tab-groups:update'.
const IPC_CHANNEL = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*:[a-z][a-zA-Z0-9]*(?:[-:][a-zA-Z0-9]+)*$/
// Text of the same shape that is no channel: URLs such as about:blank, and page events.
const URL_SCHEMES = new Set(['about', 'blob', 'chrome', 'data', 'devtools', 'file', 'http', 'https', 'javascript', 'mailto', 'ws', 'wss'])
const PAGE_EVENT_CALLS = new Set(['addEventListener', 'removeEventListener'])

/**
 * The IPC channel names a module writes out as text where it sends or listens, the first argument of a call such as
 * `ipcMain.handle('license:activate', ...)`, rather than taking them from the typed channels of src/shared/ipc.
 */
export function literalIpcChannels(code: string, fileName = 'module.ts'): string[] {
  const channels: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments
      const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : ''
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && IPC_CHANNEL.test(first.text)
        && !URL_SCHEMES.has(first.text.slice(0, first.text.indexOf(':'))) && !PAGE_EVENT_CALLS.has(callee)) channels.push(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsedModule(code, fileName))
  return channels
}

/** The channel names the typed channels of src/shared/ipc declare: each property's string, such as `'license:activate' as InvokeChannel<...>`. */
export function declaredIpcChannels(code: string, fileName = 'channels.ts'): string[] {
  const channels: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isAsExpression(node.initializer) && ts.isStringLiteral(node.initializer.expression)) {
      channels.push(node.initializer.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsedModule(code, fileName))
  return channels
}

/**
 * The declared channel names a module writes out as text anywhere, not only where it sends or listens: in a cast, a
 * constant, a comparison or a template literal without substitutions.
 */
export function writtenIpcChannels(code: string, declared: ReadonlySet<string>, fileName = 'module.ts'): string[] {
  const channels: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && declared.has(node.text)) channels.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parsedModule(code, fileName))
  return channels
}

/** The IpcMain methods that register a listener, which TypedIpcMain checks against the channel. */
const IPC_MAIN_REGISTRATIONS = new Set(['handle', 'handleOnce', 'on', 'once', 'addListener', 'prependListener', 'prependOnceListener'])

/**
 * Where a main module goes around the checks of its channels' types: a channel of src/shared/ipc sent with a renderer's
 * own `send` rather than `sendTo`, a listener registered on Electron's own ipcMain, or Electron's `IpcMain` type,
 * whose handlers take any arguments and answer anything.
 */
export function untypedIpcUses(code: string, fileName = 'module.ts'): string[] {
  const uses: string[] = []
  const electronIpcMain = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && textOf(node.moduleSpecifier) === 'electron' && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'ipcMain') electronIpcMain.add(element.name.text)
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const [first] = node.arguments
      if (method === 'send' && first && ts.isPropertyAccessExpression(first) && ts.isIdentifier(first.expression) && first.expression.text.endsWith('_IPC')) {
        uses.push(`send(${first.expression.text}.${first.name.text})`)
      }
      if (IPC_MAIN_REGISTRATIONS.has(method) && ts.isIdentifier(node.expression.expression) && electronIpcMain.has(node.expression.expression.text)) {
        uses.push(`ipcMain.${method}`)
      }
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text
      if (name === 'IpcMain') uses.push('IpcMain')
    }
    ts.forEachChild(node, visit)
  }
  visit(parsedModule(code, fileName))
  return uses
}

/** Whether an identifier names a value there, rather than a property or a label. */
function referencesValue(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  if ((ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) && parent.label === node) return false
  return true
}

/** Names Node gives a script and a page does not, so a page function using one fails there. */
const NODE_ONLY_GLOBALS = new Set(['process', 'require', 'Buffer', 'global', 'module', 'exports', '__dirname', '__filename'])

/** Whether a top-level statement of a `.page.ts` file is one it may have: a type, an import of types or a named function. */
function pageFileStatementAllowed(statement: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return true
  if (ts.isImportDeclaration(statement)) return importsTypesOnly(statement.importClause)
  if (ts.isExportDeclaration(statement)) return exportsTypesOnly(statement)
  return ts.isFunctionDeclaration(statement) && statement.name !== undefined
}

/**
 * What a `.page.ts` file has that the page its functions run in does not, since only a function's own source reaches
 * it: each top-level statement other than types, imports of types and named functions, and each name a function uses
 * that TypeScript resolves to a declaration outside the function, other than the function itself, or that only Node
 * has. The page's globals resolve to nothing, as the file is checked without the DOM library, and names in types are
 * left out, as TypeScript erases them.
 */
export function pageFunctionModuleUses(code: string, fileName = 'module.page.ts'): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const host: ts.CompilerHost = {
    getSourceFile: name => name === fileName ? source : undefined,
    fileExists: name => name === fileName,
    readFile: () => undefined,
    writeFile: () => undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    getCurrentDirectory: () => '',
    getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n'
  }
  const checker = ts.createProgram([fileName], { noLib: true, noResolve: true, types: [] }, host).getTypeChecker()
  const uses: string[] = []
  for (const statement of source.statements) {
    if (!pageFileStatementAllowed(statement)) uses.push(`top level: ${statement.getText(source).split('\n')[0]!.slice(0, 80)}`)
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue
    const own = statement.name.text
    const ownSymbol = checker.getSymbolAtLocation(statement.name)
    const visit = (node: ts.Node): void => {
      // A class's base class and an instantiation expression's function are values; implemented interfaces are types.
      if (ts.isExpressionWithTypeArguments(node)) {
        const clause = node.parent
        if (!(ts.isHeritageClause(clause) && (clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent)))) visit(node.expression)
        return
      }
      if (ts.isTypeNode(node)) return
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) uses.push(`${own}: import()`)
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) uses.push(`${own}: import.meta`)
      if (ts.isIdentifier(node) && referencesValue(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node)
        const declaration = symbol?.declarations?.[0]
        const outside = declaration !== undefined && (declaration.pos < statement.pos || declaration.end > statement.end)
        if (symbol ? outside && symbol !== ownSymbol : NODE_ONLY_GLOBALS.has(node.text)) uses.push(`${own}: ${node.text}`)
      }
      ts.forEachChild(node, visit)
    }
    statement.parameters.forEach(visit)
    visit(statement.body)
  }
  return uses
}

function importsTypesOnly(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false
  if (clause.isTypeOnly) return true
  const bindings = clause.namedBindings
  return !clause.name && bindings !== undefined && ts.isNamedImports(bindings)
    && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly)
}

function exportsTypesOnly(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return true
  const clause = declaration.exportClause
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly)
}

function textOf(specifier: ts.Expression): string {
  return ts.isStringLiteral(specifier) ? specifier.text : ''
}

/** A Vue file's code is in its script blocks. */
function codeOf(file: string, text: string): string {
  if (!file.endsWith('.vue')) return text
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
}

/** The file a relative import names: TypeScript's `.js` for `.ts`, a Vue or JavaScript file, or a folder's index. */
export function resolveImport(from: string, specifier: string): string | undefined {
  const target = join(dirname(from), specifier.replace(/\?.*$/, ''))
  const candidates = [target.replace(/\.js$/, '.ts'), target, `${target}.ts`, join(target, 'index.ts')]
  const found = candidates.find(candidate => /\.(ts|vue|js|mjs|cjs)$/.test(candidate) && existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile())
  return found?.split(sep).join('/')
}

/** The source files each file imports for their code, leaving out imports and re-exports of types only. */
export function runtimeImports(files: readonly string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const file of files) {
    const imported = new Set<string>()
    for (const specifier of runtimeSpecifiers(codeOf(file, readFileSync(join(ROOT, file), 'utf8')), file)) {
      const target = specifier.startsWith('.') ? resolveImport(file, specifier) : undefined
      if (target) imported.add(target)
    }
    graph.set(file, [...imported].sort())
  }
  return graph
}

/** The groups of files that import each other in a circle, each as its files in order; Tarjan's algorithm. */
export function importCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: string[][] = []
  let next = 0
  const visit = (file: string): void => {
    index.set(file, next)
    low.set(file, next)
    next += 1
    stack.push(file)
    onStack.add(file)
    for (const target of graph.get(file) ?? []) {
      if (!index.has(target)) {
        visit(target)
        low.set(file, Math.min(low.get(file)!, low.get(target)!))
      } else if (onStack.has(target)) {
        low.set(file, Math.min(low.get(file)!, index.get(target)!))
      }
    }
    if (low.get(file) !== index.get(file)) return
    const group: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      group.push(member)
    } while (member !== file)
    if (group.length > 1 || graph.get(file)?.includes(file)) cycles.push(group.sort())
  }
  for (const file of graph.keys()) if (!index.has(file)) visit(file)
  return cycles
}
