import { useState } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { useMapStore } from '../../store/mapStore'
import { calcCandidates } from '../../hooks/useRouteCalc'
import { haversine, snapToRoute } from '../../utils/geo'
import { POINT_ICONS, CANDIDATE_COLORS } from '../map/mapStyles'
import type { RouteCandidate } from '../../types/candidate'
import type { Point, Terrain, Segment } from '../../types/race'

function computeEffectiveSegments(segments: Segment[], coordCount: number): { startIndex: number; endIndex: number; terrain: Terrain; name: string }[] {
  if (coordCount < 2) return []
  const n = coordCount - 1
  if (segments.length === 0) return [{ startIndex: 0, endIndex: n, terrain: 'trail', name: 'トレイル' }]
  const sorted = [...segments].sort((a, b) => a.startIndex - b.startIndex)
  const result: { startIndex: number; endIndex: number; terrain: Terrain; name: string }[] = []
  let cur = 0
  for (const seg of sorted) {
    if (seg.startIndex > cur) result.push({ startIndex: cur, endIndex: seg.startIndex, terrain: 'trail', name: 'トレイル' })
    result.push({ startIndex: seg.startIndex, endIndex: seg.endIndex, terrain: seg.terrain, name: seg.name })
    cur = seg.endIndex
  }
  if (cur < n) result.push({ startIndex: cur, endIndex: n, terrain: 'trail', name: 'トレイル' })
  return result
}

// ─── 高低図モーダル ──────────────────────────────────────────────────────────

function ElevationProfileModal({
  candidate, points, onClose,
}: { candidate: RouteCandidate; points: Point[]; onClose: () => void }) {
  const [selectedMarkerIdx, setSelectedMarkerIdx] = useState<number | null>(null)

  const { pathCoords } = candidate
  if (!pathCoords || pathCoords.length < 2) return null

  const dists: number[] = [0]
  for (let i = 1; i < pathCoords.length; i++) {
    dists.push(dists[i - 1] + haversine(pathCoords[i - 1], pathCoords[i]))
  }
  const totalDist = dists[dists.length - 1]

  const eles = pathCoords.map(c => c.ele)
  const hasEle = eles.some(e => e !== 0)
  const minEle = hasEle ? Math.min(...eles) : 0
  const maxEle = hasEle ? Math.max(...eles) : 100
  const eleRange = Math.max(maxEle - minEle, 10)

  const W = 360, H = 190
  const PAD = { t: 32, b: 28, l: 42, r: 14 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  const toX = (d: number) => PAD.l + (totalDist > 0 ? d / totalDist : 0) * cW
  const toY = (e: number) => PAD.t + (1 - (e - minEle) / eleRange) * cH

  const linePts = pathCoords.map((c, i) => `${toX(dists[i])},${toY(c.ele)}`).join(' ')
  const areaPts = `${toX(0)},${PAD.t + cH} ${linePts} ${toX(totalDist)},${PAD.t + cH}`

  type Marker = { icon: string; dist: number; ele: number; label: string; note: string }
  const markers: Marker[] = []

  // 傷病者（始点、常に表示）
  markers.push({ icon: '🚨', dist: 0, ele: eles[0], label: '傷病者', note: '' })

  // 下山口ゴール（終点、常に表示）
  const exitPt = points.find(p => p.id === candidate.exitPointId)
  if (exitPt) {
    markers.push({ icon: POINT_ICONS[exitPt.type], dist: totalDist, ele: eles[eles.length - 1], label: exitPt.name, note: exitPt.note })
  }

  // ルート線上にあるポイント（ゴール以外、30m 以内）
  for (const pt of points) {
    if (!pt.enabled || pt.id === candidate.exitPointId) continue
    const snap = snapToRoute(pt, pathCoords, 30)
    if (!snap) continue
    const si = snap.segmentIndex
    const ni = Math.min(si + 1, pathCoords.length - 1)
    const snapDist = dists[si] + snap.ratio * haversine(pathCoords[si], pathCoords[ni])
    const snapEle = pathCoords[si].ele + snap.ratio * (pathCoords[ni].ele - pathCoords[si].ele)
    markers.push({ icon: POINT_ICONS[pt.type], dist: snapDist, ele: snapEle, label: pt.name, note: pt.note })
  }
  markers.sort((a, b) => a.dist - b.dist)

  const yTicks = [minEle, (minEle + maxEle) / 2, maxEle]
  const sel = selectedMarkerIdx !== null ? markers[selectedMarkerIdx] : null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-gray-800 text-sm">
            高低図 — {candidate.exitPointType === 'helipad' ? '🚁' : '🚩'} {candidate.exitPointName}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1">×</button>
        </div>

        {!hasEle ? (
          <p className="text-xs text-gray-400 py-8 text-center">高度データがありません</p>
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
            {yTicks.map((e, ti) => (
              <g key={ti}>
                <line x1={PAD.l} y1={toY(e)} x2={PAD.l + cW} y2={toY(e)} stroke="#e5e7eb" strokeWidth="1" />
                <text x={PAD.l - 4} y={toY(e) + 3.5} textAnchor="end" fontSize="9" fill="#9ca3af">{Math.round(e)}</text>
              </g>
            ))}
            <line x1={PAD.l} y1={PAD.t + cH} x2={PAD.l + cW} y2={PAD.t + cH} stroke="#d1d5db" strokeWidth="1" />
            <text x={PAD.l} y={H - 4} fontSize="9" fill="#9ca3af">0</text>
            <text x={PAD.l + cW} y={H - 4} textAnchor="end" fontSize="9" fill="#9ca3af">{(totalDist / 1000).toFixed(2)} km</text>
            <polygon points={areaPts} fill="rgba(220,38,38,0.12)" />
            <polyline points={linePts} fill="none" stroke="#dc2626" strokeWidth="2" strokeLinejoin="round" />
            {markers.map((m, mi) => {
              const mx = toX(m.dist)
              const my = toY(m.ele)
              const above = my > PAD.t + cH * 0.55
              const isSelected = selectedMarkerIdx === mi
              return (
                <g key={mi} style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedMarkerIdx(isSelected ? null : mi)}>
                  <line x1={mx} y1={PAD.t} x2={mx} y2={PAD.t + cH} stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
                  <circle cx={mx} cy={my} r={isSelected ? 5 : 3.5} fill={isSelected ? '#dbeafe' : 'white'} stroke={isSelected ? '#2563eb' : '#374151'} strokeWidth="1.5" />
                  <text x={mx} y={above ? my - 6 : my + 17} textAnchor="middle" fontSize="13" style={{ userSelect: 'none' }}>{m.icon}</text>
                </g>
              )
            })}
            <text x={12} y={PAD.t + cH / 2} textAnchor="middle" fontSize="9" fill="#9ca3af"
              transform={`rotate(-90,12,${PAD.t + cH / 2})`}>標高(m)</text>
          </svg>
        )}

        {/* マーカー選択時ポップアップ */}
        {sel && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
            <div className="font-semibold text-gray-800">{sel.icon} {sel.label}</div>
            {sel.note && <div className="text-gray-500 mt-0.5">{sel.note}</div>}
          </div>
        )}

        <div className="flex gap-4 text-xs font-mono text-gray-600 border-t pt-2">
          <span>📏 {(totalDist / 1000).toFixed(2)} km</span>
          <span className="text-blue-600">↓ {Math.round(candidate.totalDescentM)} m</span>
          {candidate.totalAscentM > 0 && <span className="text-red-500">↑ {Math.round(candidate.totalAscentM)} m</span>}
        </div>
      </div>
    </div>
  )
}

