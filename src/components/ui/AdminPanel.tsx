import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

type UserEntry = { id: string; email: string; created_at: string }

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

async function callAdmin(path: string, body?: object) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${session?.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res
}

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const fetchUsers = async () => {
    setLoading(true); setError(null)
    try {
      const res = await callAdmin('admin-list-users')
      setUsers(await res.json())
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  const addUser = async () => {
    if (!newEmail || !newPassword) return
    setAdding(true); setError(null)
    try {
      await callAdmin('admin-create-user', { email: newEmail, password: newPassword })
      setMsg('ユーザーを追加しました')
      setNewEmail(''); setNewPassword('')
      await fetchUsers()
    } catch (e) {
      setError(String(e))
    }
    setAdding(false)
    setTimeout(() => setMsg(null), 3000)
  }

  const deleteUser = async (id: string, email: string) => {
    if (!confirm(`${email} を削除しますか？`)) return
    setDeleting(id); setError(null)
    try {
      await callAdmin('admin-delete-user', { userId: id })
      await fetchUsers()
    } catch (e) {
      setError(String(e))
    }
    setDeleting(null)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col gap-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800">👤 ユーザー管理</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* ユーザー追加 */}
        <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg">
          <div className="text-xs font-semibold text-gray-600">新規ユーザー追加</div>
          <input
            type="email"
            placeholder="メールアドレス"
            className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
          />
          <input
            type="text"
            placeholder="パスワード"
            className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
          />
          {msg && <p className="text-xs text-green-600">{msg}</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={addUser}
            disabled={adding || !newEmail || !newPassword}
            className="py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded text-sm font-semibold transition"
          >
            {adding ? '追加中…' : '追加'}
          </button>
        </div>

        {/* ユーザー一覧 */}
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-2">登録ユーザー一覧</div>
          {loading
            ? <p className="text-xs text-gray-400">読み込み中…</p>
            : users.length === 0
              ? <p className="text-xs text-gray-400">ユーザーがいません</p>
              : users.map(u => (
                <div key={u.id} className="flex items-center gap-2 py-1.5 border-b last:border-0 border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{u.email}</div>
                    <div className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString('ja-JP')}</div>
                  </div>
                  <button
                    onClick={() => deleteUser(u.id, u.email ?? '')}
                    disabled={deleting === u.id}
                    className="text-xs text-gray-300 hover:text-red-500 disabled:opacity-40 transition flex-shrink-0"
                  >🗑</button>
                </div>
              ))
          }
        </div>
      </div>
    </div>
  )
}
