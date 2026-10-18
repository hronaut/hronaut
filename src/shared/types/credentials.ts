export interface CredentialSummary {
  id: string
  origin: string
  username: string
  createdAt: string
  updatedAt: string
}

export interface CredentialStorageStatus {
  available: boolean
  backend?: string
  reason?: string
}

export interface CredentialImportResult {
  canceled: boolean
  added: number
  updated: number
  skipped: number
}
