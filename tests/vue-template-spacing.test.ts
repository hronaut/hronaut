import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'vue/compiler-sfc'
import { expect, it } from 'vitest'

const RENDERER = join(import.meta.dirname, '../src/renderer/src')

// Vue's template node types, as the SFC parser reports them.
const ELEMENT = 1
const TEXT = 2
const COMMENT = 3
const DIRECTIVE = 7

// Elements that sit in a line of text, where a space at their edge separates words.
const INLINE_TAGS = new Set(['template', 'span', 'strong', 'em', 'b', 'i', 'small', 'code', 'kbd', 'a', 'abbr', 'time', 'mark', 'bdi', 'label', 'output'])

interface TemplateNode {
  type: number
  tag?: string
  content?: unknown
  children?: TemplateNode[]
  props?: Array<{ type: number; name: string }>
  loc: { start: { offset: number; line: number; column: number }; end: { offset: number } }
}

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

function directive(node: TemplateNode, name: string): boolean {
  return node.props?.some((prop) => prop.type === DIRECTIVE && prop.name === name) ?? false
}

function edgeText(node: TemplateNode | undefined, edge: 'start' | 'end'): string | undefined {
  if (!node) return undefined
  if (node.type === TEXT) return String(node.content)
  if (node.type !== ELEMENT || !node.children?.length) return undefined
  return edgeText(edge === 'end' ? node.children.at(-1) : node.children[0], edge)
}

/** The content Vue renders beside a node: comments and the other branches of its v-if chain are skipped. */
function neighbour(siblings: TemplateNode[], index: number, step: -1 | 1): TemplateNode | undefined {
  let position = index
  let node = siblings[index]
  for (;;) {
    const next = siblings[position + step]
    if (!next) return undefined
    position += step
    if (next.type === COMMENT) continue
    const sameChain = step === -1
      ? (directive(node, 'else') || directive(node, 'else-if')) && (directive(next, 'if') || directive(next, 'else-if'))
      : (directive(next, 'else') || directive(next, 'else-if')) && (directive(node, 'if') || directive(node, 'else-if'))
    if (!sameChain) return next
    node = next
  }
}

// Vue drops whitespace at the start and end of an element's content, so a
// space written there to separate an inline element from the text beside it
// never reaches the page.
function droppedSpaces(source: string, parent: TemplateNode, file: string, found: string[]): void {
  const siblings = parent.children ?? []
  siblings.forEach((element, index) => {
    if (element.type !== ELEMENT) return
    const first = element.children?.at(0)
    const last = element.children?.at(-1)
    if (element.tag && INLINE_TAGS.has(element.tag) && first && last) {
      const place = `${relative(RENDERER, file)}:${element.loc.start.line}:${element.loc.start.column}`
      const before = /[ \t]+$/.exec(source.slice(element.loc.start.offset, first.loc.start.offset))
      const after = /^[ \t]+/.exec(source.slice(last.loc.end.offset, element.loc.end.offset))
      const previous = neighbour(siblings, index, -1)
      const following = neighbour(siblings, index, 1)
      if (before && source[element.loc.start.offset + before.index - 1] === '>' && previous && !/\s$/.test(edgeText(previous, 'end') ?? '')) {
        found.push(`${place} starts with a dropped space`)
      }
      if (after && source.startsWith('</', last.loc.end.offset + after[0].length) && following && !/^\s/.test(edgeText(following, 'start') ?? '')) {
        found.push(`${place} ends with a dropped space`)
      }
    }
    droppedSpaces(source, element, file, found)
  })
}

it('keeps the space written beside conditional text in every renderer template', () => {
  // "Payload omitted for binary(opcode 2)." and "Fail as Failed· until removed" lost the space their template began with.
  const found: string[] = []
  for (const file of vueFiles(RENDERER)) {
    const source = readFileSync(file, 'utf8')
    const ast = parse(source, { filename: file }).descriptor.template?.ast as TemplateNode | undefined
    if (ast) droppedSpaces(source, ast, file, found)
  }
  expect(found).toEqual([])
})
