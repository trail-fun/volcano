import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'

export default function PasswordResetScreen() {
  const { updatePassword, clearRecovery, signOut } = useAuthStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(null)
    if (!password) { setError('パスワードを入力してください'); return }
    if (password.length < 6) { setError('パスワードは6文字以上で入力してください'); return }
    if (password !== confirm) { setError('パスワードが一致しません'); return }
    setLoading(true)
    const err = await updatePassword(password)
    setLoading(false)
    if (err) { setError(err); return }
    setDone(true)
  }

  const handleClose = async () => {
    clearRecovery()
    await signOut()
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-green-900 to-green-950 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-6 w-full max-w-sm mx-4">
        <div className="text-center">
          <div className="text-5xl mb-3">🌋</div>
          <h1 className="text-2xl font-bold text-green-900">VOLCANO</h1>
          <p className="text-sm text-gray-500 mt-1">新しいパスワードを設定</p>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-4 w-full">
            <p className="text-sm text-green-600 text-center">パスワードを変更しました。再度ログインしてください。</p>
            <button
              onClick={handleClose}
              className="w-full py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-semibold transition"
            >ログイン画面へ</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            <input
              type="password"
              placeholder="新しいパスワード（6文字以上）"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
            <input
              type="password"
              placeholder="新しいパスワード（確認）"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={submit}
              disabled={loading}
              className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl font-semibold transition"
            >
              {loading ? '変更中…' : 'パスワードを変更'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
