import type {
  BrowserNetworkRequest,
  BrowserNetworkRequestSortBy,
  BrowserNetworkRequestSortDirection
} from './types.js'

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function sortValue(request: BrowserNetworkRequest, sortBy: BrowserNetworkRequestSortBy): number | undefined {
  if (sortBy === 'start-time') return timestamp(request.startedAt)
  if (sortBy === 'end-time') return timestamp(request.completedAt)
  if (sortBy === 'duration') return request.durationMs
  if (sortBy === 'waiting') return request.waitingForResponseMs
  if (sortBy === 'size') return request.responseSizeBytes
  return request.status
}

export function sortNetworkRequests(
  requests: BrowserNetworkRequest[],
  sortBy: BrowserNetworkRequestSortBy = 'start-time',
  direction: BrowserNetworkRequestSortDirection = 'asc'
): BrowserNetworkRequest[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return requests
    .map((request, index) => ({ request, index, value: sortValue(request, sortBy) }))
    .sort((left, right) => {
      if (left.value === undefined && right.value === undefined) return left.index - right.index
      if (left.value === undefined) return 1
      if (right.value === undefined) return -1
      const compared = (left.value - right.value) * multiplier
      return compared || left.index - right.index
    })
    .map(({ request }) => request)
}
