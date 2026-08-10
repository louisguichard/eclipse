import { describe, expect, it } from 'vitest'
import { PanoramaMovementTracker } from './streetview'

const INITIAL = { lat: 48.8566, lng: 2.3522 }
const NEXT = { lat: 48.8569, lng: 2.3518 }
const STALE = { lat: 48.8584, lng: 2.2945 }

describe('PanoramaMovementTracker', () => {
  it('silences the position installed by the initial panorama lookup', () => {
    const tracker = new PanoramaMovementTracker()
    tracker.markProgrammatic('initial-pano', INITIAL)

    expect(tracker.observe('initial-pano', INITIAL)).toBe('programmatic')
    expect(tracker.observe('initial-pano', INITIAL)).toBe('duplicate')
  })

  it('keeps stale transition events programmatic until the requested panorama arrives', () => {
    const tracker = new PanoramaMovementTracker()
    tracker.remember(STALE, 'previous-pano')
    tracker.markProgrammatic('initial-pano', INITIAL)

    expect(tracker.observe('previous-pano', STALE)).toBe('programmatic')
    expect(tracker.observe('initial-pano', INITIAL)).toBe('programmatic')
    expect(tracker.observe('initial-pano', INITIAL)).toBe('duplicate')
  })

  it('treats coordinate jitter from the same panorama as a duplicate', () => {
    const tracker = new PanoramaMovementTracker()
    tracker.markProgrammatic('initial-pano', INITIAL)
    tracker.observe('initial-pano', INITIAL)

    expect(tracker.observe('initial-pano', { lat: 48.85661, lng: 2.35221 })).toBe('duplicate')
  })

  it('reports a walk to another panorama as a user position', () => {
    const tracker = new PanoramaMovementTracker()
    tracker.markProgrammatic('initial-pano', INITIAL)
    tracker.observe('initial-pano', INITIAL)

    expect(tracker.observe('next-pano', NEXT)).toBe('user')
    expect(tracker.observe('next-pano', NEXT)).toBe('duplicate')
  })

  it('accepts an explicit navigation even if the lookup event has not arrived', () => {
    const tracker = new PanoramaMovementTracker()
    tracker.markProgrammatic('missing-event-pano', INITIAL)
    tracker.markUserNavigation('user-pano')

    expect(tracker.observe('user-pano', NEXT)).toBe('user')
    expect(tracker.observe('user-pano', NEXT)).toBe('duplicate')
  })
})
