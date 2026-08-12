export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Waits between provider retries without delaying navigation or unmounting. */
export function waitForRetry(
  failedAttempt: number,
  baseDelayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Chargement annulé', 'AbortError'))
  }

  const exponentialDelay = baseDelayMs * (2 ** failedAttempt)
  const jitter = Math.floor(Math.random() * baseDelayMs * 0.25)
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = () => {
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Chargement annulé', 'AbortError'))
    }
    const timeout = globalThis.setTimeout(finish, exponentialDelay + jitter)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