// ─── 候補カード ──────────────────────────────────────────────────────────────

function CandidateCard({
  c, color, selected, onSelect, onShowChart,
}: { c: RouteCandidate; color: string; selected: boolean; onSelect: () => void; onShowChart: () => void }) {
  const distKm = (c.totalDistanceM / 1000).toFixed(2)
  const typeIcon = c.exitPointType === 'helipad' ? '🚁' : '🚩'
  return (
    <div
      role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
      className={`w-full text-left p-3 rounded-lg border-2 transition cursor-pointer ${selected ? '' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
      style={selected ? { borderColor: color, backgroundColor: color + '18' } : {}}
    >
      <div className="flex items-center gap-1.5 font-semibold text-sm">
        <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color, flexShrink: 0, display: 'inline-block' }} />
        <span>{typeIcon}</span>
        <span className="truncate flex-1">{c.exitPointName}</span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
      <div className="flex gap-3 text-xs mt-1.5 font-mono">
        <span className="text-gray-700">📏 {distKm} km</span>
        <span className="text-blue-600">↓ {Math.round(c.totalDescentM)} m</span>
        {c.totalAscentM > 0 && <span className="text-red-500">↑ {Math.round(c.totalAscentM)} m</span>}
      </div>
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        {c.transportSuitability.map(t => (
          <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
            {t === 'walk' ? '徒歩' : t === 'stretcher' ? '担架' : 'ヘリ'}
          </span>
        ))}
        <span className={`text-xs px-1.5 py-0.5 rounded ${c.difficulty === 'low' ? 'bg-green-100 text-green-700' : c.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
          {c.difficulty === 'low' ? '難易度：低' : c.difficulty === 'medium' ? '難易度：中' : '難易度：高'}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onShowChart() }}
          className="ml-auto text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded border border-indigo-200 transition"
        >
          📈 高低図
        </button>
      </div>
    </div>
  )
}

// ─── メインパネル ────────────────────────────────────────────────────────────

