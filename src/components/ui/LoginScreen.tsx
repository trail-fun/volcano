import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'

export default function LoginScreen() {
  const { signIn, sendPasswordReset } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetMsg, setResetMsg] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetLoading, setResetLoading] = useState(false)

  const submit = async () => {
    setError(null)
    if (!email || !password) { setError('メールアドレスとパスワードを入力してください'); return }
    setLoading(true)
    const err = await signIn(email, password)
    if (err) setError('メールアドレスまたはパスワードが違います')
    setLoading(false)
  }

  const submitReset = async () => {
    setResetError(null)
    if (!resetEmail) { setResetError('メールアドレスを入力してください'); return }
    setResetLoading(true)
    const err = await sendPasswordReset(resetEmail)
    setResetLoading(false)
    if (err) { setResetError(err); return }
    setResetMsg('リセット用メールを送信しました。メール内のリンクをクリックしてください。')
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-green-900 to-green-950 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-6 w-full max-w-sm mx-4">
        <div className="text-center">
          <div className="text-5xl mb-3">🌋</div>
          <h1 className="text-2xl font-bold text-green-900">VOLCANO</h1>
          <p className="text-sm text-gray-500 mt-1">{showReset ? 'パスワードリセット' : 'ログイン'}</p>
        </div>

        {!showReset ? (
          <>
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
            <button
              onClick={() => { setShowReset(true); setResetEmail(email); setResetMsg(null); setResetError(null) }}
              className="text-xs text-gray-400 hover:text-gray-600 -mt-2"
            >
              パスワードをお忘れの方
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3 w-full">
              <input
                type="email"
                placeholder="登録済みのメールアドレス"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitReset()}
              />
              {resetError && <p className="text-xs text-red-500">{resetError}</p>}
              {resetMsg && <p className="text-xs text-green-600">{resetMsg}</p>}
              {!resetMsg && (
                <button
                  onClick={submitReset}
                  disabled={resetLoading}
                  className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl font-semibold transition"
                >
                  {resetLoading ? '送信中…' : 'リセットメールを送信'}
                </button>
              )}
            </div>
            <button
              onClick={() => setShowReset(false)}
              className="text-xs text-gray-400 hover:text-gray-600 -mt-2"
            >
              ← ログインに戻る
            </button>
          </>
        )}
      </div>
    </div>
  )
}
