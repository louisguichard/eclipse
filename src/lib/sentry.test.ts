import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import {
  isInjectedAnchorSerializationError,
  isMapLibreShaderCompilationError,
  isUnhandledMapLibreShaderCompilationError,
} from './sentry'

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

  it('recognizes MapLibre shader failures from the runtime error stack', () => {
    const error = new Error('Could not compile fragment shader: null')
    error.stack = 'Error: shader\n at GT (https://example.test/assets/maplibre-gl-abc.js:1:2)'

    expect(isMapLibreShaderCompilationError(error)).toBe(true)
    expect(isMapLibreShaderCompilationError(new Error(error.message))).toBe(false)
  })

  it('drops only the original unhandled MapLibre shader event', () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [{
          type: 'Error',
          value: 'Could not compile fragment shader:',
          stacktrace: { frames: [{ filename: '/assets/maplibre-gl-abc.js' }] },
        }],
      },
    }

    expect(isUnhandledMapLibreShaderCompilationError(event)).toBe(true)
    expect(isUnhandledMapLibreShaderCompilationError({
      ...event,
      tags: { failure_area: 'basemap-renderer' },
    })).toBe(false)
  })
})
