import { useRef, useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useProjectStore } from '../../store/projectStore'
import { useModeStore } from '../../store/modeStore'
import { useDrawingStore } from '../../store/drawingStore'
import { useMapStore } from '../../store/mapStore'
import { parseGpx } from '../../utils/gpxParser'
import { snapToRoute, fetchElevation, haversine, elevationStats } from '../../utils/geo'
import type { PointType, Route, Segment, LatLngEle, Point } from '../../types/race'
import { POINT_ICONS } from '../map/mapStyles'

const POINT_LABELS: Record<PointType, string> = {
  location: '地点', exit: '下山口', helipad: 'ヘリポート', aid: 'エイド', parking: '駐車場', danger: '危険箇所',
  closure: '通行止め', gate: '鍵', water: '水場', vending: '自販機', food: '食事', hut: '小屋', toilet: 'トイレ',
  custom: 'カスタム',
}

// Auto-compute segments from 'location' type points snapped to the route
function recomputeSegmentsForRoute(route: Route, allPoints: Point[]): Segment[] {
  const coords = route.coords
  if (coords.length < 2) return []
  const n = coords.length - 1

  const snapped = allPoints
    .filter(p => p.type === 'location')
    .flatMap(p => {
      const snap = snapToRoute(p, coords, 100)
      if (!snap) return []
      const idx = snap.ratio >= 0.5
        ? Math.min(snap.segmentIndex + 1, coords.length - 1)
        : snap.segmentIndex
      return idx > 0 && idx < coords.length - 1 ? [{ idx, name: p.name }] : []
    })
    .filter((v, i, arr) => arr.findIndex(x => x.idx === v.idx) === i)
    .sort((a, b) => a.idx - b.idx)

  // idx → point name map (endpoints are スタート / フィニッシュ)
  const idxToName = new Map<number, string>([[0, 'スタート'], [n, 'フィニッシュ']])
  for (const { idx, name } of snapped) idxToName.set(idx, name)

  const boundaries = [0, ...snapped.map(s => s.idx), n]

  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1]
    const existing = route.segments.find(s => s.startIndex === start && s.endIndex === end)
    const defaultName = `${idxToName.get(start) ?? 'スタート'}〜${idxToName.get(end) ?? 'フィニッシュ'}`
    return {
      startIndex: start,
      endIndex: end,
      name: existing?.name || defaultName,
      courseTime: existing?.courseTime ?? '',
      breakTime: existing?.breakTime ?? '',
    }
  })
}

