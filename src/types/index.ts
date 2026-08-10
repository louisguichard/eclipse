export type LatLng = {
  lat: number
  lng: number
}

export type LocationSource =
  | 'default'
  | 'search'
  | 'map'
  | 'geolocation'
  | 'url'
  | 'streetview'

export type ObserverLocation = LatLng & {
  label: string
  source: LocationSource
  placeId?: string
}

export type HorizontalCoordinates = {
  altitude: number
  azimuth: number
}

export type EclipseEvent = {
  time: Date
  altitude: number
}

export type EclipseCircumstances = {
  begin: EclipseEvent
  maximum: EclipseEvent
  end: EclipseEvent
  peakObscuration: number
  kind: string
}

export type EclipseSnapshot = {
  date: Date
  sun: HorizontalCoordinates
  moon: HorizontalCoordinates
  sunAngularRadius: number
  moonAngularRadius: number
  centerSeparation: number
  obscuration: number
  magnitude: number
  moonOffset: {
    horizontal: number
    vertical: number
  }
  circumstances: EclipseCircumstances
  sunset: Date | null
  phaseLabel: string
}

export type PanoramaStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error' | 'demo'

export type PanoramaState = {
  status: PanoramaStatus
  position: LatLng | null
  distanceMeters: number | null
  radiusMeters: number | null
  message?: string
}

export type StreetViewCamera = {
  heading: number
  pitch: number
  zoom: number
}

export type MobileView = 'map' | 'street'
