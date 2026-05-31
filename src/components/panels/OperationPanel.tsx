import { useState } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { useMapStore } from '../../store/mapStore'
import { calcCandidates } from '../../hooks/useRouteCalc'
import { haversine, snapToRoute } from '../../utils/geo'
import { POINT_ICONS, CANDIDATE_COLORS } from '../map/mapStyles'
import type { RouteCandidate } from '../../types/candidate'
import type { Point, Segment } from '../../types/race'

function getDisplaySegments(segments: Segment[], coordCount: number): Segment[] {
  if (segments.length > 0) return segments
  if (coordCount < 2) return []
  return [{ startIndex: 0, endIndex: coordCount - 1, name: 'コース全体', courseTime: '' }]
}

// ─── 比較高低図モーダル ──────────────────────────────────────────────────────

function ElevationCompareModal({
  candidates, points, colors, onClose,
}: { candidates: RouteCandidate[]; points: Point[]; colors: string[]; onClose: () => void }) {
  const [selectedInfo, setSelectedInfo] = useState<{ label: string; note: string; icon: string } | null>(null)

  type CandidateData = {
    c: RouteCandidate; color: string
    dists: number[]; totalDist: number; eles: number[]
  }

  const data: CandidateData[] = candidates
    .filter(c => c.pathCoords && c.pathCoords.length >= 2)
    .map((c, i) => {
      const pc = c.pathCoords!
      const dists: number[] = [0]
      for (let j = 1; j < pc.length; j++) dists.push(dists[j - 1] + haversine(pc[j - 1], pc[j]))
      return { c, color: colors[i], dists, totalDist: dists[dists.length - 1], eles: pc.map(p => p.ele) }
    })

  if (data.length === 0) return null

  const allEles = data.flatMap(d => d.eles)
  const hasEle = allEles.some(e => e !== 0)
  const minEle = hasEle ? Math.min(...allEles) : 0
  const maxEle = hasEle ? Math.max(...allEles) : 100
  const eleRange = Math.max(maxEle - minEle, 10)
  const maxDist = Math.max(...data.map(d => d.totalDist))

  const W = 400, H = 210
  const PAD = { t: 32, b: 28, l: 42, r: 14 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  const toX = (d: number) => PAD.l + (maxDist > 0 ? d / maxDist : 0) * cW
  const toY = (e: number) => PAD.t + (1 - (e - minEle) / eleRange) * cH
  const yTicks = [minEle, (minEle + maxEle) / 2, maxEle]

  // ルート上ポイント（全候補共通の始点ポイント群）
  type RouteMarker = { icon: string; dist: number; ele: number; label: string; note: string; di: number }
  const routeMarkers: RouteMarker[] = []
  data.forEach((d, di) => {
    for (const pt of points) {
      if (!pt.enabled || pt.id === d.c.exitPointId) continue
      const snap = snapToRoute(pt, d.c.pathCoords!, 30)
      if (!snap) continue
      const si = snap.segmentIndex
      const ni = Math.min(si + 1, d.c.pathCoords!.length - 1)
      const snapDist = d.dists[si] + snap.ratio * haversine(d.c.pathCoords![si], d.c.pathCoords![ni])
      const snapEle = d.c.pathCoords![si].ele + snap.ratio * (d.c.pathCoords![ni].ele - d.c.pathCoords![si].ele)
      routeMarkers.push({ icon: POINT_ICONS[pt.type], dist: snapDist, ele: snapEle, label: pt.name, note: pt.note, di })
    }
  })

  const startEle = data[0].eles[0]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-gray-800 text-sm">📈 高低図比較</div>
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
            <text x={PAD.l + cW} y={H - 4} textAnchor="end" fontSize="9" fill="#9ca3af">{(maxDist / 1000).toFixed(2)} km</text>
            <text x={12} y={PAD.t + cH / 2} textAnchor="middle" fontSize="9" fill="#9ca3af"
              transform={`rotate(-90,12,${PAD.t + cH / 2})`}>標高(m)</text>

            {/* 各候補ライン */}
            {data.map((d, di) => {
              const linePts = d.c.pathCoords!.map((p, j) => `${toX(d.dists[j])},${toY(p.ele)}`).join(' ')
              const areaPts = `${toX(0)},${PAD.t + cH} ${linePts} ${toX(d.totalDist)},${PAD.t + cH}`
              const ex = toX(d.totalDist)
              const ey = toY(d.eles[d.eles.length - 1])
              const exitPt = points.find(p => p.id === d.c.exitPointId)
              return (
                <g key={di}>
                  <polygon points={areaPts} fill={d.color} fillOpacity="0.1" />
                  <polyline points={linePts} fill="none" stroke={d.color} strokeWidth="2" strokeLinejoin="round" />
                  {/* ゴールマーカー */}
                  <g style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedInfo(selectedInfo?.label === d.c.exitPointName ? null : {
                      icon: d.c.exitPointType === 'helipad' ? '🚁' : '🚩',
                      label: d.c.exitPointName,
                      note: exitPt?.note ?? '',
                    })}>
                    <circle cx={ex} cy={ey} r={5} fill={d.color} stroke="white" strokeWidth="1.5" />
                    <text x={ex} y={ey > PAD.t + cH * 0.55 ? ey - 7 : ey + 18} textAnchor="middle" fontSize="12" style={{ userSelect: 'none' }}>
                      {d.c.exitPointType === 'helipad' ? '🚁' : '🚩'}
                    </text>
                  </g>
                </g>
              )
            })}

            {/* ルート上ポイントマーカー */}
            {routeMarkers.map((m, mi) => {
              const mx = toX(m.dist)
              const my = toY(m.ele)
              const above = my > PAD.t + cH * 0.55
              return (
                <g key={mi} style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedInfo(selectedInfo?.label === m.label ? null : { icon: m.icon, label: m.label, note: m.note })}>
                  <circle cx={mx} cy={my} r={3.5} fill="white" stroke={data[m.di].color} strokeWidth="1.5" />
                  <text x={mx} y={above ? my - 6 : my + 17} textAnchor="middle" fontSize="12" style={{ userSelect: 'none' }}>{m.icon}</text>
                </g>
              )
            })}

            {/* 傷病者（共通始点） */}
            <g style={{ cursor: 'pointer' }}
              onClick={() => setSelectedInfo(selectedInfo?.label === '傷病者' ? null : { icon: '🚨', label: '傷病者', note: '' })}>
              <circle cx={toX(0)} cy={toY(startEle)} r={4} fill="white" stroke="#374151" strokeWidth="1.5" />
              <text x={toX(0)} y={toY(startEle) - 7} textAnchor="middle" fontSize="13" style={{ userSelect: 'none' }}>🚨</text>
            </g>
          </svg>
        )}

        {/* マーカーポップアップ */}
        {selectedInfo && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
            <div className="font-semibold text-gray-800">{selectedInfo.icon} {selectedInfo.label}</div>
            {selectedInfo.note && <div className="text-gray-500 mt-0.5">{selectedInfo.note}</div>}
          </div>
        )}

        {/* 凡例 */}
        <div className="flex flex-col gap-2 border-t pt-2">
          {data.map((d, di) => (
            <div key={di} className="text-xs">
              <div className="flex items-center gap-1.5">
                <span style={{ width: 20, height: 3, backgroundColor: d.color, display: 'inline-block', borderRadius: 2, flexShrink: 0 }} />
                <span className="truncate font-semibold text-gray-700">
                  {d.c.exitPointType === 'helipad' ? '🚁' : '🚩'} {d.c.exitPointName}
                </span>
              </div>
              <div className="ml-6 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-gray-500 mt-0.5">
                <span className="text-gray-400">{d.c.label}</span>
                <span className="text-gray-700">📏 {(d.totalDist / 1000).toFixed(2)} km</span>
                <span className="text-blue-600">↓ {Math.round(d.c.totalDescentM)} m</span>
                {d.c.totalAscentM > 0 && <span className="text-red-500">↑ {Math.round(d.c.totalAscentM)} m</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── 候補カード ──────────────────────────────────────────────────────────────

function CandidateCard({
  c, color, selected, onSelect,
}: { c: RouteCandidate; color: string; selected: boolean; onSelect: () => void }) {
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
  const [showCompare, setShowCompare] = useState(false)

  const goals = points.filter(p => p.type === 'exit' || p.type === 'helipad')
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
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">▼ ルート候補</div>
          {candidates.length > 0 && (
            <button
              onClick={() => setShowCompare(true)}
              className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded border border-indigo-200 transition"
            >
              📈 高低図
            </button>
          )}
        </div>
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

      {/* 区間 */}
      {mainRoute && (
        <section>
          <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ 区間</div>
          {getDisplaySegments(mainRoute.segments, mainRoute.coords.length).map((seg, i) => (
            <div
              key={i}
              className="flex items-center gap-1 py-0.5 text-xs cursor-pointer hover:bg-gray-50 rounded transition -mx-1 px-1 select-none"
              onClick={() => {
                const sliced = mainRoute.coords.slice(seg.startIndex, seg.endIndex + 1)
                if (sliced.length >= 2) fitBounds(sliced)
              }}
              title="クリックで地図に表示"
            >
              <span className="text-gray-500">—</span>
              <span className="flex-1 text-gray-700">{seg.name || `区間 ${i + 1}`}</span>
              {seg.courseTime && <span className="text-purple-600 font-mono">⏱ {seg.courseTime}</span>}
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

      {showCompare && candidates.length > 0 && (
        <ElevationCompareModal
          candidates={candidates}
          points={points}
          colors={candidates.map((_, i) => CANDIDATE_COLORS[i % CANDIDATE_COLORS.length])}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  )
}
