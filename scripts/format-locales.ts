import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { isMainModule } from './is-main-module.ts'

/**
 * Locale files hold one key per line, in the order en-US has them, so a
 * translation diff shows the changed keys and every language lines up with
 * en-US line by line. Keys are plain names where they can be and values keep
 * their text; only the quotes change to the ones that need fewer escapes,
 * single on a tie.
 */
export const LOCALES_DIRECTORY = fileURLToPath(new URL('../src/shared/locales', import.meta.url))

const LOCALE_NAME = /^[a-z]{2}-[A-Z]{2}$/
const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/

/** The keys of an en-US object in order, with the order inside each of its objects. */
interface KeyOrder {
  readonly rank: ReadonlyMap<string, number>
  readonly nested: ReadonlyMap<string, KeyOrder>
}

export function localeFiles(directory = LOCALES_DIRECTORY): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return localeFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/** The file as `npm run format:locales` writes it; a language file follows the en-US file beside it. */
export function formattedLocaleFile(path: string): string {
  const english = join(dirname(path), 'en-US.ts')
  const language = basename(path, '.ts')
  const reference = LOCALE_NAME.test(language) && path !== english && existsSync(english)
    ? readFileSync(english, 'utf8')
    : undefined
  return formatLocaleSource(readFileSync(path, 'utf8'), path, reference)
}

export function formatLocaleSource(source: string, fileName = 'locale.ts', english?: string): string {
  const file = parse(source, fileName)
  const objects = topLevelObjects(file)
  const orders = english === undefined ? [] : topLevelObjects(parse(english, 'en-US.ts')).map(keyOrder)
  if (english !== undefined && orders.length !== objects.length) {
    throw new Error(`${fileName}: ${objects.length} message objects, en-US.ts has ${orders.length}; they cannot line up.`)
  }
  objects.forEach((object) => refuseComments(object, file))
  let formatted = source
  for (const [index, object] of [...objects.entries()].reverse()) {
    const start = object.getStart(file)
    const indent = /[ \t]*/.exec(source.slice(source.lastIndexOf('\n', start - 1) + 1, start))?.[0] ?? ''
    formatted = formatted.slice(0, start) + printObject(object, indent, file, orders[index]) + formatted.slice(object.getEnd())
  }
  return formatted
}

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function topLevelObjects(file: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const objects: ts.ObjectLiteralExpression[] = []
  const collect = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) objects.push(node)
    else ts.forEachChild(node, collect)
  }
  collect(file)
  return objects
}

function keyOrder(object: ts.ObjectLiteralExpression): KeyOrder {
  const rank = new Map<string, number>()
  const nested = new Map<string, KeyOrder>()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = keyText(property.name)
    rank.set(key, rank.size)
    if (ts.isObjectLiteralExpression(property.initializer)) nested.set(key, keyOrder(property.initializer))
  }
  return { rank, nested }
}

/** The printer keeps no comments, so one between the tokens of the messages stops it. */
function refuseComments(object: ts.ObjectLiteralExpression, file: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(file)
    if (children.length > 0) {
      children.forEach(visit)
      return
    }
    const trivia = file.text.slice(Math.max(node.pos, object.getStart(file)), node.getStart(file))
    const comment = /\S/.exec(trivia)
    if (!comment) return
    const line = file.getLineAndCharacterOfPosition(node.getStart(file) - trivia.length + comment.index).line + 1
    throw new Error(`${file.fileName}:${line}: a comment inside locale messages would be lost; put it above the object.`)
  }
  visit(object)
}

