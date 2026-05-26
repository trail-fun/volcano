import type L from 'leaflet'
import type { PointType, RouteType } from '../../types/race'

export const POINT_ICONS: Record<PointType, string> = {
  exit: '🚩',
  helipad: '🚁',
  aid: '🏕️',
  parking: '🅿️',
  custom: '📍',
}

export const ROUTE_STYLES: Record<RouteType, L.PolylineOptions> = {
  course:      { color: '#16a34a', weight: 4, opacity: 0.85 },
  escape:      { color: '#2563eb', weight: 3, opacity: 0.8 },
  road_access: { color: '#9ca3af', weight: 2, opacity: 0.7, dashArray: '8,5' },
}
