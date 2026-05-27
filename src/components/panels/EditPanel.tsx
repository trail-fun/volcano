import { useRef, useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useModeStore } from '../../store/modeStore'
import { parseGpx } from '../../utils/gpxParser'
import { snapToRoute } from '../../utils/geo'
import type { PointType, Route, Terrain, Segment } from '../../types/race'
import { POINT_ICONS } from '../map/mapStyles'

const POINT_LABELS: Record<PointType, string> = {
  exit: '下山口', helipad: 'ヘリポート', aid: 'エイド', parking: '駐車場', custom: 'カスタム',
}

type Props = { pendingLatLng: { lat: number; lng: number } | null; clearPending: () => void }

export default function EditPanel({ pendingLatLng, clearPending }: Props) {
  const { race, routes, points, setRace, exportToZip, addPoint, updatePoint, deletePoint, addRoute, updateRoute } = useRaceStore()
  const { activeTool, setActiveTool } = useModeStore()
  const escGpxRef = useRef<HTMLInputElement>(null)
  const roadGpxRef = useRef<HTMLInputElement>(null)

  const [newPoint, setNewPoint] = useState<{ type: PointType; name: string; note: string } | null>(null)
  const [editPointId, setEditPointId] = useState<string | null>(null)

  // 区間設定ツール
  const [terrainStep, setTerrainStep] = useState<'start' | 'end' | null>(null)
  const terrainStartIdxRef = useRef<number | null>(null)
  const [terrainDialogIndices, setTerrainDialogIndices] = useState<{ si: number; ei: number } | null>(null)

  // ポイント追加ダイアログ（地図クリック後）
  if (pendingLatLng && !newPoint && activeTool === 'add_point') {
    setNewPoint({ type: 'exit', name: '', note: '' })
  }

  // 区間設定（地図クリック後）
  useEffect(() => {
    if (!pendingLatLng || activeTool !== 'set_segment') return
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute) { clearPending(); return }
    const snap = snapToRoute(pendingLatLng, mainRoute.coords)
    if (!snap) { clearPending(); return }
    if (terrainStep === 'start') {
      terrainStartIdxRef.current = snap.segmentIndex
      setTerrainStep('end')
      clearPending()
    } else if (terrainStep === 'end') {
      const si = Math.min(terrainStartIdxRef.current!, snap.segmentIndex)
      const ei = Math.max(terrainStartIdxRef.current!, snap.segmentIndex)
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
    // 重複範囲の既存セグメントを除いて追加
    const filtered = mainRoute.segments.filter(s => s.endIndex < si || s.startIndex > ei)
    updateRoute(mainRoute.id, { segments: [...filtered, newSeg] })
    setTerrainDialogIndices(null)
  }

  const deleteTerrainSegment = (idx: number) => {
    const mainRoute = routes.find(r => r.type === 'course')
    if (!mainRoute) return
    updateRoute(mainRoute.id, { segments: mainRoute.segments.filter((_, i) => i !== idx) })
  }

  const saveNewPoint = () => {
    if (!newPoint || !pendingLatLng) return
    addPoint({
      id: crypto.randomUUID(), lat: pendingLatLng.lat, lng: pendingLatLng.lng,
      ...newPoint, enabled: true,
    })
    setNewPoint(null)
    clearPending()
    setActiveTool('none')
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
        {routes.map(r => (
          <div key={r.id} className="text-sm py-1 flex items-center gap-1">
            <span className={r.type === 'course' ? 'text-green-600' : r.type === 'escape' ? 'text-blue-600' : 'text-gray-400'}>
              {r.type === 'course' ? '🟢' : r.type === 'escape' ? '🔵' : '⚫'}
            </span>
            <span className="flex-1 truncate">{r.name}</span>
            <span className="text-xs text-gray-400">
              {r.type === 'course' ? 'メイン' : r.type === 'escape' ? 'エスケープ' : '車道'}
            </span>
          </div>
        ))}
        <div className="flex gap-1 mt-1 flex-wrap">
          <button onClick={() => escGpxRef.current?.click()}
            className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded transition">
            ＋ エスケープ追加
          </button>
          <button onClick={() => roadGpxRef.current?.click()}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition">
            ＋ 車道ルート
          </button>
        </div>
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
            {mainRoute.segments.length === 0 && (
              <p className="text-xs text-gray-400">未設定（全区間トレイルとして扱います）</p>
            )}
            {mainRoute.segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-1 py-0.5 text-xs">
                <span className={seg.terrain === 'trail' ? 'text-green-600' : 'text-amber-500'}>
                  {seg.terrain === 'trail' ? '🌿' : '🚗'}
                </span>
                <span className="flex-1 text-gray-700">
                  {seg.terrain === 'trail' ? 'トレイル' : 'ロード'} (idx {seg.startIndex}–{seg.endIndex})
                </span>
                <button onClick={() => deleteTerrainSegment(i)} className="text-gray-400 hover:text-red-500">🗑</button>
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
          <div key={pt.id} className="flex items-center gap-1 py-0.5">
            <span className="text-base">{POINT_ICONS[pt.type]}</span>
            <span className={`flex-1 text-sm truncate ${!pt.enabled ? 'opacity-40 line-through' : ''}`}>{pt.name}</span>
            <button onClick={() => setEditPointId(pt.id)} className="text-xs text-gray-400 hover:text-blue-500">編集</button>
            <button onClick={() => deletePoint(pt.id)} className="text-xs text-gray-400 hover:text-red-500">🗑</button>
          </div>
        ))}
      </section>

      <hr className="border-gray-200" />

      {/* 保存 */}
      <button onClick={exportToZip}
        className="mt-auto w-full py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg font-semibold text-sm transition">
        💾 ZIPで保存
      </button>

      {/* ポイント追加ダイアログ */}
      {newPoint && pendingLatLng && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-3">
            <div className="font-bold text-gray-800">ポイントを追加</div>
            <div className="text-xs text-gray-500">位置: {pendingLatLng.lat.toFixed(5)}, {pendingLatLng.lng.toFixed(5)}</div>
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
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setNewPoint(null); clearPending() }} className="text-sm px-4 py-1.5 border rounded hover:bg-gray-50">キャンセル</button>
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-3">
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
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditPointId(null)} className="text-sm px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-500">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
