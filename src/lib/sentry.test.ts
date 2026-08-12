import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { isInjectedAnchorSerializationError } from './sentry'

const INJECTED_ERROR = [
  'Converting circular structure to JSON',
  "--> starting at object with constructor 'HTMLAnchorElement'",
  "| property '__reactFiber$2rnm9ti4w0f' -> object with constructor 'ni'",
  "--- property 'stateNode' closes the circle",
].join(' ')

function eventWith(value: string, inApplication?: boolean): ErrorEvent {
  return {
    type: undefined,
    exception: {
      values: [{
        type: 'TypeError',
        value,
        stacktrace: inApplication === undefined
          ? undefined
          : { frames: [{ in_app: inApplication }] },
      }],
    },
  }
}

describe('Sentry browser-noise filtering', () => {
  it('drops an injected navigation tracker serializing a React anchor', () => {
    expect(isInjectedAnchorSerializationError(eventWith(INJECTED_ERROR))).toBe(true)
  })

  it('keeps the same error when an application frame is involved', () => {
    expect(isInjectedAnchorSerializationError(eventWith(INJECTED_ERROR, true))).toBe(false)
  })

  it('keeps unrelated circular JSON errors', () => {
    expect(isInjectedAnchorSerializationError(eventWith(
      'Converting circular structure to JSON --> starting at object with constructor Object',
    ))).toBe(false)
  })
})
