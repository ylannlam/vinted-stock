import { useState, useRef, useEffect } from 'react'

const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE || '1234'

export default function AdminCodeModal({ onSuccess, onClose }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4)
    setValue(v)
    setError(false)
    if (v.length === 4) {
      if (v === ADMIN_CODE) {
        onSuccess()
      } else {
        setError(true)
        setTimeout(() => { setValue(''); setError(false) }, 700)
      }
    }
  }

  function handleKey(e) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl p-6 w-64 shadow-2xl">
        <p className="text-center text-sm font-semibold text-gray-700 mb-4">Code administrateur</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          maxLength={4}
          placeholder="••••"
          className={`w-full text-center text-2xl font-mono tracking-widest border-2 rounded-xl px-4 py-3 focus:outline-none transition-colors ${
            error ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-teal-400'
          }`}
        />
        {error && <p className="text-center text-xs text-red-500 mt-2">Code incorrect</p>}
      </div>
    </div>
  )
}
