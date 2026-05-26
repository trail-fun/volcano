import { useRef } from 'react'
import { useRaceStore } from '../../store/raceStore'

export default function StartScreen() {
  const gpxRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const { loadFromGpx, loadFromZip } = useRaceStore()

  const handleGpx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { await loadFromGpx(f); e.target.value = '' }
  }
  const handleZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { await loadFromZip(f); e.target.value = '' }
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-green-900 to-green-950 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-8 w-full max-w-sm mx-4">
        <div className="text-center">
          <div className="text-5xl mb-3">🏔️</div>
          <h1 className="text-2xl font-bold text-green-900">トレラン救護支援</h1>
          <p className="text-sm text-gray-500 mt-1">搬送ルート判断支援ツール</p>
        </div>

        <div className="flex flex-col gap-4 w-full">
          <button
            onClick={() => gpxRef.current?.click()}
            className="w-full py-4 bg-green-700 hover:bg-green-600 text-white rounded-xl font-semibold text-lg flex items-center justify-center gap-2 transition"
          >
            ＋ 新規作成
          </button>
          <p className="text-xs text-gray-400 text-center -mt-2">メインコースのGPXファイルを選択</p>

          <button
            onClick={() => zipRef.current?.click()}
            className="w-full py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-lg flex items-center justify-center gap-2 transition"
          >
            📂 開く（ZIP）
          </button>
          <p className="text-xs text-gray-400 text-center -mt-2">以前に保存したZIPファイルを選択</p>
        </div>

        <input ref={gpxRef} type="file" accept=".gpx,application/octet-stream,application/xml,text/xml" className="hidden" onChange={handleGpx} />
        <input ref={zipRef} type="file" accept=".zip,application/zip,application/octet-stream" className="hidden" onChange={handleZip} />
      </div>
    </div>
  )
}
