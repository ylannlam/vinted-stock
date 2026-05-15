import { useState } from 'react'

const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE || '1234'

export default function AdminCodeModal({ onSuccess, onClose }) {
  const [digits, setDigits] = useState([])
  const [error, setError] = useState(false)

  function press(d) {
    if (digits.length >= 4) return
    const next = [...digits, d]
    setDigits(next)
    setError(false)
    if (next.length === 4) {
      if (next.join('') === ADMIN_CODE) {
        onSuccess()
      } else {
        setError(true)
        setTimeout(() => { setDigits([]); setError(false) }, 700)
      }
    }
  }

  function del() {
    setDigits(prev => prev.slice(0, -1))
    setError(false)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl p-6 w-72 shadow-2xl">
        <p className="text-center text-sm font-semibold text-gray-700 mb-5">Code administrateur</p>

        {/* Points indicateurs */}
        <div className="flex justify-center gap-5 mb-7">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
                i < digits.length
                  ? error
                    ? 'bg-red-500 border-red-500 scale-110'
                    : 'bg-teal-500 border-teal-500 scale-110'
                  : 'border-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Clavier numérique */}
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button
              key={n}
              onClick={() => press(String(n))}
              className="py-3.5 text-xl font-medium text-gray-800 bg-gray-50 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              {n}
            </button>
          ))}
          <div />
          <button
            onClick={() => press('0')}
            className="py-3.5 text-xl font-medium text-gray-800 bg-gray-50 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            0
          </button>
          <button
            onClick={del}
            className="py-3.5 flex items-center justify-center text-gray-500 bg-gray-50 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
