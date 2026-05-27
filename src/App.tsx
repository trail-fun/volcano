import { useState, useCallback } from 'react'
import { useRaceStore } from './store/raceStore'
import { useModeStore } from './store/modeStore'
import StartScreen from './components/ui/StartScreen'
import ModeToggle from './components/ui/ModeToggle'
import MapView from './components/map/MapView'
import EditPanel from './components/panels/EditPanel'
import OperationPanel from './components/panels/OperationPanel'
import './index.css'

export default function App() {
  const { race } = useRaceStore()
  const { mode } = useModeStore()
  const [pendingLatLng, setPendingLatLng] = useState<{ lat: number; lng: number } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setPendingLatLng({ lat, lng })
  }, [])

  if (!race) return <StartScreen />

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {/* ヘッダー */}
      <header className="flex items-center gap-3 px-3 py-2 bg-white border-b border-gray-200 shadow-sm z-10 flex-shrink-0">
        <span className="font-bold text-green-800 text-sm truncate">{race.name}</span>
        <div className="flex-1" />
        <ModeToggle />
        <button
          className="md:hidden text-gray-600 hover:text-gray-800 text-xl px-1"
          onClick={() => setSidebarOpen(o => !o)}
        >☰</button>
      </header>

      {/* メインエリア */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* 地図 */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapView onMapClick={handleMapClick} />
          {/* モバイル時 操作ヒント */}
          {mode === 'operation' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs px-3 py-1 rounded-full shadow pointer-events-none z-10">
              🚨 地図をタップして傷病者位置を指定
            </div>
          )}
        </div>

        {/* サイドパネル（PC常時表示・スマホはオーバーレイ） */}
        {/* バックドロップ */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        <aside
          className={`
            w-56 md:w-80 bg-white border-l border-gray-200 flex flex-col p-2 md:p-3 overflow-hidden
            md:flex md:static md:translate-x-0
            fixed top-0 right-0 bottom-0 z-30 transition-transform duration-250
            ${sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
          `}
          style={{ maxHeight: '100%' }}
        >
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <span className="text-sm font-bold text-gray-700">
              {mode === 'edit' ? '✏️ 編集' : '👁️ 確認'}
            </span>
            <button className="md:hidden text-gray-400 hover:text-gray-600" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {mode === 'edit'
              ? <EditPanel pendingLatLng={pendingLatLng} clearPending={() => setPendingLatLng(null)} />
              : <OperationPanel />
            }
          </div>
        </aside>
      </div>
    </div>
  )
}
