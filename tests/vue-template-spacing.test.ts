import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { NodeTypes, parse, type ElementNode, type ParentNode, type TemplateChildNode } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { expect, it } from 'vitest'

const RENDERER = join(import.meta.dirname, '../src/renderer/src')

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

function endsWithSpace(node: TemplateChildNode | undefined): boolean {
  return node?.type === NodeTypes.TEXT && /\s$/.test(node.content)
}

function startsWithSpace(node: TemplateChildNode | undefined): boolean {
  return node?.type === NodeTypes.TEXT && /^\s/.test(node.content)
}

// Vue drops whitespace at the start and end of a <template>, so a space written
// there to separate it from the text beside it never reaches the page.
function droppedSpaces(source: string, parent: ParentNode, file: string, firstLine: number, found: string[]): void {
  parent.children.forEach((child, index) => {
    if (child.type !== NodeTypes.ELEMENT) return
    const element = child as ElementNode
    const first = element.children.at(0)
    const last = element.children.at(-1)
    if (element.tag === 'template' && first && last) {
      const line = `${relative(RENDERER, file)}:${firstLine + element.loc.start.line - 1}`
      const before = /[ \t]+$/.exec(source.slice(element.loc.start.offset, first.loc.start.offset))
      const after = /^[ \t]+/.exec(source.slice(last.loc.end.offset, element.loc.end.offset))
      if (before && source[before.index + element.loc.start.offset - 1] === '>' && index > 0 && !endsWithSpace(parent.children[index - 1])) {
        found.push(`${line} starts with a dropped space`)
      }
      if (after && source.startsWith('</template', last.loc.end.offset + after[0].length) && index < parent.children.length - 1 && !startsWithSpace(parent.children[index + 1])) {
        found.push(`${line} ends with a dropped space`)
      }
    }
    droppedSpaces(source, element, file, firstLine, found)
  })
}

it('keeps the space written beside conditional text in every renderer template', () => {
  // "Payload omitted for binary(opcode 2)." and "Fail as Failed· until removed" lost the space their template began with.
  const found: string[] = []
  for (const file of vueFiles(RENDERER)) {
    const template = parseSfc(readFileSync(file, 'utf8'), { filename: file }).descriptor.template
    if (template) droppedSpaces(template.content, parse(template.content), file, template.loc.start.line, found)
  }
  expect(found).toEqual([])
})
