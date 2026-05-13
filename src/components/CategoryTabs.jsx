import { TAB_A_ENVOYER, TAB_ENVOYES } from '../constants'

export default function CategoryTabs({ categories, active, onChange, items }) {
  const aEnvoyerCount = items.filter(i => i.status === 'vendu').length
  const envoyesCount  = items.filter(i => i.status === 'envoye').length

  function tabClass(isActive, color = 'teal') {
    const colors = {
      teal:   isActive ? 'border-teal-500 text-teal-600'     : 'border-transparent text-gray-500 hover:text-gray-800',
      orange: isActive ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-800',
      blue:   isActive ? 'border-blue-500 text-blue-600'     : 'border-transparent text-gray-500 hover:text-gray-800',
    }
    return `px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${colors[color]}`
  }

  function badgeClass(isActive, color = 'teal') {
    const colors = {
      teal:   isActive ? 'bg-teal-100 text-teal-600'     : 'bg-gray-100 text-gray-500',
      orange: isActive ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500',
      blue:   isActive ? 'bg-blue-100 text-blue-600'     : 'bg-gray-100 text-gray-500',
    }
    return `ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-normal ${colors[color]}`
  }

  return (
    <div className="bg-white border-b border-gray-200 sticky top-14 z-20 shadow-sm">
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex min-w-max px-2">

          {/* Onglets catégories */}
          {categories.map(cat => {
            const count = items.filter(i => i.category === cat && i.status === 'en_stock').length
            const isActive = active === cat
            return (
              <button key={cat} onClick={() => onChange(cat)} className={tabClass(isActive)}>
                {cat}
                {count > 0 && <span className={badgeClass(isActive)}>{count}</span>}
              </button>
            )
          })}

          {/* Séparateur */}
          <div className="flex items-center px-1">
            <div className="w-px h-5 bg-gray-200" />
          </div>

          {/* À envoyer */}
          <button
            onClick={() => onChange(TAB_A_ENVOYER)}
            className={tabClass(active === TAB_A_ENVOYER, 'orange')}
          >
            À envoyer
            {aEnvoyerCount > 0 && (
              <span className={badgeClass(active === TAB_A_ENVOYER, 'orange')}>{aEnvoyerCount}</span>
            )}
          </button>

          {/* Articles envoyés */}
          <button
            onClick={() => onChange(TAB_ENVOYES)}
            className={tabClass(active === TAB_ENVOYES, 'blue')}
          >
            Envoyés
            {envoyesCount > 0 && (
              <span className={badgeClass(active === TAB_ENVOYES, 'blue')}>{envoyesCount}</span>
            )}
          </button>

        </div>
      </div>
    </div>
  )
}
