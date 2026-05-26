import { useModeStore } from '../../store/modeStore'
import { useCasualtyStore } from '../../store/casualtyStore'

export default function ModeToggle() {
  const { mode, setMode } = useModeStore()
  const { clearCasualty } = useCasualtyStore()

  const toOperation = () => {
    if (confirm('確認モードに切り替えます。編集内容を保存しましたか？')) setMode('operation')
  }
  const toEdit = () => {
    setMode('edit')
    clearCasualty()
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-bold px-2 py-1 rounded ${mode === 'edit' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
        {mode === 'edit' ? '✏️ 編集モード' : '👁️ 確認モード'}
      </span>
      {mode === 'edit'
        ? <button onClick={toOperation} className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-3 py-1 rounded font-semibold transition">確認モードへ →</button>
        : <button onClick={toEdit} className="text-xs bg-blue-500 hover:bg-blue-400 text-white px-3 py-1 rounded font-semibold transition">← 編集に戻る</button>
      }
    </div>
  )
}
