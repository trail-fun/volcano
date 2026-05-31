import { useRef, useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useModeStore } from '../../store/modeStore'
import { useDrawingStore } from '../../store/drawingStore'
import { useMapStore } from '../../store/mapStore'
import { parseGpx } from '../../utils/gpxParser'
import { snapToRoute, fetchElevation, haversine, elevationStats } from '../../utils/geo'
import type { PointType, Route, Segment, LatLngEle, Point } from '../../types/race'
import { POINT_ICONS } from '../map/mapStyles'

const POINT_LABELS: Record<PointType, string> = {
  exit: '下山口', helipad: 'ヘリポート', aid: 'エイド', parking: '駐車場', danger: '危険箇所',
  closure: '通行止め', gate: '鍵', water: '水場', vending: '自販機', food: '食事', hut: '小屋', toilet: 'トイレ',
  location: '地点', custom: 'カスタム',
}

// Auto-compute segments from 'location' type points snapped to the route
function recomputeSegmentsForRoute(route: Route, allPoints: Point[]): Segment[] {
  const coords = route.coords
  if (coords.length < 2) return []
  const n = coords.length - 1

  const locationIdxs = allPoints
    .filter(p => p.type === 'location')
    .flatMap(p => {
      const snap = snapToRoute(p, coords, 100)
      if (!snap) return []
      const idx = snap.ratio >= 0.5
        ? Math.min(snap.segmentIndex + 1, coords.length - 1)
        : snap.segmentIndex
      return idx > 0 && idx < coords.length - 1 ? [idx] : []
    })
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b)

  const boundaries = [0, ...locationIdxs, n]

  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1]
    const existing = route.segments.find(s => s.startIndex === start && s.endIndex === end)
    return {
      startIndex: start,
      endIndex: end,
      name: existing?.name ?? '',
      courseTime: existing?.courseTime ?? '',
    }
  })
}

