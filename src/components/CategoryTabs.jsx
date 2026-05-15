import { TAB_TOUT, TAB_A_RECEVOIR, TAB_A_ENVOYER, TAB_A_ENVOYER_LOT, TAB_ENVOYES, TAB_COMPTES_VINTED } from '../constants'

export default function CategoryTabs({ categories, active, onChange, items, isAdmin }) {
  const aRecevoirCount = items.filter(i => i.status === 'a_recevoir').length
  const aEnvoyerCount  = items.filter(i => i.status === 'vendu' && !i.bordereau_url).length
  const envoyesCount   = items.filter(i => i.status === 'envoye').length
  const lotsCount = (() => {
    const pending = items.filter(i => i.status === 'vendu' && i.bordereau_url)
    const counts = pending.reduce((acc, i) => { acc[i.bordereau_url] = (acc[i.bordereau_url] || 0) + 1; return acc }, {})
    return Object.values(counts).filter(n => n > 1).length
  })()

  function tabClass(isActive, color = 'teal') {
    const colors = {
      teal:   isActive ? 'border-teal-500 text-teal-600'     : 'border-transparent text-gray-500 hover:text-gray-800',
      orange: isActive ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-800',
      blue:   isActive ? 'border-blue-500 text-blue-600'     : 'border-transparent text-gray-500 hover:text-gray-800',
      purple: isActive ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-800',
    }
    return `px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${colors[color]}`
  }

  function badgeClass(isActive, color = 'teal') {
    const colors = {
      teal:   isActive ? 'bg-teal-100 text-teal-600'     : 'bg-gray-100 text-gray-500',
      orange: isActive ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500',
      blue:   isActive ? 'bg-blue-100 text-blue-600'     : 'bg-gray-100 text-gray-500',
      purple: isActive ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500',
    }
    return `ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-normal ${colors[color]}`
  }

  return (
    <div className="bg-white border-b border-gray-200 sticky top-14 z-20 shadow-sm">
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex min-w-max px-2">

          {/* Onglet Tout */}
          <button onClick={() => onChange(TAB_TOUT)} className={tabClass(active === TAB_TOUT)}>
            Tout
            <span className={badgeClass(active === TAB_TOUT)}>
              {items.filter(i => i.status === 'en_stock').length}
            </span>
          </button>

          {/* Séparateur */}
          <div className="flex items-center px-1">
            <div className="w-px h-5 bg-gray-200" />
          </div>

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

          {/* À recevoir */}
          <button
            onClick={() => onChange(TAB_A_RECEVOIR)}
            className={tabClass(active === TAB_A_RECEVOIR, 'purple')}
          >
            À recevoir
            {aRecevoirCount > 0 && (
              <span className={badgeClass(active === TAB_A_RECEVOIR, 'purple')}>{aRecevoirCount}</span>
            )}
          </button>

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

          {/* Lots */}
          <button
            onClick={() => onChange(TAB_A_ENVOYER_LOT)}
            className={tabClass(active === TAB_A_ENVOYER_LOT, 'orange')}
          >
            Lots
            {lotsCount > 0 && (
              <span className={badgeClass(active === TAB_A_ENVOYER_LOT, 'orange')}>{lotsCount}</span>
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

          {/* Comptes Vinted (admin uniquement) */}
          {isAdmin && (
            <>
              <div className="flex items-center px-1">
                <div className="w-px h-5 bg-gray-200" />
              </div>
              <button
                onClick={() => onChange(TAB_COMPTES_VINTED)}
                className={tabClass(active === TAB_COMPTES_VINTED, 'teal')}
              >
                🔐 Comptes
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
