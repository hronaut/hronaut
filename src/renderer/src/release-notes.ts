const MAX_RELEASE_NOTES_LENGTH = 200_000

const ALLOWED_ELEMENTS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'summary',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
])

const DISCARDED_ELEMENTS = new Set([
  'audio',
  'button',
  'canvas',
  'embed',
  'form',
  'iframe',
  'img',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'style',
  'svg',
  'template',
  'textarea',
  'video'
])

const ALERT_CLASSES = new Set([
  'markdown-alert',
  'markdown-alert-caution',
  'markdown-alert-important',
  'markdown-alert-note',
  'markdown-alert-tip',
  'markdown-alert-title',
  'markdown-alert-warning'
])

const HTML_BLOCK_PATTERN = /<\/?(?:a|blockquote|br|code|del|details|div|em|h[1-6]|hr|li|ol|p|pre|span|strong|summary|table|tbody|td|th|thead|tr|ul)\b/i
const INLINE_MARKDOWN_PATTERN = /\[([^\]\n]+)]\(([^\s)]+)(?:\s+"[^"]*")?\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/

function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function copyChildren(source: Node, destination: Node, document: Document): void {
  for (const child of source.childNodes) {
    const sanitized = sanitizeNode(child, document)
    if (sanitized) destination.appendChild(sanitized)
  }
}

function sanitizeNode(node: Node, document: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const source = node as Element
  const tag = source.tagName.toLowerCase()
  if (DISCARDED_ELEMENTS.has(tag)) return null

  if (!ALLOWED_ELEMENTS.has(tag)) {
    const fragment = document.createDocumentFragment()
    copyChildren(source, fragment, document)
    return fragment
  }

  const element = document.createElement(tag)
  if (tag === 'a') {
    const href = safeLink(source.getAttribute('href') ?? '')
    if (href) {
      element.setAttribute('href', href)
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  const safeClasses = [...source.classList].filter((name) => ALERT_CLASSES.has(name))
  if (safeClasses.length > 0) element.className = safeClasses.join(' ')
  copyChildren(source, element, document)
  return element
}

function sanitizeHtml(source: string, document: Document): string {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const container = document.createElement('div')
  copyChildren(parsed.body, container, document)
  return container.innerHTML
}

function appendInlineMarkdown(container: HTMLElement, source: string, document: Document): void {
  let remaining = source
  while (remaining.length > 0) {
    const match = INLINE_MARKDOWN_PATTERN.exec(remaining)
    if (!match || match.index === undefined) {
      container.appendChild(document.createTextNode(remaining))
      return
    }

    if (match.index > 0) container.appendChild(document.createTextNode(remaining.slice(0, match.index)))

    if (match[1] !== undefined && match[2] !== undefined) {
      const href = safeLink(match[2])
      if (href) {
        const link = document.createElement('a')
        link.href = href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        appendInlineMarkdown(link, match[1], document)
        container.appendChild(link)
      } else {
        container.appendChild(document.createTextNode(match[1]))
      }
    } else if (match[3] !== undefined) {
      const code = document.createElement('code')
      code.textContent = match[3]
      container.appendChild(code)
    } else {
      const tag = match[4] !== undefined || match[5] !== undefined
        ? 'strong'
        : match[6] !== undefined
          ? 'del'
          : 'em'
      const content = match[4] ?? match[5] ?? match[6] ?? match[7] ?? match[8] ?? ''
      const emphasis = document.createElement(tag)
      appendInlineMarkdown(emphasis, content, document)
      container.appendChild(emphasis)
    }

    remaining = remaining.slice(match.index + match[0].length)
  }
}

function appendAlert(container: HTMLElement, lines: string[], document: Document): boolean {
  const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]$/i.exec(lines[0]?.trim() ?? '')
  if (!alert) return false

  const type = alert[1].toLowerCase()
  const wrapper = document.createElement('div')
  wrapper.className = `markdown-alert markdown-alert-${type}`
  const title = document.createElement('p')
  title.className = 'markdown-alert-title'
  title.textContent = type[0].toUpperCase() + type.slice(1)
  wrapper.appendChild(title)
  if (lines.length > 1) {
    const body = document.createElement('p')
    appendInlineMarkdown(body, lines.slice(1).join(' '), document)
    wrapper.appendChild(body)
  }
  container.appendChild(wrapper)
  return true
}

function renderMarkdown(source: string, document: Document): string {
  const container = document.createElement('div')
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: HTMLOListElement | HTMLUListElement | undefined

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const element = document.createElement('p')
    appendInlineMarkdown(element, paragraph.join(' '), document)
    container.appendChild(element)
    paragraph = []
  }
  const flushList = (): void => { list = undefined }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const fence = /^\s*```/.exec(line)
    if (fence) {
      flushParagraph()
      flushList()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = codeLines.join('\n')
      pre.appendChild(code)
      container.appendChild(pre)
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const element = document.createElement(`h${heading[1].length}`)
      appendInlineMarkdown(element, heading[2], document)
      container.appendChild(element)
      continue
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph()
      flushList()
      container.appendChild(document.createElement('hr'))
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      flushList()
      const quoteLines = [quote[1]]
      while (index + 1 < lines.length) {
        const next = /^\s*>\s?(.*)$/.exec(lines[index + 1])
        if (!next) break
        quoteLines.push(next[1])
        index += 1
      }
      if (!appendAlert(container, quoteLines, document)) {
        const blockquote = document.createElement('blockquote')
        appendInlineMarkdown(blockquote, quoteLines.join(' '), document)
        container.appendChild(blockquote)
      }
      continue
    }

    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      flushParagraph()
      const desiredTag = ordered ? 'OL' : 'UL'
      if (!list || list.tagName !== desiredTag) {
        list = document.createElement(ordered ? 'ol' : 'ul')
        container.appendChild(list)
      }
      const item = document.createElement('li')
      appendInlineMarkdown(item, (ordered ?? unordered)![1], document)
      list.appendChild(item)
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushParagraph()
  return container.innerHTML
}

export function formatReleaseNotes(source: string): string {
  const bounded = source.slice(0, MAX_RELEASE_NOTES_LENGTH).trim()
  if (!bounded) return ''
  return HTML_BLOCK_PATTERN.test(bounded)
    ? sanitizeHtml(bounded, document)
    : renderMarkdown(bounded, document)
}
