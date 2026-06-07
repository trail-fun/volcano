import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'

export default function LoginScreen() {
  const { signIn } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(null)
    if (!email || !password) { setError('メールアドレスとパスワードを入力してください'); return }
    setLoading(true)
    const err = await signIn(email, password)
    if (err) setError('メールアドレスまたはパスワードが違います')
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-green-900 to-green-950 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-6 w-full max-w-sm mx-4">
        <div className="text-center">
          <div className="text-5xl mb-3">🌋</div>
          <h1 className="text-2xl font-bold text-green-900">VOLCANO</h1>
          <p className="text-sm text-gray-500 mt-1">ログイン</p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <input
            type="email"
            placeholder="メールアドレス"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          <input
            type="password"
            placeholder="パスワード"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={submit}
            disabled={loading}
            className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl font-semibold transition"
          >
            {loading ? '処理中…' : 'ログイン'}
          </button>
        </div>
      </div>
    </div>
  )
}