export default function OperationPanel() {
  const { routes, points, togglePoint } = useRaceStore()
  const { position, candidates, selectedCandidateId, setPosition, selectCandidate, clearCasualty } = useCasualtyStore()
  const { fitBounds, panTo } = useMapStore()
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [chartCandidateId, setChartCandidateId] = useState<string | null>(null)

  const goals = points.filter(p => p.type === 'exit' || p.type === 'helipad')
  const chartCandidate = chartCandidateId ? (candidates.find(c => c.id === chartCandidateId) ?? null) : null
  const mainRoute = routes.find(r => r.type === 'course')

  const setManualPosition = () => {
    const lat = parseFloat(latStr), lng = parseFloat(lngStr)
    if (isNaN(lat) || isNaN(lng)) return
    const newCandidates = calcCandidates({ lat, lng }, routes, points)
    setPosition({ lat, lng }, newCandidates)
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* ルート候補（最上部） */}
      <section className="flex-1">
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ルート候補</div>
        {!position && <p className="text-xs text-gray-400">傷病者位置を指定すると候補が表示されます</p>}
        {position && candidates.length === 0 && (
          <p className="text-xs text-orange-500">候補が見つかりません（コース上100m以内に傷病者位置を指定してください）</p>
        )}
        <div className="flex flex-col gap-2">
          {candidates.map((c, i) => (
            <CandidateCard
              key={c.id} c={c}
              color={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
              selected={selectedCandidateId === c.id}
              onSelect={() => selectCandidate(selectedCandidateId === c.id ? null : c.id)}
              onShowChart={() => setChartCandidateId(c.id)}
            />
          ))}
        </div>
      </section>

      <hr className="border-gray-200" />

      {/* 傷病者位置 */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 傷病者位置</div>
        <p className="text-xs text-gray-500 mb-2">地図をタップして指定、または座標を入力</p>
        <div className="flex gap-1 mb-1">
          <input className="flex-1 border rounded px-2 py-1 text-xs font-mono" placeholder="緯度" value={latStr} onChange={e => setLatStr(e.target.value)} />
          <input className="flex-1 border rounded px-2 py-1 text-xs font-mono" placeholder="経度" value={lngStr} onChange={e => setLngStr(e.target.value)} />
          <button onClick={setManualPosition} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-500 transition">設定</button>
        </div>
        {position && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-green-700 font-mono">🚨 {position.lat.toFixed(5)}, {position.lng.toFixed(5)}</span>
            <button onClick={clearCasualty} className="text-xs text-red-400 hover:text-red-600">クリア</button>
          </div>
        )}
      </section>

      <hr className="border-gray-200" />

      {/* ルート */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ルート</div>
        {routes.length === 0 && <p className="text-xs text-gray-400">ルートが登録されていません</p>}
        {routes.map(r => (
          <div
            key={r.id}
            className="text-sm py-1 flex items-center gap-1 cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
            onClick={() => r.coords.length >= 2 && fitBounds(r.coords)}
            title="クリックで地図に表示"
          >
            <span className={r.type === 'course' ? 'text-green-600' : r.type === 'escape' ? 'text-blue-600' : 'text-gray-400'}>
              {r.type === 'course' ? '🟢' : r.type === 'escape' ? '🔵' : '⚫'}
            </span>
            <span className="flex-1 truncate">{r.name}</span>
            <span className="text-xs text-gray-400">
              {r.type === 'course' ? 'メイン' : r.type === 'escape' ? 'エスケープ' : '車道'}
            </span>
          </div>
        ))}
      </section>

      <hr className="border-gray-200" />

      {/* トレイル/ロード区間 */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ トレイル/ロード区間</div>
          {computeEffectiveSegments(mainRoute.segments, mainRoute.coords.length).map((seg, i) => (
            <div
              key={i}
              className="flex items-center gap-1 py-0.5 text-xs cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
              onClick={() => {
                const sliced = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
                if (sliced.length >= 2) fitBounds(sliced)
              }}
              title="クリックで地図に表示"
            >
              <span className={seg.terrain === 'trail' ? 'text-green-600' : 'text-amber-500'}>
                {seg.terrain === 'trail' ? '🌿' : '🚗'}
              </span>
              <span className="flex-1 text-gray-700">{seg.name}</span>
            </div>
          ))}
        </section>
      )}

      <hr className="border-gray-200" />

      {/* ゴール地点オン/オフ */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ゴール地点</div>
        {goals.length === 0 && <p className="text-xs text-gray-400">下山口・ヘリポートが未登録です</p>}
        {goals.map(pt => (
          <div key={pt.id} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={pt.enabled} onChange={() => togglePoint(pt.id)} className="rounded cursor-pointer" />
            <button
              onClick={() => panTo({ lat: pt.lat, lng: pt.lng })}
              className="flex items-center gap-1.5 flex-1 text-left hover:bg-gray-50 rounded px-1 -mx-1 transition"
            >
              <span className="text-base">{POINT_ICONS[pt.type]}</span>
              <span className={`text-sm ${!pt.enabled ? 'opacity-40 line-through' : ''}`}>{pt.name}</span>
            </button>
          </div>
        ))}
      </section>

      {chartCandidate && (
        <ElevationProfileModal
          candidate={chartCandidate}
          points={points}
          onClose={() => setChartCandidateId(null)}
        />
      )}
    </div>
  )
}
