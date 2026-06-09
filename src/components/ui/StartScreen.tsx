import { useRef, useState, useEffect } from 'react'
import { useRaceStore } from '../../store/raceStore'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useModeStore } from '../../store/modeStore'
import AdminPanel from './AdminPanel'
import type { ProjectMeta } from '../../store/projectStore'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL as string

export default function StartScreen() {
  const gpxRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const { loadFromGpx, loadFromZip, race, routes, points } = useRaceStore()
  const { user, signOut } = useAuthStore()
  const { setMode, setViewerOnly } = useModeStore()
  const { projects, fetchProjects, loadProject, deleteProject, getShares, addShare, removeShare } = useProjectStore()
  const [showProjects, setShowProjects] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const isAdmin = user?.email === ADMIN_EMAIL

  // 共有ダイアログ
  const [shareTarget, setShareTarget] = useState<ProjectMeta | null>(null)
  const [shares, setShares] = useState<{ email: string }[]>([])
  const [shareEmail, setShareEmail] = useState('')
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [sharingLoading, setSharingLoading] = useState(false)

  useEffect(() => {
    if (showProjects) fetchProjects()
  }, [showProjects])

  const handleGpx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setViewerOnly(false); await loadFromGpx(f); e.target.value = '' }
  }
  const handleZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setViewerOnly(false); await loadFromZip(f); setMode('operation'); e.target.value = '' }
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
    setViewerOnly(!p.is_owner)
    setMode('operation')
    setShowProjects(false)
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    await deleteProject(id)
    await fetchProjects()
    setDeleting(null)
  }

  const openShareDialog = async (p: ProjectMeta) => {
    setShareTarget(p)
    setShareEmail('')
    setShareError(null)
    setShareMsg(null)
    const list = await getShares(p.id)
    setShares(list)
  }

  const handleAddShare = async () => {
    if (!shareTarget || !shareEmail.trim()) return
    setSharingLoading(true)
    setShareError(null)
    const err = await addShare(shareTarget.id, shareEmail)
    if (err) {
      setShareError(err.includes('unique') ? 'すでに共有済みです' : err)
    } else {
      setShareMsg('共有しました')
      setShareEmail('')
      const list = await getShares(shareTarget.id)
      setShares(list)
      setTimeout(() => setShareMsg(null), 2000)
    }
    setSharingLoading(false)
  }

  const handleRemoveShare = async (email: string) => {
    if (!shareTarget) return
    await removeShare(shareTarget.id, email)
    const list = await getShares(shareTarget.id)
    setShares(list)
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
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-gray-800 font-medium truncate">{p.name || '無題'}</span>
                      {!p.is_owner && <span className="text-xs text-indigo-500 flex-shrink-0">共有</span>}
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(p.updated_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </button>
                  {p.is_owner && (
                    <button
                      onClick={() => openShareDialog(p)}
                      className="text-xs text-gray-400 hover:text-indigo-500 flex-shrink-0 transition"
                      title="共有設定"
                    >🔗</button>
                  )}
                  {p.is_owner && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deleting === p.id}
                      className="text-xs text-gray-300 hover:text-red-400 transition flex-shrink-0"
                    >🗑</button>
                  )}
                </div>
              ))
            }
          </div>
        )}

        <div className="flex items-center justify-between w-full text-xs text-gray-400">
          <span className="truncate">{user?.email}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isAdmin && (
              <button onClick={() => setShowAdmin(true)} className="hover:text-indigo-600">👤 ユーザー管理</button>
            )}
            <button onClick={signOut} className="hover:text-gray-600 underline">ログアウト</button>
          </div>
        </div>
      </div>

      {/* 共有ダイアログ */}
      {shareTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-800 text-sm">🔗 共有設定</h2>
              <button onClick={() => setShareTarget(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 -mt-2 truncate">「{shareTarget.name}」</p>

            {/* 共有追加 */}
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="共有するメールアドレス"
                className="flex-1 border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                value={shareEmail}
                onChange={e => setShareEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddShare()}
              />
              <button
                onClick={handleAddShare}
                disabled={sharingLoading || !shareEmail.trim()}
                className="text-sm px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded transition"
              >共有</button>
            </div>
            {shareError && <p className="text-xs text-red-500 -mt-2">{shareError}</p>}
            {shareMsg && <p className="text-xs text-green-600 -mt-2">{shareMsg}</p>}

            {/* 共有一覧 */}
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">共有中のユーザー</div>
              {shares.length === 0
                ? <p className="text-xs text-gray-400">共有していません</p>
                : shares.map(s => (
                  <div key={s.email} className="flex items-center justify-between py-1 border-b last:border-0 border-gray-100">
                    <span className="text-sm text-gray-700 truncate">{s.email}</span>
                    <button
                      onClick={() => handleRemoveShare(s.email)}
                      className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0 ml-2 transition"
                    >共有解除</button>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      <input ref={gpxRef} type="file" accept=".gpx,application/octet-stream,application/xml,text/xml" className="hidden" onChange={handleGpx} />
      <input ref={zipRef} type="file" accept=".zip,application/zip,application/octet-stream" className="hidden" onChange={handleZip} />
    </div>
  )
}
