import { useRef, useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useModeStore } from '../../store/modeStore'
import { useDrawingStore } from '../../store/drawingStore'
import { useMapStore } from '../../store/mapStore'
import { parseGpx } from '../../utils/gpxParser'
import { snapToRoute, fetchElevation, haversine } from '../../utils/geo'
import type { PointType, Route, Terrain, Segment, LatLngEle } from '../../types/race'
import { POINT_ICONS } from '../map/mapStyles'

const POINT_LABELS: Record<PointType, string> = {
  exit: '下山口', helipad: 'ヘリポート', aid: 'エイド', parking: '駐車場', danger: '危険箇所', closure: '通行止め', gate: '鍵', custom: 'カスタム',
}

type EffectiveSeg = { startIndex: number; endIndex: number; terrain: Terrain; name: string; storedIndex: number | null }

function computeEffectiveSegments(segments: Segment[], coordCount: number): EffectiveSeg[] {
  if (coordCount < 2) return []
  const n = coordCount - 1  // number of edges; coord range is [0, n]
  if (segments.length === 0) return [{ startIndex: 0, endIndex: n, terrain: 'trail', name: 'トレイル', storedIndex: null }]
  const sorted = segments
    .map((s, i) => ({ ...s, storedIndex: i }))
    .sort((a, b) => a.startIndex - b.startIndex)
  const result: EffectiveSeg[] = []
  let cur = 0
  for (const seg of sorted) {
    if (seg.startIndex > cur) result.push({ startIndex: cur, endIndex: seg.startIndex, terrain: 'trail', name: 'トレイル', storedIndex: null })
    result.push({ startIndex: seg.startIndex, endIndex: seg.endIndex, terrain: seg.terrain, name: seg.name, storedIndex: seg.storedIndex })
    cur = seg.endIndex
  }
  if (cur < n) result.push({ startIndex: cur, endIndex: n, terrain: 'trail', name: 'トレイル', storedIndex: null })
  return result
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

  const [newPoint, setNewPoint] = useState<{ type: PointType; name: string; note: string; photos: string[] } | null>(null)
  const [editPointId, setEditPointId] = useState<string | null>(null)
  // ルート・区間の名前編集ダイアログ
  const [editRouteId, setEditRouteId] = useState<string | null>(null)
  const [editRouteName, setEditRouteName] = useState('')
  const [editSegmentIdx, setEditSegmentIdx] = useState<number | null>(null)
  const [editSegmentName, setEditSegmentName] = useState('')
  const [editImplicitSeg, setEditImplicitSeg] = useState<{ startIndex: number; endIndex: number } | null>(null)
  // ルートスナップ確認ダイアログ
  const [snapConfirm, setSnapConfirm] = useState<{
    original: { lat: number; lng: number }
    snapped: { lat: number; lng: number }
    routeName: string; routeId: string; segmentIndex: number; ratio: number
  } | null>(null)
  const [pointPos, setPointPos] = useState<{ lat: number; lng: number } | null>(null)
  const [insertingCoord, setInsertingCoord] = useState(false)

  // 区間設定ツール
  const [terrainStep, setTerrainStep] = useState<'start' | 'end' | null>(null)
  const terrainStartIdxRef = useRef<number | null>(null)
  const [terrainDialogIndices, setTerrainDialogIndices] = useState<{ si: number; ei: number } | null>(null)

  // 分岐点設定ツール
  const [junctionRouteId, setJunctionRouteId] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingLatLng || activeTool !== 'set_junction' || !junctionRouteId) return
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute) { clearPending(); return }
    // 分岐点設定はズームに依らず確実にスナップできるよう閾値を広げる
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

  // 手描きツール
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

  // ポイント追加：地図クリック後にスナップチェック
  useEffect(() => {
    if (!pendingLatLng || activeTool !== 'add_point' || newPoint !== null || snapConfirm !== null) return
    // 全ルートの中で最も近いスナップを探す（100m 以内）
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
      setNewPoint({ type: 'exit', name: '', note: '', photos: [] })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLatLng])

  const handleSnapYes = async () => {
    if (!snapConfirm) return
    const { snapped, routeId, segmentIndex, ratio } = snapConfirm
    setPointPos(snapped)
    // 足点が既存頂点から離れている場合（ratio が端でない）は GPX に新頂点を挿入
    if (ratio > 0.05 && ratio < 0.95) {
      setInsertingCoord(true)
      const route = routes.find(r => r.id === routeId)
      if (route) {
        const ele = await fetchElevation(snapped.lat, snapped.lng)
        const insertAt = segmentIndex + 1
        const newCoord: LatLngEle = { lat: snapped.lat, lng: snapped.lng, ele }
        const newCoords = [...route.coords.slice(0, insertAt), newCoord, ...route.coords.slice(insertAt)]
        // terrain 区間・junction の座標インデックスをずらす
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
    setNewPoint({ type: 'exit', name: '', note: '', photos: [] })
  }

  const handleSnapNo = () => {
    if (!snapConfirm) return
    setPointPos(snapConfirm.original)
    setSnapConfirm(null)
    setNewPoint({ type: 'exit', name: '', note: '', photos: [] })
  }

  // 区間設定（地図クリック後）
  useEffect(() => {
    if (!pendingLatLng || activeTool !== 'set_segment') return
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute) { clearPending(); return }
    const snap = snapToRoute(pendingLatLng, mainRoute.coords)
    if (!snap) { clearPending(); return }
    // ratio >= 0.5 なら辺の終端座標、それ以外は始端座標に丸める
    const idx = snap.ratio >= 0.5
      ? Math.min(snap.segmentIndex + 1, mainRoute.coords.length - 1)
      : snap.segmentIndex
    if (terrainStep === 'start') {
      terrainStartIdxRef.current = idx
      setTerrainStep('end')
      clearPending()
    } else if (terrainStep === 'end') {
      const si = Math.min(terrainStartIdxRef.current!, idx)
      const ei = Math.max(terrainStartIdxRef.current!, idx)
      setTerrainDialogIndices({ si, ei })
      setTerrainStep(null)
      terrainStartIdxRef.current = null
      clearPending()
      setActiveTool('none')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLatLng])

  const saveTerrainSegment = (terrain: Terrain) => {
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute || !terrainDialogIndices) return
    const { si, ei } = terrainDialogIndices
    const newSeg: Segment = { startIndex: si, endIndex: ei, terrain, name: terrain === 'trail' ? 'トレイル' : 'ロード' }
    const filtered = mainRoute.segments.filter(s => s.endIndex < si || s.startIndex > ei)
    const allSegs = [...filtered, newSeg]
    updateRoute(mainRoute.id, { segments: allSegs })

    // トレイル/ロード境界に自動で下山口ポイントを作成
    // segMap[i] = terrain of edge coords[i]→coords[i+1]; boundary point is coords[i] when segMap[i] != segMap[i-1]
    const coords = mainRoute.coords
    const n = coords.length - 1
    const segMap: Terrain[] = new Array(n).fill('trail')
    for (const s of allSegs) {
      for (let i = s.startIndex; i < Math.min(s.endIndex, n); i++) segMap[i] = s.terrain
    }
    for (let i = 1; i < n; i++) {
      if (segMap[i] !== segMap[i - 1]) {
        const coord = coords[i]
        const nearby = points.some(p =>
          (p.type === 'exit' || p.type === 'helipad') &&
          haversine({ lat: p.lat, lng: p.lng }, coord) < 200
        )
        if (!nearby) {
          addPoint({
            id: crypto.randomUUID(), lat: coord.lat, lng: coord.lng,
            type: 'exit', name: '下山口（自動）', note: 'トレイル/ロード境界', enabled: true, photos: [],
          })
        }
      }
    }
    setTerrainDialogIndices(null)
  }

  const deleteTerrainSegment = (idx: number) => {
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute) return
    updateRoute(mainRoute.id, { segments: mainRoute.segments.filter((_, i) => i !== idx) })
  }

  const saveNewPoint = () => {
    if (!newPoint || !pointPos) return
    addPoint({ id: crypto.randomUUID(), lat: pointPos.lat, lng: pointPos.lng, ...newPoint, enabled: true })
    setNewPoint(null)
    setPointPos(null)
    clearPending()
    setActiveTool('none')
  }

  // 写真ハンドラ
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
        {/* 分岐点設定中のヒント */}
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

        {/* 手描き中UI */}
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
              <button
                onClick={removeLastPoint}
                disabled={drawingPoints.length === 0}
                className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
              >↩ 1点戻す</button>
              <button
                onClick={finishDrawing}
                disabled={drawingPoints.length < 2 || fetchingEle}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
              >{fetchingEle ? '高度取得中…' : '✅ 完了'}</button>
              <button
                onClick={cancelDrawing}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
              >✖ キャンセル</button>
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

      {/* トレイル/ロード区間設定 */}
      {routes.find(r => r.type === 'course') && (() => {
        const mainRoute = routes.find(r => r.type === 'course')!
        return (
          <section>
            <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ トレイル/ロード区間</div>
            {terrainStep === 'start' && (
              <p className="text-xs text-blue-600 mb-1 font-semibold">📍 コース上をクリックして開始点を指定</p>
            )}
            {terrainStep === 'end' && (
              <p className="text-xs text-blue-600 mb-1 font-semibold">📍 コース上をクリックして終了点を指定</p>
            )}
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => { setTerrainStep('start'); setActiveTool('set_segment') }}
                className={`text-xs px-2 py-1 rounded transition ${terrainStep ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
              >＋ 区間追加</button>
              {terrainStep && (
                <button onClick={() => { setTerrainStep(null); terrainStartIdxRef.current = null; setActiveTool('none') }}
                  className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-600">キャンセル</button>
              )}
            </div>
            {computeEffectiveSegments(mainRoute.segments, mainRoute.coords.length).map((seg, i) => (
              <div key={i}
                className="flex items-center gap-1 py-0.5 text-xs cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
                onClick={() => {
                  const sliced = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
                  if (sliced.length >= 2) fitBounds(sliced)
                }}
                title="クリック：地図に表示"
              >
                <span className={seg.terrain === 'trail' ? 'text-green-600' : 'text-amber-500'}>
                  {seg.terrain === 'trail' ? '🌿' : '🚗'}
                </span>
                <span className={`flex-1 ${seg.storedIndex !== null ? 'text-gray-700' : 'text-gray-400'}`}>
                  {seg.name}
                </span>
                {seg.storedIndex !== null ? (
                  <>
                    <button onClick={e => { e.stopPropagation(); setEditSegmentIdx(seg.storedIndex!); setEditSegmentName(mainRoute.segments[seg.storedIndex!].name) }} className="text-xs text-gray-400 hover:text-blue-500">編集</button>
                    <button onClick={e => { e.stopPropagation(); deleteTerrainSegment(seg.storedIndex!) }} className="text-gray-400 hover:text-red-500">🗑</button>
                  </>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setEditImplicitSeg({ startIndex: seg.startIndex, endIndex: seg.endIndex }); setEditSegmentName(seg.name) }} className="text-xs text-gray-400 hover:text-blue-500">編集</button>
                )}
              </div>
            ))}
          </section>
        )
      })()}

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
            <span className="text-base">{POINT_ICONS[pt.type]}</span>
            <span className={`flex-1 text-sm truncate ${!pt.enabled ? 'opacity-40 line-through' : ''}`}>{pt.name}</span>
            <button onClick={e => { e.stopPropagation(); setEditPointId(pt.id) }} className="text-xs text-gray-400 hover:text-blue-500">編集</button>
            <button onClick={e => { e.stopPropagation(); deletePoint(pt.id) }} className="text-xs text-gray-400 hover:text-red-500">🗑</button>
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

      {/* 区間名編集ダイアログ */}
      {(editSegmentIdx !== null || editImplicitSeg !== null) && (() => {
        const mainRoute = routes.find(r => r.type === 'course')
        if (!mainRoute) return null
        const closeDialog = () => { setEditSegmentIdx(null); setEditImplicitSeg(null) }
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-3">
              <div className="font-bold text-gray-800">区間名を変更</div>
              <input className="border rounded px-2 py-1 text-sm" placeholder="区間名" value={editSegmentName}
                onChange={e => setEditSegmentName(e.target.value)} autoFocus />
              <div className="flex gap-2 justify-end">
                <button onClick={closeDialog} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
                <button
                  onClick={() => {
                    if (editSegmentIdx !== null) {
                      updateRoute(mainRoute.id, {
                        segments: mainRoute.segments.map((s, i) =>
                          i === editSegmentIdx ? { ...s, name: editSegmentName } : s
                        ),
                      })
                    } else if (editImplicitSeg !== null) {
                      updateRoute(mainRoute.id, {
                        segments: [...mainRoute.segments, { ...editImplicitSeg, terrain: 'trail' as const, name: editSegmentName }],
                      })
                    }
                    closeDialog()
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
              <button
                onClick={handleSnapYes}
                disabled={insertingCoord}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition">
                {insertingCoord ? '処理中…' : 'ルート上に追加'}
              </button>
              <button
                onClick={handleSnapNo}
                disabled={insertingCoord}
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
                  <option key={t} value={t}>{POINT_ICONS[t]} {POINT_LABELS[t]}</option>
                ))}
              </select>
              <input className="border rounded px-2 py-1 text-sm" placeholder="名前（必須）"
                value={newPoint.name} onChange={e => setNewPoint({ ...newPoint, name: e.target.value })} />
              <input className="border rounded px-2 py-1 text-sm" placeholder="備考（任意）"
                value={newPoint.note} onChange={e => setNewPoint({ ...newPoint, note: e.target.value })} />
              {/* 写真 */}
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

      {/* 区間種別選択ダイアログ */}
      {terrainDialogIndices && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-72 flex flex-col gap-4">
            <div className="font-bold text-gray-800">区間の種別を選択</div>
            <div className="flex gap-2">
              <button onClick={() => saveTerrainSegment('trail')}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold text-sm transition">
                🌿 トレイル
              </button>
              <button onClick={() => saveTerrainSegment('road')}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold text-sm transition">
                🚗 ロード
              </button>
            </div>
            <button onClick={() => setTerrainDialogIndices(null)}
              className="text-xs text-gray-400 hover:text-gray-600 text-center">キャンセル</button>
          </div>
        </div>
      )}

      {/* ポイント編集ダイアログ */}
      {editPt && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
              <div className="font-bold text-gray-800">ポイントを編集</div>
              <select className="border rounded px-2 py-1 text-sm"
                value={editPt.type} onChange={e => updatePoint(editPt.id, { type: e.target.value as PointType })}>
                {(Object.keys(POINT_LABELS) as PointType[]).map(t => (
                  <option key={t} value={t}>{POINT_ICONS[t]} {POINT_LABELS[t]}</option>
                ))}
              </select>
              <input className="border rounded px-2 py-1 text-sm" placeholder="名前"
                value={editPt.name} onChange={e => updatePoint(editPt.id, { name: e.target.value })} />
              <input className="border rounded px-2 py-1 text-sm" placeholder="備考"
                value={editPt.note} onChange={e => updatePoint(editPt.id, { note: e.target.value })} />
              {/* 写真 */}
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