function parseTime(t: string): number {
  if (!t) return 0
  if (!t.includes(':')) return parseInt(t) || 0  // 分のみ入力
  const parts = t.split(':').map(Number)
  return (parts[0] || 0) * 60 + (parts[1] || 0)
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

// 入力値を hh:mm 形式に正規化して保存
function normalizeCourseTime(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (/^\d+:[0-5]?\d$/.test(s)) return formatTime(parseTime(s))  // hh:mm
  if (/^\d+$/.test(s)) return formatTime(parseInt(s))              // 分のみ
  return s
}

type Props = { pendingLatLng: { lat: number; lng: number } | null; clearPending: () => void }

export default function EditPanel({ pendingLatLng, clearPending }: Props) {
  const { race, routes, points, history, setRace, exportToZip, addPoint, updatePoint, deletePoint, addRoute, updateRoute, setJunction, undo } = useRaceStore()
  const { activeTool, setActiveTool } = useModeStore()
  const { routeType: drawingRouteType, points: drawingPoints, startDrawing, removeLastPoint, clearDrawing } = useDrawingStore()
  const { fitBounds, panTo, setHiddenCourseRanges } = useMapStore()
  const escGpxRef = useRef<HTMLInputElement>(null)
  const roadGpxRef = useRef<HTMLInputElement>(null)
  const newPointPhotoRef = useRef<HTMLInputElement>(null)
  const editPointPhotoRef = useRef<HTMLInputElement>(null)

  const [newPoint, setNewPoint] = useState<{ type: PointType; name: string; note: string; cp: boolean; section: boolean; photos: string[] } | null>(null)
  const [editPointId, setEditPointId] = useState<string | null>(null)
  const [editRouteId, setEditRouteId] = useState<string | null>(null)
  const [editRouteName, setEditRouteName] = useState('')
  const [editSegmentIdx, setEditSegmentIdx] = useState<number | null>(null)
  const [editSegmentName, setEditSegmentName] = useState('')
  const [editCourseTime, setEditCourseTime] = useState('')
  const [editBreakTime, setEditBreakTime] = useState('')
  const [hiddenSections, setHiddenSections] = useState<Set<number>>(new Set())
  const [editCPInterval, setEditCPInterval] = useState<{ fromCoordIdx: number; toCoordIdx: number; fromName: string; toName: string } | null>(null)
  const [editCPMultiplier, setEditCPMultiplier] = useState('1.0')
  const [editSectionForCP, setEditSectionForCP] = useState<{ fromCoordIdx: number; toCoordIdx: number; fromName: string; toName: string } | null>(null)
  const [editSectionMultiplier, setEditSectionMultiplier] = useState('1.0')
  const [showGeoDialog, setShowGeoDialog] = useState(false)
  const [cloudSaveMsg, setCloudSaveMsg] = useState<string | null>(null)
  const { saveProject, saving } = useProjectStore()
  const [geoText, setGeoText] = useState('')

  const [snapConfirm, setSnapConfirm] = useState<{
    original: { lat: number; lng: number }
    snapped: { lat: number; lng: number }
    routeName: string; routeId: string; segmentIndex: number; ratio: number
  } | null>(null)
  const [pointPos, setPointPos] = useState<{ lat: number; lng: number } | null>(null)
  const [insertingCoord, setInsertingCoord] = useState(false)

  const [junctionRouteId, setJunctionRouteId] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingLatLng || activeTool !== 'set_junction' || !junctionRouteId) return
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute) { clearPending(); return }
    const snap = snapToRoute(pendingLatLng, mainRoute.coords, 5000)
    if (!snap) { clearPending(); return }
    setJunction(junctionRouteId, {
      routeId: mainRoute.id,
      lat: snap.foot.lat,
      lng: snap.foot.lng,
      segmentIndex: snap.segmentIndex,
      ratio: snap.ratio,
      note: '',
    })
    setJunctionRouteId(null)
    clearPending()
    setActiveTool('none')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLatLng])

  const [drawingName, setDrawingName] = useState('')
  const [fetchingEle, setFetchingEle] = useState(false)

  const startDrawingRoute = (type: 'escape' | 'road_access') => {
    startDrawing(type)
    setDrawingName(type === 'escape' ? 'エスケープルート' : '車道ルート')
    setActiveTool('draw_route')
  }

  const cancelDrawing = () => {
    clearDrawing()
    setDrawingName('')
    setActiveTool('none')
  }

  const finishDrawing = async () => {
    if (!drawingRouteType || drawingPoints.length < 2) return
    setFetchingEle(true)
    const elevations = await Promise.all(drawingPoints.map(p => fetchElevation(p.lat, p.lng)))
    const coords: LatLngEle[] = drawingPoints.map((p, i) => ({ ...p, ele: elevations[i] }))
    const route: Route = {
      id: crypto.randomUUID(),
      name: drawingName || (drawingRouteType === 'escape' ? 'エスケープルート' : '車道ルート'),
      type: drawingRouteType,
      gpxFile: `${crypto.randomUUID()}.gpx`,
      coords,
      difficulty: drawingRouteType === 'escape' ? 'medium' : 'low',
      transportSuitability: ['walk'],
      segments: [],
      junction: null,
    }
    addRoute(route)
    setFetchingEle(false)
    clearDrawing()
    setDrawingName('')
    setActiveTool('none')
  }

  useEffect(() => {
    if (!pendingLatLng || activeTool !== 'add_point' || newPoint !== null || snapConfirm !== null) return
    let closest: { snap: { foot: { lat: number; lng: number }; segmentIndex: number; ratio: number }; route: Route } | null = null
    for (const route of routes) {
      if (route.coords.length < 2) continue
      const snap = snapToRoute(pendingLatLng, route.coords, 100)
      if (!snap) continue
      if (!closest || haversine(pendingLatLng, snap.foot) < haversine(pendingLatLng, closest.snap.foot)) {
        closest = { snap, route }
      }
    }
    if (closest) {
      setSnapConfirm({
        original: pendingLatLng,
        snapped: closest.snap.foot,
        routeName: closest.route.name,
        routeId: closest.route.id,
        segmentIndex: closest.snap.segmentIndex,
        ratio: closest.snap.ratio,
      })
    } else {
      setPointPos(pendingLatLng)
      setNewPoint({ type: 'location', name: '', note: '', cp: false, section: false, photos: [] })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLatLng])

  const handleSnapYes = async () => {
    if (!snapConfirm) return
    const { snapped, routeId, segmentIndex, ratio } = snapConfirm
    setPointPos(snapped)
    if (ratio > 0.05 && ratio < 0.95) {
      setInsertingCoord(true)
      const route = routes.find(r => r.id === routeId)
      if (route) {
        const ele = await fetchElevation(snapped.lat, snapped.lng)
        const insertAt = segmentIndex + 1
        const newCoord: LatLngEle = { lat: snapped.lat, lng: snapped.lng, ele }
        const newCoords = [...route.coords.slice(0, insertAt), newCoord, ...route.coords.slice(insertAt)]
        const newSegments = route.segments.map(s => ({
          ...s,
          startIndex: s.startIndex >= insertAt ? s.startIndex + 1 : s.startIndex,
          endIndex:   s.endIndex   >= insertAt ? s.endIndex   + 1 : s.endIndex,
        }))
        const newJunction = route.junction && route.junction.segmentIndex >= segmentIndex
          ? { ...route.junction, segmentIndex: route.junction.segmentIndex + 1 }
          : route.junction
        updateRoute(routeId, { coords: newCoords, segments: newSegments, junction: newJunction })
      }
      setInsertingCoord(false)
    }
    setSnapConfirm(null)
    setNewPoint({ type: 'location', name: '', note: '', cp: false, section: false, photos: [] })
  }

  const handleSnapNo = () => {
    if (!snapConfirm) return
    setPointPos(snapConfirm.original)
    setSnapConfirm(null)
    setNewPoint({ type: 'location', name: '', note: '', cp: false, section: false, photos: [] })
  }

  const saveNewPoint = () => {
    if (!newPoint || !pointPos) return
    const point: Point = {
      id: crypto.randomUUID(),
      lat: pointPos.lat,
      lng: pointPos.lng,
      type: newPoint.type,
      name: newPoint.name,
      note: newPoint.note,
      cp: newPoint.cp,
      section: newPoint.section,
      enabled: true,
      photos: newPoint.photos,
    }
    const mainRoute = routes.find(r => r.type === 'course')
    if (point.type === 'location' && mainRoute) {
      const newPoints = [...points, point]
      const newSegments = recomputeSegmentsForRoute(mainRoute, newPoints)
      addPoint(point)
      updateRoute(mainRoute.id, { segments: newSegments })
    } else {
      addPoint(point)
    }
    setNewPoint(null)
    setPointPos(null)
    clearPending()
    setActiveTool('none')
  }

  const saveGeoPoint = () => {
    const lines = geoText.split('\n').map(l => l.trim()).filter(l => l)
    let markerLabel = '', name = '', lat = NaN, lng = NaN
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const markerMatch = line.match(/^マーカー[：:](.+)/)
      if (markerMatch) { markerLabel = markerMatch[1].trim(); continue }
      const memoMatch = line.match(/^メモ[：:](.*)/)
      if (memoMatch) {
        name = memoMatch[1].trim()
        const next = lines[i + 1] ?? ''
        const coords = next.match(/([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)/)
        if (coords) { lat = parseFloat(coords[1]); lng = parseFloat(coords[2]) }
        continue
      }
    }
    if (isNaN(lat) || isNaN(lng)) return
    const matchedType = (Object.entries(POINT_LABELS) as [PointType, string][])
      .find(([, label]) => label === markerLabel)
    const type: PointType = matchedType ? matchedType[0] : 'custom'
    const point: Point = {
      id: crypto.randomUUID(), lat, lng, type,
      name: name || markerLabel, note: '', cp: false, section: false, enabled: true, photos: [],
    }
    const mr = routes.find(r => r.type === 'course')
    if (point.type === 'location' && mr) {
      const newPoints = [...points, point]
      addPoint(point)
      updateRoute(mr.id, { segments: recomputeSegmentsForRoute(mr, newPoints) })
    } else {
      addPoint(point)
    }
    setGeoText('')
    setShowGeoDialog(false)
  }

  const handleDeletePoint = (pointId: string) => {
    const pt = points.find(p => p.id === pointId)
    const mainRoute = routes.find(r => r.type === 'course')
    if (pt?.type === 'location' && mainRoute) {
      const newPoints = points.filter(p => p.id !== pointId)
      const newSegments = recomputeSegmentsForRoute(mainRoute, newPoints)
      deletePoint(pointId)
      updateRoute(mainRoute.id, { segments: newSegments })
    } else {
      deletePoint(pointId)
    }
  }

  const handleUpdatePointType = (id: string, type: PointType) => {
    const pt = points.find(p => p.id === id)
    const mainRoute = routes.find(r => r.type === 'course')
    if (mainRoute && (pt?.type === 'location' || type === 'location')) {
      const newPoints = points.map(p => p.id === id ? { ...p, type } : p)
      const newSegments = recomputeSegmentsForRoute(mainRoute, newPoints)
      updatePoint(id, { type })
      updateRoute(mainRoute.id, { segments: newSegments })
    } else {
      updatePoint(id, { type })
    }
  }

  const readPhotos = (files: FileList): Promise<string[]> =>
    Promise.all(Array.from(files).map(f => new Promise<string>(res => {
      const reader = new FileReader()
      reader.onload = e => res(e.target?.result as string)
      reader.readAsDataURL(f)
    })))

  const handleNewPointPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !newPoint) return
    const added = await readPhotos(e.target.files)
    setNewPoint({ ...newPoint, photos: [...newPoint.photos, ...added] })
    e.target.value = ''
  }

  const handleEditPointPhotos = async (e: React.ChangeEvent<HTMLInputElement>, ptId: string) => {
    if (!e.target.files) return
    const added = await readPhotos(e.target.files)
    const pt = points.find(p => p.id === ptId)
    if (!pt) return
    updatePoint(ptId, { photos: [...(pt.photos ?? []), ...added] })
    e.target.value = ''
  }

  const handleEscGpx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    const coords = parseGpx(text)
    const route: Route = {
      id: crypto.randomUUID(), name: f.name.replace(/\.gpx$/i, ''),
      type: 'escape', gpxFile: f.name, coords,
      difficulty: 'medium', transportSuitability: ['walk'],
      segments: [], junction: null,
    }
    addRoute(route)
    e.target.value = ''
  }

  const handleRoadGpx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    const coords = parseGpx(text)
    const route: Route = {
      id: crypto.randomUUID(), name: f.name.replace(/\.gpx$/i, ''),
      type: 'road_access', gpxFile: f.name, coords,
      difficulty: 'low', transportSuitability: ['walk'],
      segments: [], junction: null,
    }
    addRoute(route)
    e.target.value = ''
  }

  const editPt = editPointId ? points.find(p => p.id === editPointId) : null
  const mainRoute = routes.find(r => r.type === 'course')

  // フラグ別の区間計算（CP / Section 共通）
  function calcIntervals(flagPoints: { name: string; coordIdx: number }[]) {
    if (!mainRoute || mainRoute.coords.length < 2) return []
    const coords = mainRoute.coords
    const n = coords.length - 1
    const bounds = [
      { name: 'スタート', coordIdx: 0 },
      ...flagPoints,
      { name: 'フィニッシュ', coordIdx: n },
    ]
    return bounds.slice(0, -1).map((from, i) => {
      const to = bounds[i + 1]
      const slice = coords.slice(from.coordIdx, to.coordIdx + 1)
      let distM = 0
      for (let j = 1; j < slice.length; j++) distM += haversine(slice[j - 1], slice[j])
      const { descentM, ascentM } = elevationStats(slice)
      const totalMins = mainRoute.segments
        .filter(s => s.startIndex >= from.coordIdx && s.endIndex <= to.coordIdx)
        .reduce((sum, s) => sum + parseTime(s.courseTime), 0)
      return {
        fromName: from.name, toName: to.name,
        fromCoordIdx: from.coordIdx, toCoordIdx: to.coordIdx,
        distKm: distM / 1000, descentM, ascentM,
        courseTime: totalMins > 0 ? formatTime(totalMins) : '',
      }
    })
  }

  function snapLocationPoints(filter: (p: { cp: boolean; section: boolean }) => boolean) {
    if (!mainRoute || mainRoute.coords.length < 2) return []
    const coords = mainRoute.coords
    return points
      .filter(p => p.type === 'location' && filter(p))
      .map(p => {
        const snap = snapToRoute(p, coords, 100)
        if (!snap) return null
        const idx = snap.ratio >= 0.5
          ? Math.min(snap.segmentIndex + 1, coords.length - 1)
          : snap.segmentIndex
        return { name: p.name, coordIdx: idx }
      })
      .filter((x): x is { name: string; coordIdx: number } => x !== null)
      .sort((a, b) => a.coordIdx - b.coordIdx)
  }

  const cpSection = calcIntervals(snapLocationPoints(p => p.cp))
  const sectionIntervals = calcIntervals(snapLocationPoints(p => p.section))

  // hiddenSections が変わったら mapStore を更新
  useEffect(() => {
    if (!mainRoute || mainRoute.coords.length < 2) { setHiddenCourseRanges([]); return }
    const coords = mainRoute.coords
    const n = coords.length - 1
    const secPts = points
      .filter(p => p.type === 'location' && p.section)
      .map(p => {
        const snap = snapToRoute(p, coords, 100)
        if (!snap) return null
        const idx = snap.ratio >= 0.5 ? Math.min(snap.segmentIndex + 1, coords.length - 1) : snap.segmentIndex
        return { coordIdx: idx }
      })
      .filter((x): x is { coordIdx: number } => x !== null)
      .sort((a, b) => a.coordIdx - b.coordIdx)
    const bounds = [{ coordIdx: 0 }, ...secPts, { coordIdx: n }]
    const ranges = bounds.slice(0, -1)
      .map((from, i) => ({ startIndex: from.coordIdx, endIndex: bounds[i + 1].coordIdx, sectionIdx: i }))
      .filter(r => hiddenSections.has(r.sectionIdx))
      .map(r => ({ startIndex: r.startIndex, endIndex: r.endIndex }))
    setHiddenCourseRanges(ranges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenSections, points, routes])

  const toggleSection = (i: number) => setHiddenSections(prev => {
    const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next
  })

  // 区間・CP区間がhiddenSectionsの範囲内かチェック
  const isRangeHidden = (fromIdx: number, toIdx: number) => {
    if (hiddenSections.size === 0) return false
    const mid = (fromIdx + toIdx) / 2
    return sectionIntervals.some((si, i) => hiddenSections.has(i) && mid > si.fromCoordIdx && mid < si.toCoordIdx)
  }

  const openElevationChart = (label: string, fromIdx: number, toIdx: number) => {
    if (!mainRoute) return
    const coords = mainRoute.coords.slice(fromIdx, toIdx + 1)
    if (coords.length < 2) return
    const dists: number[] = [0]
    for (let i = 1; i < coords.length; i++) dists.push(dists[i - 1] + haversine(coords[i - 1], coords[i]))
    const totalDist = dists[dists.length - 1] || 1
    const eles = coords.map(c => c.ele)
    const minEle = Math.min(...eles), maxEle = Math.max(...eles)
    const eleRange = maxEle - minEle || 1
    const W = 620, H = 220
    const pl = 52, pr = 16, pt = 16, pb = 32
    const iW = W - pl - pr, iH = H - pt - pb
    const x = (i: number) => pl + (dists[i] / totalDist) * iW
    const y = (e: number) => pt + (1 - (e - minEle) / eleRange) * iH
    const linePts = coords.map((c, i) => `${x(i).toFixed(1)},${y(c.ele).toFixed(1)}`).join(' ')
    const fillD = `M${x(0).toFixed(1)},${(pt + iH).toFixed(1)} ` +
      coords.map((c, i) => `L${x(i).toFixed(1)},${y(c.ele).toFixed(1)}`).join(' ') +
      ` L${(pl + iW).toFixed(1)},${(pt + iH).toFixed(1)} Z`
    const totalKm = (totalDist / 1000).toFixed(2)
    const tickCount = 5
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const e = minEle + (eleRange * i) / tickCount
      return { e: Math.round(e), yv: y(e) }
    })
    const html = `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"><title>高低図 ${label}</title>
<style>body{margin:12px;font-family:sans-serif;font-size:12px;background:#fff}h3{margin:0 0 8px;font-size:14px}</style>
</head><body>
<h3>📈 高低図 ${label}</h3>
<svg width="${W}" height="${H}" style="display:block">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#f87171" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="#fecaca" stop-opacity="0.1"/>
  </linearGradient></defs>
  <path d="${fillD}" fill="url(#g)"/>
  <polyline points="${linePts}" fill="none" stroke="#dc2626" stroke-width="1.5"/>
  ${yTicks.map(t => `<line x1="${pl}" y1="${t.yv.toFixed(1)}" x2="${(pl + iW).toFixed(1)}" y2="${t.yv.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
  <text x="${(pl - 4).toFixed(1)}" y="${(t.yv + 4).toFixed(1)}" text-anchor="end" fill="#6b7280" font-size="10">${t.e}</text>`).join('')}
  <text x="${(pl + iW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="#6b7280" font-size="11">距離 ${totalKm} km</text>
  <text x="${pl}" y="${H - 4}" text-anchor="start" fill="#9ca3af" font-size="10">0</text>
  <text x="${(pl + iW).toFixed(1)}" y="${H - 4}" text-anchor="end" fill="#9ca3af" font-size="10">${totalKm} km</text>
</svg>
<p style="color:#6b7280;margin:4px 0 0;font-size:11px">最低 ${Math.round(minEle)} m　最高 ${Math.round(maxEle)} m　標高差 ${Math.round(eleRange)} m</p>
</body></html>`
    const w = window.open('', '_blank', `width=${W + 40},height=${H + 80}`)
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* ツールバー */}
      <div className="flex items-center gap-2">
        <button
          onClick={undo}
          disabled={history.length === 0}
          className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
          title={`元に戻す（${history.length} 件）`}
        >
          ↩ 元に戻す
        </button>
      </div>

      {/* 大会名・スタート時間 */}
      <div className="flex flex-col gap-2">
        <div>
          <label className="text-xs text-gray-500 font-semibold block mb-1">大会名</label>
          <input
            className="w-full text-sm border rounded px-2 py-1"
            value={race?.name ?? ''}
            onChange={e => race && setRace({ ...race, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-semibold block mb-1">スタート時刻 (yyyy/mm/dd hh:mm)</label>
          <input
            className="w-full text-sm border rounded px-2 py-1 font-mono"
            placeholder="2026/06/01 9:00"
            value={race?.startTime ?? ''}
            onChange={e => race && setRace({ ...race, startTime: e.target.value })}
          />
        </div>
      </div>

      {/* ルート */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ルート</div>
        {junctionRouteId && activeTool === 'set_junction' && (
          <p className="text-xs text-amber-600 font-semibold mb-1">
            🟡 メインコース上をクリックして分岐点を設定
            <button onClick={() => { setJunctionRouteId(null); setActiveTool('none') }}
              className="ml-2 text-gray-400 hover:text-gray-600 font-normal">キャンセル</button>
          </p>
        )}

        {routes.map(r => (
          <div key={r.id}>
            <div
              className="text-sm py-1 flex items-center gap-1 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
              onClick={() => r.coords.length >= 2 && fitBounds(r.coords)}
              onDoubleClick={() => { setEditRouteId(r.id); setEditRouteName(r.name) }}
              title="クリック：地図に表示　ダブルクリック：名前を変更"
            >
              <span className={r.type === 'course' ? 'text-green-600' : r.type === 'escape' ? 'text-blue-600' : 'text-gray-400'}>
                {r.type === 'course' ? '🟢' : r.type === 'escape' ? '🔵' : '⚫'}
              </span>
              <span className="flex-1 truncate">{r.name}</span>
              <span className="text-xs text-gray-400">
                {r.type === 'course' ? 'メイン' : r.type === 'escape' ? 'エスケープ' : '車道'}
              </span>
            </div>
            {r.type === 'escape' && (
              <div className="ml-5 mb-1 flex items-center gap-1 text-xs">
                <span className={r.junction ? 'text-amber-600' : 'text-gray-400'}>
                  {r.junction ? '🟡 分岐点設定済み' : '⚪ 分岐点未設定'}
                </span>
                <button
                  onClick={() => { setJunctionRouteId(r.id); setActiveTool('set_junction') }}
                  className="ml-auto text-blue-500 hover:text-blue-700"
                >{r.junction ? '変更' : '設定'}</button>
                {r.junction && (
                  <button onClick={() => updateRoute(r.id, { junction: null })}
                    className="text-gray-400 hover:text-red-500">🗑</button>
                )}
              </div>
            )}
          </div>
        ))}

        {drawingRouteType && (
          <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-2 flex flex-col gap-1.5">
            <div className="text-xs font-semibold text-blue-700">
              ✏️ {drawingRouteType === 'escape' ? 'エスケープ' : '車道'}を手描き中
            </div>
            <input
              className="border rounded px-2 py-1 text-xs"
              placeholder="ルート名"
              value={drawingName}
              onChange={e => setDrawingName(e.target.value)}
            />
            <div className="text-xs text-gray-500">
              {drawingPoints.length} ポイント — 地図をタップして追加
            </div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={removeLastPoint} disabled={drawingPoints.length === 0}
                className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40">↩ 1点戻す</button>
              <button onClick={finishDrawing} disabled={drawingPoints.length < 2 || fetchingEle}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">
                {fetchingEle ? '高度取得中…' : '✅ 完了'}</button>
              <button onClick={cancelDrawing}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">✖ キャンセル</button>
            </div>
          </div>
        )}

        {!drawingRouteType && (
          <div className="mt-1 flex flex-col gap-1">
            <div className="flex gap-1">
              <button onClick={() => escGpxRef.current?.click()}
                className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded transition flex-1">
                📂 エスケープ(GPX)
              </button>
              <button onClick={() => startDrawingRoute('escape')}
                className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded transition flex-1">
                ✏️ エスケープ(手描き)
              </button>
            </div>
            <div className="flex gap-1">
              <button onClick={() => roadGpxRef.current?.click()}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition flex-1">
                📂 車道(GPX)
              </button>
              <button onClick={() => startDrawingRoute('road_access')}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition flex-1">
                ✏️ 車道(手描き)
              </button>
            </div>
          </div>
        )}
        <input ref={escGpxRef} type="file" accept=".gpx,application/octet-stream,application/xml" className="hidden" onChange={handleEscGpx} />
        <input ref={roadGpxRef} type="file" accept=".gpx,application/octet-stream,application/xml" className="hidden" onChange={handleRoadGpx} />
      </section>

      <hr className="border-gray-200" />

      {/* Section */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ Section</div>
          {sectionIntervals.length === 0
            ? <p className="text-xs text-gray-400">Sectionポイント属性のある「地点」がありません</p>
            : sectionIntervals.map((ci, i) => {
              const hidden = hiddenSections.has(i)
              return (
                <div key={i} className={`py-1 border-b last:border-0 border-gray-100 ${hidden ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-xs font-semibold text-gray-700 flex-1 cursor-pointer hover:text-blue-600 select-none"
                      onClick={() => { if (!hidden && mainRoute) fitBounds(mainRoute.coords.slice(ci.fromCoordIdx, ci.toCoordIdx + 1)) }}
                      title="クリックで地図に表示"
                    >{ci.fromName} → {ci.toName}</span>
                    <button
                      onClick={() => openElevationChart(`${ci.fromName}→${ci.toName}`, ci.fromCoordIdx, ci.toCoordIdx)}
                      className="text-xs text-gray-400 hover:text-green-600"
                      title="高低図を表示"
                    >📈</button>
                    <button
                      onClick={() => { setEditSectionForCP({ fromCoordIdx: ci.fromCoordIdx, toCoordIdx: ci.toCoordIdx, fromName: ci.fromName, toName: ci.toName }); setEditSectionMultiplier('1.0') }}
                      className="text-xs text-gray-400 hover:text-blue-500"
                    >編集</button>
                    <button
                      onClick={() => toggleSection(i)}
                      className={`text-xs px-1.5 py-0.5 rounded border transition ${hidden ? 'border-gray-300 text-gray-400 bg-gray-100' : 'border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100'}`}
                    >{hidden ? '非表示' : '表示'}</button>
                  </div>
                  {!hidden && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5">
                      <span className="text-gray-600">📏 {ci.distKm.toFixed(2)} km</span>
                      {ci.descentM > 0 && <span className="text-blue-600">↓ {Math.round(ci.descentM)} m</span>}
                      {ci.ascentM > 0 && <span className="text-red-500">↑ {Math.round(ci.ascentM)} m</span>}
                      {ci.courseTime && <span className="text-purple-600">⏱ {ci.courseTime}</span>}
                    </div>
                  )}
                </div>
              )
            })
          }
        </section>
      )}

      {/* CP区間 — hiddenSectionsに含まれる範囲は非表示 */}
      {mainRoute && cpSection.some(ci => !isRangeHidden(ci.fromCoordIdx, ci.toCoordIdx)) && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ CP区間</div>
          {cpSection.filter(ci => !isRangeHidden(ci.fromCoordIdx, ci.toCoordIdx)).length === 0
            ? <p className="text-xs text-gray-400">CP属性のある「地点」がありません</p>
            : cpSection.filter(ci => !isRangeHidden(ci.fromCoordIdx, ci.toCoordIdx)).map((ci, i) => {
              const key = `${ci.fromCoordIdx}-${ci.toCoordIdx}`
              const mult = race?.cpMultipliers?.[key] ?? 1.0
              return (
                <div key={i} className="py-1 border-b last:border-0 border-gray-100 -mx-1 px-1">
                  <div className="flex items-center gap-1">
                    <span
                      className="text-xs font-semibold text-gray-700 flex-1 cursor-pointer hover:text-blue-600 select-none"
                      onClick={() => mainRoute && fitBounds(mainRoute.coords.slice(ci.fromCoordIdx, ci.toCoordIdx + 1))}
                      title="クリックで地図に表示"
                    >{ci.fromName} → {ci.toName}</span>
                    {mult !== 1.0 && <span className="text-xs font-mono text-amber-600">×{mult}</span>}
                    <button
                      onClick={() => { setEditCPInterval({ fromCoordIdx: ci.fromCoordIdx, toCoordIdx: ci.toCoordIdx, fromName: ci.fromName, toName: ci.toName }); setEditCPMultiplier(String(mult)) }}
                      className="text-xs text-gray-400 hover:text-blue-500"
                    >編集</button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5">
                    <span className="text-gray-600">📏 {ci.distKm.toFixed(2)} km</span>
                    {ci.descentM > 0 && <span className="text-blue-600">↓ {Math.round(ci.descentM)} m</span>}
                    {ci.ascentM > 0 && <span className="text-red-500">↑ {Math.round(ci.ascentM)} m</span>}
                    {ci.courseTime && <span className="text-purple-600">⏱ {ci.courseTime}</span>}
                  </div>
                </div>
              )
            })
          }
        </section>
      )}

      {/* 区間 — hiddenSectionsに含まれる範囲は非表示 */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 区間</div>
          <p className="text-xs text-gray-400 mb-1">「地点」ポイントをルート上に追加すると区間が分割されます</p>
          {(mainRoute.segments.length > 0 ? mainRoute.segments : [{ startIndex: 0, endIndex: mainRoute.coords.length - 1, name: '', courseTime: '', breakTime: '' }])
            .filter(seg => !isRangeHidden(seg.startIndex, seg.endIndex))
            .map((seg, i) => {
            const slice = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
            let distM = 0
            for (let j = 1; j < slice.length; j++) distM += haversine(slice[j - 1], slice[j])
            const { descentM, ascentM } = elevationStats(slice)
            return (
              <div key={i}
                className="py-1 border-b last:border-0 border-gray-100 text-xs cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
                onClick={() => { if (slice.length >= 2) fitBounds(slice) }}
                title="クリック：地図に表示"
              >
                <div className="flex items-center gap-1">
                  <span className="flex-1 font-semibold text-gray-700">{seg.name || `区間 ${i + 1}`}</span>
                  {i < mainRoute.segments.length && (
                    <button onClick={e => {
                      e.stopPropagation()
                      const idx = mainRoute.segments.indexOf(seg)
                      setEditSegmentIdx(idx >= 0 ? idx : 0)
                      setEditSegmentName(seg.name)
                      setEditCourseTime(seg.courseTime)
                      setEditBreakTime(seg.breakTime ?? '')
                    }} className="text-gray-400 hover:text-blue-500">編集</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono mt-0.5">
                  <span className="text-gray-600">📏 {(distM / 1000).toFixed(2)} km</span>
                  {descentM > 0 && <span className="text-blue-600">↓ {Math.round(descentM)} m</span>}
                  {ascentM > 0 && <span className="text-red-500">↑ {Math.round(ascentM)} m</span>}
                  {seg.courseTime && <span className="text-purple-600">⏱ {seg.courseTime}</span>}
                  {seg.breakTime && <span className="text-orange-500">☕ {seg.breakTime}</span>}
                </div>
              </div>
            )
          })}
        </section>
      )}

      <hr className="border-gray-200" />

      {/* ポイント追加 */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ポイント</div>
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setActiveTool(activeTool === 'add_point' ? 'none' : 'add_point')}
            className={`text-xs px-2 py-1.5 rounded font-semibold transition flex-1 ${activeTool === 'add_point' ? 'bg-green-600 text-white' : 'bg-green-100 hover:bg-green-200 text-green-700'}`}
          >
            {activeTool === 'add_point' ? '📍 追加中…' : '＋ ポイント追加（地図上）'}
          </button>
          <button
            onClick={() => { setShowGeoDialog(true); setGeoText('') }}
            className="text-xs px-2 py-1.5 rounded font-semibold transition bg-teal-100 hover:bg-teal-200 text-teal-700 whitespace-nowrap"
          >＋ ポイント追加（ジオグラフィカ）</button>
        </div>

        {points.map(pt => (
          <div key={pt.id}
            className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
            onClick={() => panTo({ lat: pt.lat, lng: pt.lng })}
            onDoubleClick={() => setEditPointId(pt.id)}
            title="クリック：地図に表示　ダブルクリック：編集"
          >
            {pt.type === 'location'
              ? <span className="text-base text-red-600">●</span>
              : <span className="text-base">{POINT_ICONS[pt.type]}</span>
            }
            <span className={`flex-1 text-sm truncate ${!pt.enabled ? 'opacity-40 line-through' : ''}`}>{pt.name}</span>
            {pt.type === 'location' && pt.cp && <span className="text-xs text-red-600 font-bold">CP</span>}
            {pt.type === 'location' && pt.section && <span className="text-xs text-orange-600 font-bold">S</span>}
            <button onClick={e => { e.stopPropagation(); setEditPointId(pt.id) }} className="text-xs text-gray-400 hover:text-blue-500">編集</button>
            <button onClick={e => { e.stopPropagation(); handleDeletePoint(pt.id) }} className="text-xs text-gray-400 hover:text-red-500">🗑</button>
          </div>
        ))}
      </section>

      <hr className="border-gray-200" />

      {/* ルート名編集ダイアログ */}
      {editRouteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-3">
            <div className="font-bold text-gray-800">ルート名を変更</div>
            <input className="border rounded px-2 py-1 text-sm" placeholder="ルート名" value={editRouteName}
              onChange={e => setEditRouteName(e.target.value)} autoFocus />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditRouteId(null)} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
              <button
                onClick={() => { updateRoute(editRouteId, { name: editRouteName }); setEditRouteId(null) }}
                disabled={!editRouteName.trim()}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 区間名・コースタイム編集ダイアログ */}
      {editSegmentIdx !== null && (() => {
        const segs = mainRoute?.segments
        if (!segs || !mainRoute) return null
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-3">
              <div className="font-bold text-gray-800">区間を編集</div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">区間名</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="区間名" value={editSegmentName}
                  onChange={e => setEditSegmentName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">コースタイム (hh:mm)</label>
                <input className="border rounded px-2 py-1 text-sm w-full font-mono" placeholder="0:00"
                  value={editCourseTime}
                  onChange={e => setEditCourseTime(e.target.value)}
                  pattern="[0-9]+:[0-5][0-9]" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">休憩 (hh:mm)</label>
                <input className="border rounded px-2 py-1 text-sm w-full font-mono" placeholder="0:00"
                  value={editBreakTime}
                  onChange={e => setEditBreakTime(e.target.value)}
                  pattern="[0-9]+:[0-5][0-9]" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditSegmentIdx(null)} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
                <button
                  onClick={() => {
                    const normalized = normalizeCourseTime(editCourseTime)
                    const normalizedBreak = normalizeCourseTime(editBreakTime)
                    const newSegs = segs.map((s, i) =>
                      i === editSegmentIdx ? { ...s, name: editSegmentName, courseTime: normalized, breakTime: normalizedBreak } : s
                    )
                    updateRoute(mainRoute.id, { segments: newSegs })
                    setEditSegmentIdx(null)
                  }}
                  className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-500">保存</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 保存 */}
      <div className="mt-auto flex flex-col gap-1.5">
        {cloudSaveMsg && <p className="text-xs text-center text-green-600">{cloudSaveMsg}</p>}
        <button
          onClick={async () => {
            const err = await saveProject(race?.name || '無題', { race, routes, points })
            setCloudSaveMsg(err ? `エラー: ${err}` : '☁️ 保存しました')
            setTimeout(() => setCloudSaveMsg(null), 3000)
          }}
          disabled={saving}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition"
        >
          {saving ? '保存中…' : '☁️ クラウドに保存'}
        </button>
        <button onClick={exportToZip}
          className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-semibold text-xs transition">
          💾 ZIPで保存
        </button>
      </div>

      {/* CP区間 倍率編集ダイアログ */}
      {editCPInterval && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-3">
            <div className="font-bold text-gray-800">CT区間を編集</div>
            <div className="text-xs text-gray-500">{editCPInterval.fromName} → {editCPInterval.toName}</div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">CTの何倍で進む計画か（例: 0.8 / 1.0 / 1.2）</label>
              <input
                className="border rounded px-2 py-1 text-sm w-full font-mono"
                placeholder="1.0"
                value={editCPMultiplier}
                onChange={e => setEditCPMultiplier(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditCPInterval(null)} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
              <button
                onClick={() => {
                  if (!race) return
                  const mult = parseFloat(editCPMultiplier)
                  if (isNaN(mult) || mult <= 0) return
                  const key = `${editCPInterval.fromCoordIdx}-${editCPInterval.toCoordIdx}`
                  setRace({ ...race, cpMultipliers: { ...race.cpMultipliers, [key]: mult } })
                  setEditCPInterval(null)
                }}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-500">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Section 倍率一括編集ダイアログ */}
      {editSectionForCP && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-3">
            <div className="font-bold text-gray-800">Sectionを編集</div>
            <div className="text-xs text-gray-500">{editSectionForCP.fromName} → {editSectionForCP.toName}</div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">CTの何倍で進む計画か（このSectionのすべてのCP区間に適用）</label>
              <input
                className="border rounded px-2 py-1 text-sm w-full font-mono"
                placeholder="1.0"
                value={editSectionMultiplier}
                onChange={e => setEditSectionMultiplier(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditSectionForCP(null)} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
              <button
                onClick={() => {
                  if (!race) return
                  const mult = parseFloat(editSectionMultiplier)
                  if (isNaN(mult) || mult <= 0) return
                  const { fromCoordIdx, toCoordIdx } = editSectionForCP
                  const newMults = { ...race.cpMultipliers }
                  for (const ci of cpSection) {
                    if (ci.fromCoordIdx >= fromCoordIdx && ci.toCoordIdx <= toCoordIdx) {
                      newMults[`${ci.fromCoordIdx}-${ci.toCoordIdx}`] = mult
                    }
                  }
                  setRace({ ...race, cpMultipliers: newMults })
                  setEditSectionForCP(null)
                }}
                className="text-sm px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-500">適用</button>
            </div>
          </div>
        </div>
      )}

      {/* ルートスナップ確認ダイアログ */}
      {snapConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-4">
            <div className="font-bold text-gray-800">ルート上にポイントを追加しますか？</div>
            <div className="text-xs text-gray-500">
              近くに「{snapConfirm.routeName}」があります。ルート上の最近傍位置に追加しますか？
            </div>
            <div className="flex gap-2">
              <button onClick={handleSnapYes} disabled={insertingCoord}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition">
                {insertingCoord ? '処理中…' : 'ルート上に追加'}
              </button>
              <button onClick={handleSnapNo} disabled={insertingCoord}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition">
                そのまま追加
              </button>
            </div>
            <button onClick={() => { setSnapConfirm(null); clearPending() }}
              className="text-xs text-gray-400 hover:text-gray-600 text-center">キャンセル</button>
          </div>
        </div>
      )}

      {/* ジオグラフィカ ポイント追加ダイアログ */}
      {showGeoDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-5 w-96 flex flex-col gap-3">
            <div className="font-bold text-gray-800 text-sm">＋ ポイント追加（ジオグラフィカ）</div>
            <p className="text-xs text-gray-500">ジオグラフィカのマーカー情報をペーストしてください。</p>
            <textarea
              className="border rounded px-2 py-1.5 text-xs font-mono h-36 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400"
              placeholder={"マーカー:水場\n高度1,777m\nメモ:沢水\n37.763870 140.194537"}
              value={geoText}
              onChange={e => setGeoText(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowGeoDialog(false)} className="text-sm px-4 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
              <button
                onClick={saveGeoPoint}
                disabled={!geoText.trim()}
                className="text-sm px-4 py-1.5 bg-teal-600 text-white rounded hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >OK</button>
            </div>
          </div>
        </div>
      )}

      {/* ポイント追加ダイアログ */}
      {newPoint && pointPos && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
            <div className="font-bold text-gray-800">ポイントを追加</div>
            <div className="text-xs text-gray-500">位置: {pointPos.lat.toFixed(5)}, {pointPos.lng.toFixed(5)}</div>
            <select className="border rounded px-2 py-1 text-sm"
              value={newPoint.type} onChange={e => setNewPoint({ ...newPoint, type: e.target.value as PointType })}>
              {(Object.keys(POINT_LABELS) as PointType[]).map(t => (
                <option key={t} value={t}>{t === 'location' ? '●' : POINT_ICONS[t]} {POINT_LABELS[t]}</option>
              ))}
            </select>
            <input className="border rounded px-2 py-1 text-sm" placeholder="名前（必須）"
              value={newPoint.name} onChange={e => setNewPoint({ ...newPoint, name: e.target.value })} />
            <input className="border rounded px-2 py-1 text-sm" placeholder="備考（任意）"
              value={newPoint.note} onChange={e => setNewPoint({ ...newPoint, note: e.target.value })} />
            {newPoint.type === 'location' && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={newPoint.cp} onChange={e => setNewPoint({ ...newPoint, cp: e.target.checked })} className="rounded" />
                  <span className="text-red-600 font-semibold">CP（チェックポイント）</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={newPoint.section} onChange={e => setNewPoint({ ...newPoint, section: e.target.checked })} className="rounded" />
                  <span className="text-orange-600 font-semibold">Sectionポイント</span>
                </label>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">写真</label>
              <input ref={newPointPhotoRef} type="file" accept="image/*" multiple className="hidden" onChange={handleNewPointPhotos} />
              <button onClick={() => newPointPhotoRef.current?.click()}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">📷 写真を追加</button>
              {newPoint.photos.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {newPoint.photos.map((ph, i) => (
                    <div key={i} className="relative">
                      <img src={ph} className="w-14 h-14 object-cover rounded" />
                      <button onClick={() => setNewPoint({ ...newPoint, photos: newPoint.photos.filter((_, j) => j !== i) })}
                        className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setNewPoint(null); setPointPos(null); clearPending() }} className="text-sm px-4 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
              <button onClick={saveNewPoint} disabled={!newPoint.name.trim()}
                className="text-sm px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-40">追加</button>
            </div>
          </div>
        </div>
      )}

      {/* ポイント編集ダイアログ */}
      {editPt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
            <div className="font-bold text-gray-800">ポイントを編集</div>
            <select className="border rounded px-2 py-1 text-sm"
              value={editPt.type} onChange={e => handleUpdatePointType(editPt.id, e.target.value as PointType)}>
              {(Object.keys(POINT_LABELS) as PointType[]).map(t => (
                <option key={t} value={t}>{t === 'location' ? '●' : POINT_ICONS[t]} {POINT_LABELS[t]}</option>
              ))}
            </select>
            <input className="border rounded px-2 py-1 text-sm" placeholder="名前"
              value={editPt.name} onChange={e => updatePoint(editPt.id, { name: e.target.value })} />
            <input className="border rounded px-2 py-1 text-sm" placeholder="備考"
              value={editPt.note} onChange={e => updatePoint(editPt.id, { note: e.target.value })} />
            {editPt.type === 'location' && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={editPt.cp ?? false} onChange={e => updatePoint(editPt.id, { cp: e.target.checked })} className="rounded" />
                  <span className="text-red-600 font-semibold">CP（チェックポイント）</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={editPt.section ?? false} onChange={e => updatePoint(editPt.id, { section: e.target.checked })} className="rounded" />
                  <span className="text-orange-600 font-semibold">Sectionポイント</span>
                </label>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">写真</label>
              <input ref={editPointPhotoRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => handleEditPointPhotos(e, editPt.id)} />
              <button onClick={() => editPointPhotoRef.current?.click()}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">📷 写真を追加</button>
              {(editPt.photos ?? []).length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {(editPt.photos ?? []).map((ph, i) => (
                    <div key={i} className="relative">
                      <img src={ph} className="w-14 h-14 object-cover rounded" />
                      <button
                        onClick={() => updatePoint(editPt.id, { photos: (editPt.photos ?? []).filter((_, j) => j !== i) })}
                        className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditPointId(null)} className="text-sm px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-500">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
