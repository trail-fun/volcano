import { useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { useMapStore } from '../../store/mapStore'
import { calcWaterRoute } from '../../hooks/useRouteCalc'
import { haversine, snapToRoute, elevationStats } from '../../utils/geo'
import { POINT_ICONS } from '../map/mapStyles'
import type { Route, Point, Segment } from '../../types/race'

// ─── Segment interval 計算（EditPanel と共通ロジック） ────────────────────────

function snapLocationPoints(points: Point[], mainRoute: Route, filter: (p: Point) => boolean) {
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

function calcIntervals(
  flagPoints: { name: string; coordIdx: number }[],
  mainRoute: Route,
) {
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
      .reduce((sum, s) => {
        const parts = (s.courseTime || '').split(':').map(Number)
        return sum + (parts[0] || 0) * 60 + (parts[1] || 0)
      }, 0)
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    return {
      fromName: from.name, toName: to.name,
      fromCoordIdx: from.coordIdx, toCoordIdx: to.coordIdx,
      distKm: distM / 1000, descentM, ascentM,
      courseTime: totalMins > 0 ? `${h}:${String(m).padStart(2, '0')}` : '',
    }
  })
}

function getDisplaySegments(segments: Segment[], coordCount: number): Segment[] {
  if (segments.length > 0) return segments
  if (coordCount < 2) return []
  return [{ startIndex: 0, endIndex: coordCount - 1, name: 'コース全体', courseTime: '' }]
}

// ─── メインパネル ─────────────────────────────────────────────────────────────

