import { useRef } from 'react'

export default function Header({ onLogout, onShowAdminCode, isAdmin }) {
  const tapCount = useRef(0)
  const tapTimer = useRef(null)

  function handleLogoTap() {
    tapCount.current += 1
    clearTimeout(tapTimer.current)
    if (tapCount.current >= 5) {
      tapCount.current = 0
      onShowAdminCode()
      return
    }
    tapTimer.current = setTimeout(() => { tapCount.current = 0 }, 2000)
  }

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30 h-14">
      <div className="flex items-center gap-2.5" onClick={handleLogoTap}>
        <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center select-none">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
        </div>
        <span className="font-bold text-gray-900 text-base select-none">Stock Vinted</span>
        {isAdmin && (
          <span className="text-[10px] font-bold text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded-full">Admin</span>
        )}
      </div>

      <button
        onClick={onLogout}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Déconnexion
      </button>
    </header>
  )
}
