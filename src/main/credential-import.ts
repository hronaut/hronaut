export const MAX_CREDENTIAL_IMPORT_ROWS = 3_000

export interface ImportedCredential {
  origin: string
  username: string
  password: string
}

export interface ParsedCredentialImport {
  credentials: ImportedCredential[]
  skippedRows: number
}

export type CredentialImportErrorCode =
  | 'invalid_csv'
  | 'missing_columns'
  | 'too_many_rows'
  | 'no_credentials'

export class CredentialImportError extends Error {
  constructor(readonly code: CredentialImportErrorCode) {
    super(code)
    this.name = 'CredentialImportError'
  }
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false

  const finishField = (): void => {
    row.push(field)
    field = ''
    afterQuote = false
  }
  const finishRow = (): void => {
    finishField()
    rows.push(row)
    row = []
    if (rows.length > MAX_CREDENTIAL_IMPORT_ROWS + 1) throw new CredentialImportError('too_many_rows')
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quoted) {
      if (character !== '"') {
        field += character
        continue
      }
      if (source[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = false
        afterQuote = true
      }
      continue
    }
    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new CredentialImportError('invalid_csv')
    }
    if (character === '"') {
      if (field.length) throw new CredentialImportError('invalid_csv')
      quoted = true
      continue
    }
    if (character === ',') {
      finishField()
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      finishRow()
      continue
    }
    field += character
  }

  if (quoted) throw new CredentialImportError('invalid_csv')
  if (field.length || row.length) finishRow()
  return rows
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

function columnIndex(headers: string[], candidates: readonly string[]): number {
  return headers.findIndex((header) => candidates.includes(header))
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

export function parseCredentialImportCsv(source: string): ParsedCredentialImport {
  if (source.includes('\u0000')) throw new CredentialImportError('invalid_csv')
  const rows = parseCsvRows(source)
  const header = rows.shift()
  if (!header) throw new CredentialImportError('missing_columns')
  const headers = header.map(normalizedHeader)
  const urlIndex = columnIndex(headers, ['url', 'website', 'origin'])
  const usernameIndex = columnIndex(headers, ['username', 'user', 'login'])
  const passwordIndex = columnIndex(headers, ['password', 'pass'])
  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    throw new CredentialImportError('missing_columns')
  }

  const credentials: ImportedCredential[] = []
  let skippedRows = 0
  for (const row of rows) {
    if (row.every((value) => value === '')) continue
    const origin = normalizedOrigin(row[urlIndex] ?? '')
    const username = row[usernameIndex] ?? ''
    const password = row[passwordIndex] ?? ''
    if (!origin
      || username.length > 512
      || !password
      || password.length > 16_384
      || username.includes('\u0000')
      || password.includes('\u0000')) {
      skippedRows += 1
      continue
    }
    credentials.push({ origin, username, password })
  }
  if (!credentials.length) throw new CredentialImportError('no_credentials')
  return { credentials, skippedRows }
}