export default function OperationPanel() {
  const { routes, points } = useRaceStore()
  const { position, candidates, setPosition, selectCandidate, clearCasualty } = useCasualtyStore()
  const { fitBounds, panTo, setHiddenCourseRanges } = useMapStore()
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')

  // 確認モード起動時は hidden ranges をリセット
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setHiddenCourseRanges([]) }, [])

  const mainRoute = routes.find(r => r.type === 'course')
  const waterRoute = candidates[0] ?? null

  const sectionIntervals = mainRoute
    ? calcIntervals(snapLocationPoints(points, mainRoute, p => p.section), mainRoute)
    : []
  const cpSection = mainRoute
    ? calcIntervals(snapLocationPoints(points, mainRoute, p => p.cp), mainRoute)
    : []

  const setManualPosition = () => {
    const lat = parseFloat(latStr), lng = parseFloat(lngStr)
    if (isNaN(lat) || isNaN(lng)) return
    const wr = calcWaterRoute({ lat, lng }, routes, points)
    setPosition({ lat, lng }, wr ? [wr] : [])
    if (wr) selectCandidate(wr.id)
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">

      {/* 競技者位置 */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 競技者位置</div>
        <p className="text-xs text-gray-500 mb-2">地図をタップして指定、または座標を入力</p>
        <div className="flex gap-1 mb-1">
          <input className="flex-1 border rounded px-2 py-1 text-xs font-mono" placeholder="緯度" value={latStr} onChange={e => setLatStr(e.target.value)} />
          <input className="flex-1 border rounded px-2 py-1 text-xs font-mono" placeholder="経度" value={lngStr} onChange={e => setLngStr(e.target.value)} />
          <button onClick={setManualPosition} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-500 transition">設定</button>
        </div>
        {position && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-green-700 font-mono">🏃 {position.lat.toFixed(5)}, {position.lng.toFixed(5)}</span>
            <button onClick={clearCasualty} className="text-xs text-red-400 hover:text-red-600">クリア</button>
          </div>
        )}
      </section>

      {/* 最寄り水場 */}
      {position && (
        <>
          <hr className="border-gray-200" />
          <section>
            <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 最寄り水場</div>
            {!waterRoute
              ? <p className="text-xs text-orange-500">水場がルート上に見つかりません（ルートから200m以内に「水場」ポイントを追加してください）</p>
              : (
                <div
                  className="p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100 transition"
                  onClick={() => waterRoute.pathCoords && waterRoute.pathCoords.length >= 2 && fitBounds(waterRoute.pathCoords)}
                  title="クリックで地図に表示"
                >
                  <div className="text-sm font-semibold text-gray-800">💧 {waterRoute.exitPointName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{waterRoute.label}</div>
                  <div className="flex flex-wrap gap-3 text-xs font-mono mt-1.5">
                    <span className="text-gray-700">📏 {(waterRoute.totalDistanceM / 1000).toFixed(2)} km</span>
                    {waterRoute.totalDescentM > 0 && <span className="text-blue-600">↓ {Math.round(waterRoute.totalDescentM)} m</span>}
                    {waterRoute.totalAscentM > 0 && <span className="text-red-500">↑ {Math.round(waterRoute.totalAscentM)} m</span>}
                  </div>
                </div>
              )
            }
          </section>
        </>
      )}

      <hr className="border-gray-200" />

      {/* Section */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ Section</div>
          {sectionIntervals.length === 0
            ? <p className="text-xs text-gray-400">Sectionポイント属性のある「地点」がありません</p>
            : sectionIntervals.map((ci, i) => (
              <div
                key={i}
                className="py-1 border-b last:border-0 border-gray-100 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
                onClick={() => fitBounds(mainRoute.coords.slice(ci.fromCoordIdx, ci.toCoordIdx + 1))}
                title="クリックで地図に表示"
              >
                <div className="text-xs font-semibold text-gray-700">{ci.fromName} → {ci.toName}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5">
                  <span className="text-gray-600">📏 {ci.distKm.toFixed(2)} km</span>
                  {ci.descentM > 0 && <span className="text-blue-600">↓ {Math.round(ci.descentM)} m</span>}
                  {ci.ascentM > 0 && <span className="text-red-500">↑ {Math.round(ci.ascentM)} m</span>}
                  {ci.courseTime && <span className="text-purple-600">⏱ {ci.courseTime}</span>}
                </div>
              </div>
            ))
          }
        </section>
      )}

      {/* CP区間 */}
      {mainRoute && cpSection.length > 0 && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ CP区間</div>
          {cpSection.map((ci, i) => (
            <div
              key={i}
              className="py-1 border-b last:border-0 border-gray-100 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
              onClick={() => fitBounds(mainRoute.coords.slice(ci.fromCoordIdx, ci.toCoordIdx + 1))}
              title="クリックで地図に表示"
            >
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

      {/* 区間 */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 区間</div>
          {getDisplaySegments(mainRoute.segments, mainRoute.coords.length).map((seg, i) => {
            const slice = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
            let distM = 0
            for (let j = 1; j < slice.length; j++) distM += haversine(slice[j - 1], slice[j])
            const { descentM, ascentM } = elevationStats(slice)
            return (
              <div
                key={i}
                className="py-1 border-b last:border-0 border-gray-100 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
                onClick={() => fitBounds(slice)}
                title="クリックで地図に表示"
              >
                <div className="text-xs font-semibold text-gray-700">{seg.name || `区間 ${i + 1}`}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5">
                  <span className="text-gray-600">📏 {(distM / 1000).toFixed(2)} km</span>
                  {descentM > 0 && <span className="text-blue-600">↓ {Math.round(descentM)} m</span>}
                  {ascentM > 0 && <span className="text-red-500">↑ {Math.round(ascentM)} m</span>}
                  {seg.courseTime && <span className="text-purple-600">⏱ {seg.courseTime}</span>}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* ポイント */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ポイント</div>
        {points.length === 0 && <p className="text-xs text-gray-400">ポイントが登録されていません</p>}
        {points.map(pt => (
          <div
            key={pt.id}
            className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
            onClick={() => panTo({ lat: pt.lat, lng: pt.lng })}
            title="クリックで地図に表示"
          >
            {pt.type === 'location'
              ? <span className="text-base text-red-600">●</span>
              : <span className="text-base">{POINT_ICONS[pt.type]}</span>
            }
            <span className="flex-1 text-sm truncate text-gray-700">{pt.name}</span>
            {pt.type === 'location' && pt.cp && <span className="text-xs text-red-600 font-bold">CP</span>}
            {pt.type === 'location' && pt.section && <span className="text-xs text-orange-600 font-bold">S</span>}
          </div>
        ))}
      </section>

    </div>
  )
}
