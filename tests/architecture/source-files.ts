import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** The repository root, so paths read the same on every machine. */
export const ROOT = resolve(import.meta.dirname, '..', '..')

/** Every TypeScript and Vue file under src/, as a path from the repository root with forward slashes. */
export function sourceFiles(): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const name of readdirSync(join(ROOT, directory)).sort()) {
      const path = `${directory}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|vue)$/.test(name) && !name.endsWith('.d.ts')) files.push(path)
    }
  }
  walk('src')
  return files
}

export function lineCount(path: string): number {
  const text = readFileSync(join(ROOT, path), 'utf8')
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

// A static import or re-export at the start of a line: its clause, if any, and where it imports from.
const IMPORT = /^(import|export)\s+(?:([^'";]*?)\s+from\s+)?['"]([^'"]+)['"]/gm

/** Whether an import or re-export clause names types only, which TypeScript leaves out of the built code. */
function typeOnly(clause: string): boolean {
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim())
  if (clause.trim().startsWith('type ')) return true
  if (!named) return false
  const specifiers = named[1]!.split(',').map(specifier => specifier.trim()).filter(Boolean)
  return specifiers.length > 0 && specifiers.every(specifier => specifier.startsWith('type '))
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
    for (const match of readFileSync(join(ROOT, file), 'utf8').matchAll(IMPORT)) {
      const [, keyword, clause = '', specifier] = match
      if (!specifier!.startsWith('.') || typeOnly(clause) || (keyword === 'export' && !clause)) continue
      const target = resolveImport(file, specifier!)
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

export function fromRoot(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}
