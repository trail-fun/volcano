import { useState } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { calcCandidates } from '../../hooks/useRouteCalc'
import { POINT_ICONS } from '../map/mapStyles'
import type { RouteCandidate } from '../../types/candidate'

function CandidateCard({ c, selected, onSelect }: { c: RouteCandidate; selected: boolean; onSelect: () => void }) {
  const distKm = (c.totalDistanceM / 1000).toFixed(2)
  const typeIcon = c.exitPointType === 'helipad' ? '🚁' : '🚩'
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition ${selected ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
    >
      <div className="flex items-center gap-1 font-semibold text-sm">
        <span>{typeIcon}</span>
        <span className="truncate">{c.exitPointName}</span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
      <div className="flex gap-3 text-xs mt-1.5 font-mono">
        <span className="text-gray-700">📏 {distKm} km</span>
        <span className="text-blue-600">↓ {Math.round(c.totalDescentM)} m</span>
        {c.totalAscentM > 0 && <span className="text-red-500">↑ {Math.round(c.totalAscentM)} m</span>}
      </div>
      <div className="flex gap-1 mt-1 flex-wrap">
        {c.transportSuitability.map(t => (
          <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
            {t === 'walk' ? '徒歩' : t === 'stretcher' ? '担架' : 'ヘリ'}
          </span>
        ))}
        <span className={`text-xs px-1.5 py-0.5 rounded ${c.difficulty === 'low' ? 'bg-green-100 text-green-700' : c.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
          {c.difficulty === 'low' ? '難易度：低' : c.difficulty === 'medium' ? '難易度：中' : '難易度：高'}
        </span>
      </div>
    </button>
  )
}

export default function OperationPanel() {
  const { routes, points, togglePoint } = useRaceStore()
  const { position, candidates, selectedCandidateId, setPosition, selectCandidate, clearCasualty } = useCasualtyStore()
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')

  const goals = points.filter(p => p.type === 'exit' || p.type === 'helipad')

  const setManualPosition = () => {
    const lat = parseFloat(latStr), lng = parseFloat(lngStr)
    if (isNaN(lat) || isNaN(lng)) return
    const newCandidates = calcCandidates({ lat, lng }, routes, points)
    setPosition({ lat, lng }, newCandidates)
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* ゴール地点オン/オフ */}
      <section>
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ゴール地点</div>
        {goals.length === 0 && <p className="text-xs text-gray-400">下山口・ヘリポートが未登録です</p>}
        {goals.map(pt => (
          <label key={pt.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input type="checkbox" checked={pt.enabled} onChange={() => togglePoint(pt.id)} className="rounded" />
            <span className="text-base">{POINT_ICONS[pt.type]}</span>
            <span className={`text-sm ${!pt.enabled ? 'opacity-40 line-through' : ''}`}>{pt.name}</span>
          </label>
        ))}
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

      {/* ルート候補 */}
      <section className="flex-1">
        <div className="text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">▼ ルート候補</div>
        {!position && <p className="text-xs text-gray-400">傷病者位置を指定すると候補が表示されます</p>}
        {position && candidates.length === 0 && (
          <p className="text-xs text-orange-500">候補が見つかりません（コース上100m以内に傷病者位置を指定してください）</p>
        )}
        <div className="flex flex-col gap-2">
          {candidates.map(c => (
            <CandidateCard
              key={c.id} c={c}
              selected={selectedCandidateId === c.id}
              onSelect={() => selectCandidate(selectedCandidateId === c.id ? null : c.id)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