function printObject(object: ts.ObjectLiteralExpression, indent: string, file: ts.SourceFile, order?: KeyOrder): string {
  if (object.properties.length === 0) return '{}'
  // A module with every language in one object orders each language like its 'en-US' entry.
  const english = object.properties.find((property) => ts.isPropertyAssignment(property) && keyText(property.name) === 'en-US')
  const languageOrder = english && ts.isPropertyAssignment(english) && ts.isObjectLiteralExpression(english.initializer)
    ? keyOrder(english.initializer)
    : undefined
  const inner = `${indent}  `
  const lines = ordered(object.properties, order).map((property) => {
    if (ts.isSpreadAssignment(property)) return `${inner}...${property.expression.getText(file)}`
    if (!ts.isPropertyAssignment(property)) {
      const line = file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1
      throw new Error(`${file.fileName}:${line}: locale messages hold only keys and spreads.`)
    }
    const key = keyText(property.name)
    const nested = order?.nested.get(key) ?? (LOCALE_NAME.test(key) ? languageOrder : undefined)
    return `${inner}${printKey(property.name, file)}: ${printValue(property.initializer, inner, file, nested)}`
  })
  return `{\n${lines.join(',\n')}\n${indent}}`
}

/**
 * Keys in en-US order, keys en-US lacks after them. Keys only move among the
 * keys between two spreads, so whatever a spread or a key overrides stays the same.
 */
function ordered(properties: ts.NodeArray<ts.ObjectLiteralElementLike>, order?: KeyOrder): ts.ObjectLiteralElementLike[] {
  if (!order) return [...properties]
  const rank = (property: ts.ObjectLiteralElementLike): number => ts.isPropertyAssignment(property)
    ? order.rank.get(keyText(property.name)) ?? Number.MAX_SAFE_INTEGER
    : Number.MAX_SAFE_INTEGER
  const result: ts.ObjectLiteralElementLike[] = []
  let run: ts.ObjectLiteralElementLike[] = []
  const flush = (): void => {
    result.push(...run.map((property, index) => ({ property, index }))
      .sort((a, b) => rank(a.property) - rank(b.property) || a.index - b.index)
      .map(({ property }) => property))
    run = []
  }
  for (const property of properties) {
    if (ts.isSpreadAssignment(property)) {
      flush()
      result.push(property)
    } else {
      run.push(property)
    }
  }
  flush()
  return result
}

function keyText(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  throw new Error(`${name.getSourceFile().fileName}: computed locale keys are not supported.`)
}

function printKey(name: ts.PropertyName, file: ts.SourceFile): string {
  if (ts.isStringLiteral(name) && !PLAIN_KEY.test(name.text)) return printString(name, file)
  return ts.isNumericLiteral(name) ? name.getText(file) : keyText(name)
}

function printValue(value: ts.Expression, indent: string, file: ts.SourceFile, order?: KeyOrder): string {
  if (ts.isObjectLiteralExpression(value)) return printObject(value, indent, file, order)
  if (ts.isStringLiteral(value)) return printString(value, file)
  return value.getText(file)
}

/** The literal's own text in the quotes its value needs fewer of escaped, single on a tie; other escapes stay as written. */
function printString(literal: ts.StringLiteral, file: ts.SourceFile): string {
  const quote = count(literal.text, "'") > count(literal.text, '"') ? '"' : "'"
  const other = quote === '"' ? "'" : '"'
  const raw = literal.getText(file).slice(1, -1)
  const body = raw.replace(/\\([\s\S])|(["'])/g, (match: string, escaped: string | undefined, bare: string | undefined) => {
    if (escaped === other) return other
    if (bare === quote) return `\\${quote}`
    return match
  })
  return `${quote}${body}${quote}`
}

function count(text: string, character: string): number {
  return text.split(character).length - 1
}

if (isMainModule(import.meta.url)) {
  const formatted = localeFiles().filter((path) => {
    const text = formattedLocaleFile(path)
    if (text === readFileSync(path, 'utf8')) return false
    writeFileSync(path, text)
    return true
  })
  process.stdout.write(`Formatted ${formatted.length} locale file(s)${formatted.map((path) => `\n${relative(process.cwd(), path)}`).join('')}\n`)
}
