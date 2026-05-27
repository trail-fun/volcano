import { snapToRoute, haversine, elevationStats, interpolateEle } from '../utils/geo'
import type { LatLng, Route, Point, LatLngEle } from '../types/race'
import type { RouteCandidate, CandidateSegment } from '../types/candidate'

function hasRoadSection(routes: Route[], segs: CandidateSegment[]): boolean {
  for (const seg of segs) {
    const route = routes.find(r => r.id === seg.routeId)
    if (!route || route.segments.length === 0) continue
    const lo = Math.min(seg.fromIndex, seg.toIndex)
    const hi = Math.max(seg.fromIndex, seg.toIndex)
    for (const ts of route.segments) {
      // candidate covers edges lo..hi-1; road segment covers edges startIndex..endIndex-1
      if (ts.terrain === 'road' && ts.startIndex < hi && ts.endIndex > lo) return true
    }
  }
  return false
}

function sliceCoords(coords: LatLngEle[], fromIdx: number, fromRatio: number, toIdx: number, toRatio: number): LatLngEle[] {
  const from: LatLngEle = {
    lat: coords[fromIdx].lat + fromRatio * (coords[fromIdx + 1]?.lat - coords[fromIdx].lat || 0),
    lng: coords[fromIdx].lng + fromRatio * (coords[fromIdx + 1]?.lng - coords[fromIdx].lng || 0),
    ele: interpolateEle(coords, fromIdx, fromRatio),
  }
  const mid = coords.slice(fromIdx + 1, toIdx + 1)
  const to: LatLngEle = {
    lat: coords[toIdx].lat + toRatio * (coords[toIdx + 1]?.lat - coords[toIdx].lat || 0),
    lng: coords[toIdx].lng + toRatio * (coords[toIdx + 1]?.lng - coords[toIdx].lng || 0),
    ele: interpolateEle(coords, toIdx, toRatio),
  }
  return [from, ...mid, to]
}

export function calcCandidates(
  pos: LatLng,
  routes: Route[],
  points: Point[],
): RouteCandidate[] {
  const goals = points.filter(p => (p.type === 'exit' || p.type === 'helipad') && p.enabled)
  if (goals.length === 0) return []

  const mainRoute = routes.find(r => r.type === 'course')
  if (!mainRoute || mainRoute.coords.length < 2) return []

  const snap = snapToRoute(pos, mainRoute.coords)
  if (!snap) return []

  const { segmentIndex: snapIdx, ratio: snapRatio } = snap
  const coords = mainRoute.coords
  const candidates: RouteCandidate[] = []

  // ── メインコース上のゴール地点（進行・引き返し） ──
  for (const goal of goals) {
    const rawGoalSnap = snapToRoute(goal, coords)
    if (!rawGoalSnap) continue
    // Snap to nearest coordinate index so terrain boundary comparisons work correctly.
    // A goal at coords[k] (end of road edge k-1 / start of trail edge k) must resolve to
    // coordinate k, not segment k-1, to avoid false hasRoadSection positives.
    const goalCoordIdx = rawGoalSnap.ratio >= 0.5
      ? Math.min(rawGoalSnap.segmentIndex + 1, coords.length - 1)
      : rawGoalSnap.segmentIndex
    const goalIdx = goalCoordIdx < coords.length - 1 ? goalCoordIdx : goalCoordIdx - 1
    const goalRatio = goalCoordIdx < coords.length - 1 ? 0.0 : 1.0

    const isForward = goalIdx > snapIdx || (goalIdx === snapIdx && goalRatio >= snapRatio)
    const direction = isForward ? 'forward' : 'backward'

    let pathCoords: LatLngEle[]
    if (isForward) {
      pathCoords = sliceCoords(coords, snapIdx, snapRatio, goalIdx, goalRatio)
    } else {
      pathCoords = sliceCoords(coords, goalIdx, goalRatio, snapIdx, snapRatio).reverse()
    }

    const distM = pathCoords.reduce((s, _, i) => i === 0 ? s : s + haversine(pathCoords[i - 1], pathCoords[i]), 0)
    const { descentM, ascentM } = elevationStats(pathCoords)

    candidates.push({
      id: `main_${direction}_${goal.id}`,
      label: direction === 'forward' ? 'メインコース（進行方向）' : 'メインコース（引き返し）',
      exitPointId: goal.id,
      exitPointName: goal.name,
      exitPointType: goal.type as 'exit' | 'helipad',
      segments: [{ routeId: mainRoute.id, direction, fromIndex: snapIdx, toIndex: goalIdx }],
      totalDistanceM: distM,
      totalDescentM: descentM,
      totalAscentM: ascentM,
      difficulty: mainRoute.difficulty,
      transportSuitability: mainRoute.transportSuitability,
    })
  }

  // ── エスケープルート経由 ──
  const escapeRoutes = routes.filter(r => r.type === 'escape' && r.junction && r.coords.length > 1)
  for (const esc of escapeRoutes) {
    const junc = esc.junction!
    const juncSnap = snapToRoute(junc, coords)
    if (!juncSnap) continue

    const escGoals = goals.filter(g => {
      const gs = snapToRoute(g, esc.coords)
      return gs !== null
    })

    for (const goal of escGoals) {
      const goalSnap = snapToRoute(goal, esc.coords)
      if (!goalSnap) continue

      for (const direction of ['forward', 'backward'] as const) {
        const juncIdx = juncSnap.segmentIndex
        const juncRatio = juncSnap.ratio
        const isJuncForward = juncIdx > snapIdx || (juncIdx === snapIdx && juncRatio >= snapRatio)

        if (direction === 'forward' && !isJuncForward) continue
        if (direction === 'backward' && isJuncForward) continue

        let mainPath: LatLngEle[]
        if (direction === 'forward') {
          mainPath = sliceCoords(coords, snapIdx, snapRatio, juncIdx, juncRatio)
        } else {
          mainPath = sliceCoords(coords, juncIdx, juncRatio, snapIdx, snapRatio).reverse()
        }

        const escPath = sliceCoords(esc.coords, 0, 0, goalSnap.segmentIndex, goalSnap.ratio)
        const fullPath = [...mainPath, ...escPath]

        const distM = fullPath.reduce((s, _, i) => i === 0 ? s : s + haversine(fullPath[i - 1], fullPath[i]), 0)
        const { descentM, ascentM } = elevationStats(fullPath)

        candidates.push({
          id: `esc_${direction}_${esc.id}_${goal.id}`,
          label: `${esc.name}経由（${direction === 'forward' ? '前方分岐' : '後方分岐'}）`,
          exitPointId: goal.id,
          exitPointName: goal.name,
          exitPointType: goal.type as 'exit' | 'helipad',
          segments: [
            { routeId: mainRoute.id, direction, fromIndex: snapIdx, toIndex: juncIdx },
            { routeId: esc.id, direction: 'forward', fromIndex: 0, toIndex: goalSnap.segmentIndex },
          ],
          totalDistanceM: distM,
          totalDescentM: descentM,
          totalAscentM: ascentM,
          difficulty: esc.difficulty,
          transportSuitability: esc.transportSuitability,
        })
      }
    }
  }

  return candidates
    .filter(c => !hasRoadSection(routes, c.segments))
    .sort((a, b) => a.totalDistanceM - b.totalDistanceM)
}
