import { useRef, useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useModeStore } from '../../store/modeStore'
import type { ProjectMeta } from '../../store/projectStore'

export default function StartScreen() {
  const gpxRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const { loadFromGpx, loadFromZip, race, routes, points } = useRaceStore()
  const { user, signOut } = useAuthStore()
  const { setMode } = useModeStore()
  const { projects, fetchProjects, loadProject, deleteProject } = useProjectStore()
  const [showProjects, setShowProjects] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (showProjects) fetchProjects()
  }, [showProjects])

  const handleGpx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { await loadFromGpx(f); e.target.value = '' }
  }
  const handleZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { await loadFromZip(f); setMode('operation'); e.target.value = '' }
  }

  const handleLoadProject = async (p: ProjectMeta) => {
    const data = await loadProject(p.id)
    if (!data) return
    const d = data as { race?: unknown; routes?: unknown; points?: unknown }
    useRaceStore.setState({
      race: (d.race as typeof race) ?? null,
      routes: (d.routes as typeof routes) ?? [],
      points: (d.points as typeof points) ?? [],
    })
    setMode('operation')
    setShowProjects(false)
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    await deleteProject(id)
    await fetchProjects()
    setDeleting(null)
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-green-900 to-green-950 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-6 w-full max-w-sm mx-4">
        <div className="text-center">
          <div className="text-5xl mb-3">🌋</div>
          <h1 className="text-2xl font-bold text-green-900">VOLCANO</h1>
          <p className="text-sm text-gray-500 mt-1">レースプラン作成補助</p>
        </div>

        {!showProjects ? (
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={() => gpxRef.current?.click()}
              className="w-full py-4 bg-green-700 hover:bg-green-600 text-white rounded-xl font-semibold text-lg flex items-center justify-center gap-2 transition"
            >
              ＋ 新規作成
            </button>
            <p className="text-xs text-gray-400 text-center -mt-2">メインコースのGPXファイルを選択</p>

            <button
              onClick={() => setShowProjects(true)}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-lg flex items-center justify-center gap-2 transition"
            >
              ☁️ クラウドから開く
            </button>

            <button
              onClick={() => zipRef.current?.click()}
              className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-semibold flex items-center justify-center gap-2 transition"
            >
              📂 ZIPから開く
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-700">プロジェクト一覧</span>
              <button onClick={() => setShowProjects(false)} className="text-xs text-gray-400 hover:text-gray-600">← 戻る</button>
            </div>
            {projects.length === 0
              ? <p className="text-xs text-gray-400 text-center py-4">保存済みプロジェクトがありません</p>
              : projects.map(p => (
                <div key={p.id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50">
                  <button
                    onClick={() => handleLoadProject(p)}
                    className="flex-1 text-left text-sm text-gray-800 font-medium truncate"
                  >
                    {p.name || '無題'}
                    <span className="ml-2 text-xs text-gray-400 font-normal">
                      {new Date(p.updated_at).toLocaleDateString('ja-JP')}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deleting === p.id}
                    className="text-xs text-gray-300 hover:text-red-400 transition"
                  >🗑</button>
                </div>
              ))
            }
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{user?.email}</span>
          <button onClick={signOut} className="hover:text-gray-600 underline">ログアウト</button>
        </div>
      </div>

      <input ref={gpxRef} type="file" accept=".gpx,application/octet-stream,application/xml,text/xml" className="hidden" onChange={handleGpx} />
      <input ref={zipRef} type="file" accept=".zip,application/zip,application/octet-stream" className="hidden" onChange={handleZip} />
    </div>
  )
}
