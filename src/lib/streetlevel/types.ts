import type { LatLng } from '../../types'

export type StreetLevelSize = {
  width: number
  height: number
}

export type StreetLevelLink = {
  pano: string
  heading: number
  position: LatLng
  panoramaHeading: number | null
  pitchCorrection: number
  rollCorrection: number
}

export type StreetLevelPanorama = {
  id: string
  position: LatLng
  /** Compass heading at the horizontal centre of the raw equirectangular image. */
  heading: number
  pitchCorrection: number
  rollCorrection: number
  tileSize: StreetLevelSize
  imageSizes: StreetLevelSize[]
  links: StreetLevelLink[]
  copyright: string
  source: string | null
}

export type StreetLevelPanoramaImage = {
  url: string
  width: number
  height: number
  zoom: number
}

export type StreetLevelTile = {
  x: number
  y: number
  url: string
}
