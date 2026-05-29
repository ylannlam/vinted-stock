import Logo from './Logo'

export default function Header({ onLogout, profile }) {
  const roleConfig = {
    admin:   { label: 'Admin',   color: 'text-teal-600 bg-teal-50' },
    stock:   { label: 'Stock',   color: 'text-orange-600 bg-orange-50' },
    employe: { label: 'Employé', color: 'text-purple-600 bg-purple-50' },
  }
  const role = profile?.role ?? null
  const roleCfg = role ? roleConfig[role] : null

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30 h-14">
      <div className="flex items-center gap-2.5">
        <Logo size={32} />
        <span className="font-bold text-gray-900 text-base">Stock Vinted</span>
      </div>

      <div className="flex items-center gap-3">
        {profile?.pseudo && (
          <span className="text-sm font-medium text-gray-700">{profile.pseudo}</span>
        )}
        {roleCfg && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleCfg.color}`}>
            {roleCfg.label}
          </span>
        )}
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
      </div>
    </header>
  )
}
