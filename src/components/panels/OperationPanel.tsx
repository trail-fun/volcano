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
  return [{ startIndex: 0, endIndex: coordCount - 1, name: 'コース全体', courseTime: '', breakTime: '' }]
}

// ─── メインパネル ─────────────────────────────────────────────────────────────

function timeToMins(t: string): number {
  if (!t) return 0
  const p = t.split(':').map(Number)
  return (p[0] || 0) * 60 + (p[1] || 0)
}
function minsToTime(m: number): string {
  const h = Math.floor(m / 60); const min = Math.round(m % 60)
  return `${h}:${String(min).padStart(2, '0')}`
}
// yyyy/mm/dd hh:mm をパースして Date を返す（なければ null）
function parseStartDateTime(s: string): Date | null {
  if (!s) return null
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
}
// Date + 分数 → yyyy/mm/dd hh:mm
function formatDateTime(base: Date, addMins: number): string {
  const d = new Date(base.getTime() + addMins * 60000)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}/${mo}/${day} ${h}:${min}`
}

export default function OperationPanel() {
  const { race, routes, points } = useRaceStore()
  const { position, candidates, setPosition, selectCandidate, clearCasualty } = useCasualtyStore()
  const { fitBounds, panTo, setHiddenCourseRanges } = useMapStore()
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [showRacePlan, setShowRacePlan] = useState(false)

  // 確認モード起動時は hidden ranges をリセット
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setHiddenCourseRanges([]) }, [])

  const mainRoute = routes.find(r => r.type === 'course')
  const waterRoute = candidates[0] ?? null

  // 水場までのコースタイム合計（区間のcourseTimeを合算）
  const waterCourseTime = (() => {
    if (!waterRoute || !mainRoute) return ''
    const seg = waterRoute.segments[0]
    if (!seg) return ''
    const lo = Math.min(seg.fromIndex, seg.toIndex)
    const hi = Math.max(seg.fromIndex, seg.toIndex)
    const totalMins = mainRoute.segments
      .filter(s => s.startIndex >= lo && s.endIndex <= hi)
      .reduce((sum, s) => {
        const parts = (s.courseTime || '').split(':').map(Number)
        return sum + (parts[0] || 0) * 60 + (parts[1] || 0)
      }, 0)
    if (totalMins === 0) return ''
    return `${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, '0')}`
  })()

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
                    {waterCourseTime && <span className="text-purple-600">⏱ {waterCourseTime}</span>}
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
                  {seg.breakTime && <span className="text-orange-500">☕ {seg.breakTime}</span>}
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

      {/* レースプラン確認ボタン */}
      {cpSection.length > 0 && (
        <button
          onClick={() => setShowRacePlan(true)}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-sm transition"
        >
          📋 レースプラン確認
        </button>
      )}

      {/* レースプランモーダル */}
      {showRacePlan && (() => {
        const startDate = parseStartDateTime(race?.startTime || '')
        let cumDistKm = 0
        let cumMins = 0
        const rows = cpSection.map(ci => {
          const key = `${ci.fromCoordIdx}-${ci.toCoordIdx}`
          const mult = race?.cpMultipliers?.[key] ?? 1.0
          const ctMins = timeToMins(ci.courseTime)
          const planned = ctMins * mult
          cumDistKm += ci.distKm
          cumMins += planned
          const passageTime = startDate
            ? formatDateTime(startDate, Math.round(cumMins))
            : minsToTime(Math.round(cumMins))
          return {
            name: `${ci.fromName} → ${ci.toName}`,
            distKm: cumDistKm.toFixed(2),
            passageTime,
            cumTime: minsToTime(Math.round(cumMins)),
            ctMins, mult, planned,
          }
        })
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-2">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col gap-3 p-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="font-bold text-gray-800">📋 レースプラン</div>
                <button onClick={() => setShowRacePlan(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1">×</button>
              </div>
              {race?.startTime && (
                <div className="text-xs text-gray-500">スタート時刻: <span className="font-mono font-semibold">{race.startTime}</span></div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left py-1.5 px-2 font-semibold text-gray-600">CT区間</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-gray-600 whitespace-nowrap">累積距離</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-gray-600 whitespace-nowrap">通過時刻</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-gray-600 whitespace-nowrap">累積時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-1.5 px-2 text-gray-700">
                          {r.name}
                          {r.mult !== 1.0 && <span className="ml-1 text-amber-600 font-mono">×{r.mult}</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-gray-600">{r.distKm} km</td>
                        <td className="py-1.5 px-2 text-right font-mono font-semibold text-gray-800">{r.passageTime}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-gray-600">{r.cumTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
