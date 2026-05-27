import type { LatLng, LatLngEle } from '../types/race'

const R = 6371000

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const k = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(k), Math.sqrt(1 - k))
}

export function totalDistanceM(coords: LatLng[]): number {
  let d = 0
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i])
  return d
}

export function elevationStats(coords: LatLngEle[]): { descentM: number; ascentM: number } {
  let descentM = 0, ascentM = 0
  for (let i = 1; i < coords.length; i++) {
    const diff = coords[i].ele - coords[i - 1].ele
    if (diff > 0) ascentM += diff
    else descentM += Math.abs(diff)
  }
  return { descentM, ascentM }
}

// 点Pから線分P0→P1への最短距離と垂足を返す
export function pointToSegment(p: LatLng, p0: LatLng, p1: LatLng): { dist: number; ratio: number; foot: LatLng } {
  const dx = p1.lng - p0.lng
  const dy = p1.lat - p0.lat
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { dist: haversine(p, p0), ratio: 0, foot: p0 }
  const t = Math.max(0, Math.min(1, ((p.lng - p0.lng) * dx + (p.lat - p0.lat) * dy) / len2))
  const foot = { lat: p0.lat + t * dy, lng: p0.lng + t * dx }
  return { dist: haversine(p, foot), ratio: t, foot }
}

// GPX座標列に対してスナップ点を求める（100m超は null）
export function snapToRoute(p: LatLng, coords: LatLng[]): { segmentIndex: number; ratio: number; foot: LatLng; dist: number } | null {
  let best: { segmentIndex: number; ratio: number; foot: LatLng; dist: number } | null = null
  for (let i = 0; i < coords.length - 1; i++) {
    const { dist, ratio, foot } = pointToSegment(p, coords[i], coords[i + 1])
    if (!best || dist < best.dist) best = { segmentIndex: i, ratio, foot, dist }
  }
  if (!best || best.dist > 100) return null
  return best
}

export async function fetchElevation(lat: number, lng: number): Promise<number> {
  try {
    const res = await fetch(
      `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng}&lat=${lat}&outtype=JSON`
    )
    const data = await res.json()
    return typeof data.elevation === 'number' ? data.elevation : 0
  } catch {
    return 0
  }
}

export function interpolateEle(coords: LatLngEle[], segIdx: number, ratio: number): number {
  const a = coords[segIdx], b = coords[segIdx + 1] ?? a
  return a.ele + ratio * (b.ele - a.ele)
}