function parseTime(t: string): number {
  if (!t) return 0
  const parts = t.split(':').map(Number)
  return (parts[0] || 0) * 60 + (parts[1] || 0)
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

type Props = { pendingLatLng: { lat: number; lng: number } | null; clearPending: () => void }

export default function EditPanel({ pendingLatLng, clearPending }: Props) {
  const { race, routes, points, history, setRace, exportToZip, addPoint, updatePoint, deletePoint, addRoute, updateRoute, setJunction, undo } = useRaceStore()
  const { activeTool, setActiveTool } = useModeStore()
  const { routeType: drawingRouteType, points: drawingPoints, startDrawing, removeLastPoint, clearDrawing } = useDrawingStore()
  const { fitBounds, panTo } = useMapStore()
  const escGpxRef = useRef<HTMLInputElement>(null)
  const roadGpxRef = useRef<HTMLInputElement>(null)
  const newPointPhotoRef = useRef<HTMLInputElement>(null)
  const editPointPhotoRef = useRef<HTMLInputElement>(null)

  const [newPoint, setNewPoint] = useState<{ type: PointType; name: string; note: string; cp: boolean; photos: string[] } | null>(null)
  const [editPointId, setEditPointId] = useState<string | null>(null)
  const [editRouteId, setEditRouteId] = useState<string | null>(null)
  const [editRouteName, setEditRouteName] = useState('')
  const [editSegmentIdx, setEditSegmentIdx] = useState<number | null>(null)
  const [editSegmentName, setEditSegmentName] = useState('')
  const [editCourseTime, setEditCourseTime] = useState('')

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
      setNewPoint({ type: 'exit', name: '', note: '', cp: false, photos: [] })
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
    setNewPoint({ type: 'exit', name: '', note: '', cp: false, photos: [] })
  }

  const handleSnapNo = () => {
    if (!snapConfirm) return
    setPointPos(snapConfirm.original)
    setSnapConfirm(null)
    setNewPoint({ type: 'exit', name: '', note: '', cp: false, photos: [] })
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

  // CP区間計算
  const cpSection = (() => {
    if (!mainRoute || mainRoute.coords.length < 2) return null
    const coords = mainRoute.coords
    const n = coords.length - 1

    const cpPoints = points
      .filter(p => p.type === 'location' && p.cp)
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

    const cpBounds = [
      { name: 'スタート', coordIdx: 0 },
      ...cpPoints,
      { name: 'フィニッシュ', coordIdx: n },
    ]

    return cpBounds.slice(0, -1).map((from, i) => {
      const to = cpBounds[i + 1]
      const slice = coords.slice(from.coordIdx, to.coordIdx + 1)
      let distM = 0
      for (let j = 1; j < slice.length; j++) distM += haversine(slice[j - 1], slice[j])
      const { descentM, ascentM } = elevationStats(slice)
      const segsInInterval = mainRoute.segments.filter(
        s => s.startIndex >= from.coordIdx && s.endIndex <= to.coordIdx
      )
      const totalMins = segsInInterval.reduce((sum, s) => sum + parseTime(s.courseTime), 0)
      return {
        fromName: from.name, toName: to.name,
        distKm: distM / 1000, descentM, ascentM,
        courseTime: totalMins > 0 ? formatTime(totalMins) : '',
      }
    })
  })()

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

      {/* 大会名 */}
      <div>
        <label className="text-xs text-gray-500 font-semibold block mb-1">大会名</label>
        <input
          className="w-full text-sm border rounded px-2 py-1"
          value={race?.name ?? ''}
          onChange={e => race && setRace({ ...race, name: e.target.value })}
        />
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

      {/* 区間 */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 区間</div>
          <p className="text-xs text-gray-400 mb-1">「地点」ポイントをルート上に追加すると区間が分割されます</p>
          {(mainRoute.segments.length > 0 ? mainRoute.segments : [{ startIndex: 0, endIndex: mainRoute.coords.length - 1, name: '', courseTime: '' }]).map((seg, i) => (
            <div key={i}
              className="flex items-center gap-1 py-0.5 text-xs cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
              onClick={() => {
                const sliced = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
                if (sliced.length >= 2) fitBounds(sliced)
              }}
              title="クリック：地図に表示"
            >
              <span className="text-gray-500">—</span>
              <span className="flex-1 text-gray-700">{seg.name || `区間 ${i + 1}`}</span>
              {seg.courseTime && <span className="text-purple-600 font-mono">⏱ {seg.courseTime}</span>}
              {i < mainRoute.segments.length && (
                <button onClick={e => {
                  e.stopPropagation()
                  const idx = mainRoute.segments.indexOf(seg)
                  if (idx >= 0) {
                    setEditSegmentIdx(idx)
                    setEditSegmentName(seg.name)
                    setEditCourseTime(seg.courseTime)
                  } else {
                    // implicit segment (no location points): treat as index 0 in the stored array
                    setEditSegmentIdx(0)
                    setEditSegmentName(seg.name)
                    setEditCourseTime(seg.courseTime)
                  }
                }} className="text-xs text-gray-400 hover:text-blue-500">編集</button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* CP区間 */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ CP区間</div>
          {(!cpSection || cpSection.length === 0) && (
            <p className="text-xs text-gray-400">CP属性のある「地点」がありません</p>
          )}
          {cpSection && cpSection.length > 0 && cpSection.map((ci, i) => (
            <div key={i} className="py-1 border-b last:border-0 border-gray-100">
              <div className="text-xs font-semibold text-gray-700">{ci.fromName} → {ci.toName}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5">
                <span className="text-gray-600">📏 {ci.distKm.toFixed(2)} km</span>
                {ci.descentM > 0 && <span className="text-blue-600">↓ {Math.round(ci.descentM)} m</span>}
                {ci.ascentM > 0 && <span className="text-red-500">↑ {Math.round(ci.ascentM)} m</span>}
                {ci.courseTime && <span className="text-purple-600">⏱ {ci.courseTime}</span>}
              </div>
            </div>
          ))}
        </section>
      )}

      <hr className="border-gray-200" />

      {/* ポイント追加 */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ポイント</div>
        <button
          onClick={() => setActiveTool(activeTool === 'add_point' ? 'none' : 'add_point')}
          className={`text-xs px-3 py-1.5 rounded font-semibold transition w-full mb-2 ${activeTool === 'add_point' ? 'bg-green-600 text-white' : 'bg-green-100 hover:bg-green-200 text-green-700'}`}
        >
          {activeTool === 'add_point' ? '📍 地図をクリックして追加中…' : '＋ ポイントを追加'}
        </button>

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
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditSegmentIdx(null)} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
                <button
                  onClick={() => {
                    const newSegs = segs.map((s, i) =>
                      i === editSegmentIdx ? { ...s, name: editSegmentName, courseTime: editCourseTime } : s
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
      <button onClick={exportToZip}
        className="mt-auto w-full py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg font-semibold text-sm transition">
        💾 ZIPで保存
      </button>

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
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={newPoint.cp} onChange={e => setNewPoint({ ...newPoint, cp: e.target.checked })} className="rounded" />
                <span className="text-red-600 font-semibold">CP（チェックポイント）</span>
              </label>
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
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={editPt.cp ?? false} onChange={e => updatePoint(editPt.id, { cp: e.target.checked })} className="rounded" />
                <span className="text-red-600 font-semibold">CP（チェックポイント）</span>
              </label>
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
