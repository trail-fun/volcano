export type LatLng = { lat: number; lng: number }
export type LatLngEle = LatLng & { ele: number }

export type PointType = 'exit' | 'helipad' | 'aid' | 'parking' | 'custom'

export type Point = {
  id: string
  name: string
  type: PointType
  lat: number
  lng: number
  note: string
  enabled: boolean
}

export type Terrain = 'trail' | 'road'

export type Segment = {
  startIndex: number
  endIndex: number
  terrain: Terrain
  name: string
}

export type Junction = {
  routeId: string
  lat: number
  lng: number
  segmentIndex: number
  ratio: number
  note: string
}

export type RouteType = 'course' | 'escape' | 'road_access'
export type Difficulty = 'low' | 'medium' | 'high'
export type Transport = 'walk' | 'stretcher' | 'helicopter'

export type Route = {
  id: string
  name: string
  type: RouteType
  gpxFile: string
  coords: LatLngEle[]
  difficulty: Difficulty
  transportSuitability: Transport[]
  segments: Segment[]
  junction: Junction | null
}

export type Race = {
  id: string
  name: string
  date: string
  description: string
}
