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

/**
 * What a module imports or re-exports from for its code: the static `import` and `export ... from` declarations,
 * leaving out those of types only, which the build drops (`consistent-type-imports` marks them).
 */
export function runtimeSpecifiers(code: string, fileName = 'module.ts'): string[] {
  const specifiers: string[] = []
  for (const statement of ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS).statements) {
    if (ts.isImportDeclaration(statement) && !importsTypesOnly(statement.importClause)) specifiers.push(textOf(statement.moduleSpecifier))
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !exportsTypesOnly(statement)) specifiers.push(textOf(statement.moduleSpecifier))
  }
  return specifiers
}

/**
 * The names a module imports or re-exports from one package for its code, leaving out those of types only; `*` stands
 * for `export * from` it.
 */
export function runtimeNamesFrom(code: string, specifier: string, fileName = 'module.ts'): string[] {
  const names: string[] = []
  for (const statement of ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS).statements) {
    if (ts.isImportDeclaration(statement) && textOf(statement.moduleSpecifier) === specifier && !statement.importClause?.isTypeOnly) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text))
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && textOf(statement.moduleSpecifier) === specifier && !statement.isTypeOnly) {
      const clause = statement.exportClause
      if (!clause) names.push('*')
      else if (ts.isNamedExports(clause)) names.push(...clause.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text))
    }
  }
  return names
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

/** The file a relative import names: TypeScript's `.js` for `.ts`, a Vue file, or a folder's index. */
function resolveImport(from: string, specifier: string): string | undefined {
  const target = join(dirname(from), specifier.replace(/\?.*$/, ''))
  const candidates = [target, target.replace(/\.js$/, '.ts'), `${target}.ts`, join(target, 'index.ts')]
  const found = candidates.find(candidate => /\.(ts|vue)$/.test(candidate) && existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile())
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
