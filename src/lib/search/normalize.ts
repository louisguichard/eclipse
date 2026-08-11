const DIACRITICS = /[\u0300-\u036f]/g
const NON_WORD = /[^\p{L}\p{N}]+/gu

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(NON_WORD, ' ')
    .trim()
}

export function textMatchRank(query: string, candidate: string): number {
  const normalizedQuery = normalizeSearchText(query)
  const normalizedCandidate = normalizeSearchText(candidate)
  if (!normalizedQuery || !normalizedCandidate) return 100
  if (normalizedCandidate === normalizedQuery) return 0
  if (normalizedCandidate.startsWith(`${normalizedQuery} `)) return 4
  if (normalizedCandidate.startsWith(normalizedQuery)) return 6
  if (normalizedCandidate.includes(` ${normalizedQuery}`)) return 10

  const queryTokens = normalizedQuery.split(' ')
  const candidateTokens = normalizedCandidate.split(' ')
  if (queryTokens.every((token) => candidateTokens.some((word) => word.startsWith(token)))) {
    return 14
  }
  if (queryTokens.every((token) => normalizedCandidate.includes(token))) return 22
  return 60
}

export function hasValidCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
}

export function abortError(): DOMException {
  return new DOMException('Recherche annulée', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error != null
      && typeof error === 'object'
      && 'name' in error
      && error.name === 'AbortError')
}
