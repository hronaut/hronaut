import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface FormItem {
  type?: string
  id?: string
  attributes?: {
    value?: string
    options?: Array<{ label?: string; required?: boolean } | string>
  }
  validations?: { required?: boolean }
}

interface IssueForm {
  name?: string
  description?: string
  body?: FormItem[]
}

describe('setup feedback issue form', () => {
  it('parses with the required feedback fields and public-data guard', async () => {
    const source = await readFile('.github/ISSUE_TEMPLATE/setup-feedback.yml', 'utf8')
    const form = parse(source) as IssueForm

    expect(form.name).toBe('Setup feedback')
    expect(form.description).toContain('whether Hronaut connected')

    const items = form.body ?? []
    expect(items.filter((item) => item.id).map((item) => item.id)).toEqual([
      'client',
      'operating-system',
      'hronaut-version',
      'outcome',
      'experience',
      'improvement',
      'privacy'
    ])

    for (const id of ['client', 'operating-system', 'hronaut-version', 'outcome', 'experience']) {
      expect(items.find((item) => item.id === id)?.validations?.required, id).toBe(true)
    }

    expect(items.find((item) => item.id === 'client')?.attributes?.options).toEqual([
      'Codex',
      'Claude Code',
      'Cursor',
      'VS Code / GitHub Copilot',
      'OpenCode',
      'Gemini CLI',
      'Cline',
      'Kiro',
      'Kilo Code',
      'JetBrains Junie',
      'Devin Local',
      'Zed',
      'Mistral Vibe',
      'Warp',
      'Windsurf',
      'Another MCP client'
    ])

    const privacy = items.find((item) => item.id === 'privacy')
    expect(privacy?.type).toBe('checkboxes')
    expect(privacy?.attributes?.options).toEqual([
      {
        label: 'I removed credentials, tokens, private URLs, page content, and personal browser-session data.',
        required: true
      }
    ])

    const introduction = items.find((item) => item.type === 'markdown')?.attributes?.value ?? ''
    for (const warning of ['public', 'credentials', 'MCP bearer tokens', 'private URLs', 'page content', 'personal data']) {
      expect(introduction, warning).toContain(warning)
    }
  })
})
