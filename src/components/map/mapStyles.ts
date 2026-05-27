import type L from 'leaflet'
import type { PointType, RouteType } from '../../types/race'

export const POINT_ICONS: Record<PointType, string> = {
  exit: '🚩',
  helipad: '🚁',
  aid: '🏕️',
  parking: '🅿️',
  custom: '📍',
}

export const TERRAIN_STYLES: Record<'trail' | 'road', L.PolylineOptions> = {
  trail: { color: '#16a34a', weight: 4, opacity: 0.85 },
  road:  { color: '#f59e0b', weight: 4, opacity: 0.9, dashArray: '10,4' },
}

export const CANDIDATE_COLORS = [
  '#f97316', // orange
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f59e0b', // amber
]

export const ROUTE_STYLES: Record<RouteType, L.PolylineOptions> = {
  course:      { color: '#16a34a', weight: 4, opacity: 0.85 },
  escape:      { color: '#2563eb', weight: 3, opacity: 0.8 },
  road_access: { color: '#9ca3af', weight: 2, opacity: 0.7, dashArray: '8,5' },
}
