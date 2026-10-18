export interface CommercialLicenseProviderResult {
  valid: boolean
  status: string
  productId: string
  instanceId?: string
  activations?: number
  activationLimit?: number | null
  expiresAt?: string | null
}

export interface CommercialLicenseState {
  accessAllowed?: boolean
  trialStatus?: 'not-started' | 'active' | 'expired'
  trialExpiresAt?: string
  status: string
  active: boolean
  secureStorageAvailable: boolean
  maskedKey?: string
  activations?: number
  activationLimit?: number | null
  expiresAt?: string | null
  lastValidatedAt?: string
  message?: string
}
