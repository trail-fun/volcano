import { useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { useMapStore } from '../../store/mapStore'
import { calcWaterRoute } from '../../hooks/useRouteCalc'
import { haversine, snapToRoute, elevationStats } from '../../utils/geo'
import { POINT_ICONS } from '../map/mapStyles'
import type { Route, Point } from '../../types/race'

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
  const [hiddenSections, setHiddenSections] = useState<Set<number>>(new Set())

  const toggleSection = (i: number) => setHiddenSections(prev => {
    const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next
  })

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

  const [showSectionList, setShowSectionList] = useState(false)
  const [showLocationList, setShowLocationList] = useState(false)
  const [showMarkerList, setShowMarkerList] = useState(false)
  const [expandedSectionCPs, setExpandedSectionCPs] = useState<Set<number>>(new Set())
  const [expandedCPSegs, setExpandedCPSegs] = useState<Set<string>>(new Set())

  const toggleSectionCP = (i: number) => setExpandedSectionCPs(prev => {
    const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next
  })
  const toggleCPSeg = (key: string) => setExpandedCPSegs(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  const openRacePlan = () => {
    const startDate = parseStartDateTime(race?.startTime || '')
    let cumDistKm = 0
    let cumMins = 0
    const rows = cpSection.map(ci => {
      const key = `${ci.fromCoordIdx}-${ci.toCoordIdx}`
      const mult = race?.cpMultipliers?.[key] ?? 1.0
      const ctMins = timeToMins(ci.courseTime)
      const intervalMins = ctMins * mult
      const breakMins = mainRoute
        ? mainRoute.segments
            .filter(s => s.startIndex >= ci.fromCoordIdx && s.endIndex <= ci.toCoordIdx)
            .reduce((sum, s) => sum + timeToMins(s.breakTime || ''), 0)
        : 0
      cumDistKm += ci.distKm
      cumMins += intervalMins + breakMins
      const passageTime = startDate
        ? formatDateTime(startDate, Math.round(cumMins))
        : minsToTime(Math.round(cumMins))
      return {
        name: `${ci.fromName} → ${ci.toName}`,
        courseTime: ci.courseTime,
        distKm: cumDistKm.toFixed(2),
        intervalTime: minsToTime(Math.round(intervalMins)),
        breakTime: breakMins > 0 ? minsToTime(Math.round(breakMins)) : '',
        passageTime,
        cumTime: minsToTime(Math.round(cumMins)),
        mult,
      }
    })

    const startInfo = race?.startTime
      ? `<p style="font-size:12px;color:#666;margin:0 0 12px">スタート時刻: <strong>${race.startTime}</strong></p>`
      : ''
    const trs = rows.map(r => {
      const ctLabel = r.courseTime
        ? ` <span style="color:#7c3aed;font-size:11px">（CT${r.courseTime}）</span>`
        : ''
      const multLabel = r.mult !== 1.0
        ? ` <span style="color:#d97706">×${r.mult}</span>`
        : ''
      return `<tr>
        <td>${r.name}${ctLabel}${multLabel}</td>
        <td class="num">${r.distKm} km</td>
        <td class="num" style="color:#7c3aed">${r.intervalTime}</td>
        <td class="num" style="color:#ea580c">${r.breakTime || '—'}</td>
        <td class="num" style="font-weight:600">${r.passageTime}</td>
        <td class="num" style="color:#555">${r.cumTime}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"><title>レースプラン</title>
<style>
  body{font-family:sans-serif;padding:20px;font-size:13px;background:#fff}
  h2{margin:0 0 8px;font-size:16px}
  table{border-collapse:collapse;width:100%}
  th,td{padding:6px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
  th{background:#f9fafb;font-weight:600;color:#374151;text-align:right}
  th:first-child{text-align:left}
  td:first-child{text-align:left;color:#374151}
  .num{text-align:right;font-family:monospace}
  tr:hover td{background:#f9fafb}
</style>
</head><body>
<h2>📋 レースプラン</h2>
${startInfo}
<table>
<thead><tr>
  <th style="text-align:left">CT区間</th>
  <th>累積距離</th><th>区間時間</th><th>休憩時間</th><th>通過時刻</th><th>累積時間</th>
</tr></thead>
<tbody>${trs}</tbody>
</table>
</body></html>`

    const w = window.open('', '_blank', 'width=700,height=500')
    if (w) { w.document.write(html); w.document.close() }
  }

  // hiddenSections が変わったら mapStore を更新（確認モード起動時は空 Set なのでリセット相当）
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

      {/* Section → CP区間 → 区間 (階層構造) */}
      {mainRoute && (
        <section>
          {/* Section ヘッダー */}
          <button
            className="flex items-center gap-1 text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide w-full text-left hover:text-blue-600 transition select-none"
            onClick={() => setShowSectionList(v => !v)}
          >
            <span>{showSectionList ? '▼' : '▶'}</span>
            <span>Section</span>
          </button>

          {showSectionList && (
            sectionIntervals.length === 0
              ? <p className="text-xs text-gray-400">Sectionポイント属性のある「地点」がありません</p>
              : sectionIntervals.map((si, i) => {
                const hidden = hiddenSections.has(i)
                const cpExpanded = expandedSectionCPs.has(i)
                const cpsInSection = cpSection.filter(cp =>
                  cp.fromCoordIdx >= si.fromCoordIdx && cp.toCoordIdx <= si.toCoordIdx
                )
                return (
                  <div key={i} className={`border-b last:border-0 border-gray-100 py-1 ${hidden ? 'opacity-40' : ''}`}>
                    {/* Section 行 */}
                    <div className="flex items-center gap-1.5 -mx-1 px-1">
                      <span
                        className="text-xs font-semibold text-gray-700 flex-1 cursor-pointer hover:text-blue-600 select-none truncate"
                        onClick={() => { if (!hidden) fitBounds(mainRoute.coords.slice(si.fromCoordIdx, si.toCoordIdx + 1)) }}
                        title="クリックで地図に表示"
                      >{si.fromName} → {si.toName}</span>
                      <button onClick={() => openElevationChart(`${si.fromName}→${si.toName}`, si.fromCoordIdx, si.toCoordIdx)} className="text-xs text-gray-400 hover:text-green-600" title="高低図">📈</button>
                      <button
                        onClick={() => toggleSection(i)}
                        className={`text-xs px-1.5 py-0.5 rounded border transition flex-shrink-0 ${hidden ? 'border-gray-300 text-gray-400 bg-gray-100' : 'border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100'}`}
                      >{hidden ? '非表示' : '表示'}</button>
                    </div>
                    {!hidden && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5 ml-1">
                        <span className="text-gray-600">📏 {si.distKm.toFixed(2)} km</span>
                        {si.descentM > 0 && <span className="text-blue-600">↓ {Math.round(si.descentM)} m</span>}
                        {si.ascentM > 0 && <span className="text-red-500">↑ {Math.round(si.ascentM)} m</span>}
                        {si.courseTime && <span className="text-purple-600">⏱ {si.courseTime}</span>}
                      </div>
                    )}

                    {/* ▶ CP区間 トグル */}
                    {!hidden && cpsInSection.length > 0 && (
                      <button
                        className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-indigo-600 mt-1 ml-2 select-none transition"
                        onClick={() => toggleSectionCP(i)}
                      >
                        <span>{cpExpanded ? '▼' : '▶'}</span>
                        <span>CP区間</span>
                      </button>
                    )}

                    {/* CP区間リスト */}
                    {!hidden && cpExpanded && (
                      <div className="ml-4 mt-0.5">
                        {cpsInSection.map((ci, j) => {
                          const cpKey = `${ci.fromCoordIdx}-${ci.toCoordIdx}`
                          const segExpanded = expandedCPSegs.has(cpKey)
                          const segsInCP = mainRoute.segments.filter(
                            s => s.startIndex >= ci.fromCoordIdx && s.endIndex <= ci.toCoordIdx
                          )
                          return (
                            <div key={j} className="border-b last:border-0 border-gray-100 py-1">
                              {/* CP区間 行 */}
                              <div
                                className="text-xs font-semibold text-gray-700 cursor-pointer hover:text-blue-600 select-none"
                                onClick={() => fitBounds(mainRoute.coords.slice(ci.fromCoordIdx, ci.toCoordIdx + 1))}
                                title="クリックで地図に表示"
                              >{ci.fromName} → {ci.toName}</div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono mt-0.5">
                                <span className="text-gray-600">📏 {ci.distKm.toFixed(2)} km</span>
                                {ci.descentM > 0 && <span className="text-blue-600">↓ {Math.round(ci.descentM)} m</span>}
                                {ci.ascentM > 0 && <span className="text-red-500">↑ {Math.round(ci.ascentM)} m</span>}
                                {ci.courseTime && <span className="text-purple-600">⏱ {ci.courseTime}</span>}
                              </div>

                              {/* ▶ 区間 トグル */}
                              {segsInCP.length > 0 && (
                                <button
                                  className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-indigo-600 mt-1 ml-2 select-none transition"
                                  onClick={() => toggleCPSeg(cpKey)}
                                >
                                  <span>{segExpanded ? '▼' : '▶'}</span>
                                  <span>区間</span>
                                </button>
                              )}

                              {/* 区間リスト */}
                              {segExpanded && (
                                <div className="ml-4 mt-0.5">
                                  {segsInCP.map((seg, k) => {
                                    const slice = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
                                    let distM = 0
                                    for (let m = 1; m < slice.length; m++) distM += haversine(slice[m - 1], slice[m])
                                    const { descentM, ascentM } = elevationStats(slice)
                                    return (
                                      <div
                                        key={k}
                                        className="py-1 border-b last:border-0 border-gray-100 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
                                        onClick={() => fitBounds(slice)}
                                        title="クリックで地図に表示"
                                      >
                                        <div className="text-xs font-semibold text-gray-700">{seg.name || `区間 ${k + 1}`}</div>
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
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
          )}
        </section>
      )}

      {/* コース地点 */}
      <section>
        <button
          className="flex items-center gap-1 text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide w-full text-left hover:text-blue-600 transition select-none"
          onClick={() => setShowLocationList(v => !v)}
        >
          <span>{showLocationList ? '▼' : '▶'}</span>
          <span>コース地点</span>
        </button>
        {showLocationList && (() => {
          const locs = points.filter(pt => pt.type === 'location')
          return locs.length === 0
            ? <p className="text-xs text-gray-400">地点がありません</p>
            : locs.map(pt => (
              <div key={pt.id} className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none" onClick={() => panTo({ lat: pt.lat, lng: pt.lng })} title="クリックで地図に表示">
                <span className="text-base text-red-600">●</span>
                <span className="flex-1 text-sm truncate text-gray-700">{pt.name}</span>
                {pt.cp && <span className="text-xs text-red-600 font-bold">CP</span>}
                {pt.section && <span className="text-xs text-orange-600 font-bold">S</span>}
              </div>
            ))
        })()}
      </section>

      {/* マーカー */}
      <section>
        <button
          className="flex items-center gap-1 text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide w-full text-left hover:text-blue-600 transition select-none"
          onClick={() => setShowMarkerList(v => !v)}
        >
          <span>{showMarkerList ? '▼' : '▶'}</span>
          <span>マーカー</span>
        </button>
        {showMarkerList && (() => {
          const markers = points.filter(pt => pt.type !== 'location')
          return markers.length === 0
            ? <p className="text-xs text-gray-400">マーカーがありません</p>
            : markers.map(pt => (
              <div key={pt.id} className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none" onClick={() => panTo({ lat: pt.lat, lng: pt.lng })} title="クリックで地図に表示">
                <span className="text-base">{POINT_ICONS[pt.type]}</span>
                <span className="flex-1 text-sm truncate text-gray-700">{pt.name}</span>
              </div>
            ))
        })()}
      </section>

      {/* レースプラン確認ボタン */}
      {cpSection.length > 0 && (
        <button
          onClick={openRacePlan}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-sm transition"
        >
          📋 レースプラン確認
        </button>
      )}

    </div>
  )
}
